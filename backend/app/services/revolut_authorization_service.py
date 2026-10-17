import base64
import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import jwt
from cryptography import x509
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from pydantic import BaseModel, Field, SecretStr
from sqlalchemy import or_, select, update
from sqlalchemy.exc import IntegrityError

from app.config import settings
from app.database import AsyncSession
from app.models import RevolutConnection, Workspace, WorkspaceUsers
from app.models.workspace import WorkspaceTypeEnum
from app.services import revolut_service

AUTH_BASE = 'https://sandbox-oba-auth.revolut.com'
AUTHORIZE_URL = 'https://sandbox-oba.revolut.com/ui/index.html'


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def load_signing_credentials():
    try:
        cert = x509.load_pem_x509_certificate(settings.revolut_signing_cert_path.expanduser().read_bytes())
        key = serialization.load_pem_private_key(settings.revolut_private_key_path.expanduser().read_bytes(), password=None)
        if not isinstance(key, rsa.RSAPrivateKey) or key.key_size < 2048:
            raise ValueError()
        if key.public_key().public_numbers() != cert.public_key().public_numbers():
            raise ValueError()
        now = datetime.now(timezone.utc)
        if not cert.not_valid_before_utc <= now < cert.not_valid_after_utc:
            raise ValueError()
        return cert, key
    except (OSError, ValueError, TypeError, AttributeError):
        raise HTTPException(503, 'Configure a valid matching Revolut signing certificate and private key') from None


def public_jwks() -> dict:
    cert, key = load_signing_credentials()
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
    jwk.update(kid=settings.revolut_signing_kid, use='sig', alg='PS256',
               x5c=[base64.b64encode(cert.public_bytes(serialization.Encoding.DER)).decode()])
    return {'keys': [jwk]}


def encryption_cipher() -> Fernet:
    try:
        return Fernet(settings.revolut_token_encryption_key.get_secret_value().encode())
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(503, 'Configure REVOLUT_TOKEN_ENCRYPTION_KEY with a Fernet key') from None


async def start_authorization(current_user: dict, workspace: Workspace, db: AsyncSession) -> tuple[str, str]:
    if workspace.type != WorkspaceTypeEnum.PERSONAL:
        raise HTTPException(400, 'Revolut connection requires a Personal Workspace')
    if (settings.revolut_redirect_uri is None or settings.revolut_redirect_uri.scheme != 'https'
            or settings.revolut_redirect_uri.path != '/revolut/callback'
            or settings.revolut_redirect_uri.query or settings.revolut_redirect_uri.fragment):
        raise HTTPException(503, 'Configure an HTTPS REVOLUT_REDIRECT_URI ending in /revolut/callback without query or fragment')
    connection = await db.scalar(select(RevolutConnection).where(RevolutConnection.workspace_id == workspace.workspace_id))
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if (connection is not None and connection.authorization_status == 'exchanging'
            and connection.authorization_expires_at is not None and connection.authorization_expires_at > now):
        raise HTTPException(409, 'Revolut authorization exchange is already in progress')
    encryption_cipher()
    _, key = load_signing_credentials()
    try:
        token = await revolut_service.get_sandbox_access_token(settings)
        consent = await revolut_service.sandbox_request('POST', '/account-access-consents', settings,
            headers={'Authorization': 'Bearer ' + token.access_token.get_secret_value(),
                     'x-fapi-financial-id': '001580000103UAvAAM'},
            json={'Data': {'Permissions': ['ReadAccountsBasic', 'ReadAccountsDetail', 'ReadBalances',
                                           'ReadTransactionsBasic', 'ReadTransactionsDetail',
                                           'ReadTransactionsCredits', 'ReadTransactionsDebits']}, 'Risk': {}})
        consent_id = consent['Data']['ConsentId']
        if not isinstance(consent_id, str) or not 1 <= len(consent_id) <= 255:
            raise ValueError()
    except (RuntimeError, ValueError, KeyError, TypeError):
        raise HTTPException(502, 'Could not create Revolut sandbox consent') from None
    state, browser, nonce = (secrets.token_urlsafe(32) for _ in range(3))
    now = datetime.now(timezone.utc)
    pending = dict(authorization_state_hash=digest(state), authorization_browser_hash=digest(browser),
        authorization_nonce=nonce, authorization_user_id=int(current_user['sub']), pending_consent_id=consent_id,
        authorization_status='pending', authorization_expires_at=(now + timedelta(minutes=10)).replace(tzinfo=None))
    claims = {'response_type': 'code id_token', 'response_mode': 'fragment',
              'client_id': settings.revolut_api_client_id, 'redirect_uri': str(settings.revolut_redirect_uri),
              'aud': AUTH_BASE, 'iss': settings.revolut_api_client_id, 'scope': 'accounts',
              'state': state, 'nonce': nonce, 'nbf': int(now.timestamp()) - 5,
              'exp': int((now + timedelta(minutes=10)).timestamp()),
              'claims': {'id_token': {'openbanking_intent_id': {'value': consent_id}}}}
    request = jwt.encode(claims, key, algorithm='PS256', headers={'kid': settings.revolut_signing_kid})
    if connection is None:
        db.add(RevolutConnection(workspace_id=workspace.workspace_id, connected_by_id=int(current_user['sub']),
                                 external_consent_id=consent_id, status='pending', **pending))
    else:
        # Keep the established consent and tokens until this new attempt succeeds.
        result = await db.execute(update(RevolutConnection).where(
            RevolutConnection.revolut_connection_id == connection.revolut_connection_id,
            or_(RevolutConnection.authorization_status.is_(None),
                RevolutConnection.authorization_status != 'exchanging',
                RevolutConnection.authorization_expires_at <= now.replace(tzinfo=None)),
        ).values(**pending))
        if result.rowcount != 1:
            await db.rollback()
            raise HTTPException(409, 'Revolut authorization exchange is already in progress')
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, 'Another Revolut authorization was started; try again') from None
    params = {name: claims[name] for name in ('response_type', 'response_mode', 'client_id', 'redirect_uri', 'scope', 'state', 'nonce')}
    params['request'] = request
    return AUTHORIZE_URL + '?' + urlencode(params), browser


class CallbackInput(BaseModel):
    state: str = Field(min_length=1, max_length=128)
    code: SecretStr | None = Field(None, min_length=1, max_length=4096)
    error: str | None = Field(None, max_length=200)


class AuthorizedToken(revolut_service.RevolutToken):
    refresh_token: SecretStr = Field(min_length=1)
    id_token: SecretStr = Field(min_length=1)
    refresh_token_expires_at: int | None = None


async def finish_authorization(data: CallbackInput, browser: str | None, db: AsyncSession) -> dict:
    state_hash = digest(data.state)
    flow = await db.scalar(select(RevolutConnection).where(
        RevolutConnection.authorization_state_hash == state_hash).execution_options(populate_existing=True))
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if (flow is None or browser is None or not hmac.compare_digest(flow.authorization_browser_hash or "", digest(browser))
            or flow.authorization_status != 'pending' or flow.authorization_expires_at is None or flow.authorization_expires_at <= now):
        raise HTTPException(400, 'Invalid, expired or already used Revolut authorization')
    accessible = await db.scalar(select(Workspace.workspace_id).join(WorkspaceUsers).where(
        Workspace.workspace_id == flow.workspace_id, Workspace.type == WorkspaceTypeEnum.PERSONAL,
        WorkspaceUsers.user_id == flow.authorization_user_id))
    if accessible is None:
        raise HTTPException(403, 'No access to this Personal Workspace')
    cipher = encryption_cipher()
    # Claim and commit before contacting the provider so concurrent callbacks cannot exchange twice.
    claimed = await db.execute(update(RevolutConnection).where(
        RevolutConnection.authorization_state_hash == state_hash, RevolutConnection.authorization_status == 'pending',
        RevolutConnection.authorization_expires_at > now).values(authorization_status='exchanging'))
    await db.commit()
    if claimed.rowcount != 1:
        raise HTTPException(400, 'Invalid, expired or already used Revolut authorization')
    try:
        if data.error or data.code is None:
            raise HTTPException(400, 'Revolut authorization was denied or incomplete')
        payload = await revolut_service.sandbox_request('POST', '/token', settings, data={
            'grant_type': 'authorization_code', 'client_id': settings.revolut_api_client_id,
            'code': data.code.get_secret_value(), 'redirect_uri': str(settings.revolut_redirect_uri)})
        token = AuthorizedToken.model_validate(payload)
        # OIDC Core 3.1.3.7 permits TLS validation for ID tokens received directly from the token endpoint.
        claims = jwt.decode(token.id_token.get_secret_value(), options={
            'verify_signature': False, 'verify_exp': True, 'verify_aud': True, 'verify_iss': True,
            'verify_iat': True, 'verify_nbf': True,
            'require': ['iss', 'aud', 'exp', 'nonce', 'openbanking_intent_id']},
            audience=settings.revolut_api_client_id, issuer=AUTH_BASE)
        if (claims['nonce'] != flow.authorization_nonce or claims['openbanking_intent_id'] != flow.pending_consent_id
                or claims.get('azp', settings.revolut_api_client_id) != settings.revolut_api_client_id
                or claims['aud'] not in (settings.revolut_api_client_id, [settings.revolut_api_client_id])):
            raise ValueError()
        result = await db.execute(update(RevolutConnection).where(
            RevolutConnection.authorization_state_hash == state_hash,
            RevolutConnection.authorization_status == 'exchanging',
        ).values(status='active', external_consent_id=flow.pending_consent_id,
            access_token_encrypted=cipher.encrypt(token.access_token.get_secret_value().encode()).decode(),
            refresh_token_encrypted=cipher.encrypt(token.refresh_token.get_secret_value().encode()).decode(),
            expires_at=now + timedelta(seconds=token.expires_in),
            refresh_token_expires_at=(datetime.fromtimestamp(token.refresh_token_expires_at, timezone.utc).replace(tzinfo=None)
                                     if token.refresh_token_expires_at is not None else None),
            connected_by_id=flow.authorization_user_id, authorization_status='authorized', updated_at=now))
        if result.rowcount != 1:
            raise HTTPException(400, 'Revolut authorization was replaced; start again')
        await db.commit()
    except (RuntimeError, ValueError, jwt.PyJWTError, HTTPException) as exc:
        await db.execute(update(RevolutConnection).where(
            RevolutConnection.authorization_state_hash == state_hash,
            RevolutConnection.authorization_status == 'exchanging',
        ).values(authorization_status='failed'))
        # A failed reconnect must not clear or replace the established tokens.
        await db.commit()
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(502, 'Could not complete Revolut sandbox authorization; start again') from None
    return {'status': 'authorized', 'workspace_id': flow.workspace_id}
