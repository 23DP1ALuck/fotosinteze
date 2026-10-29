"""Browser-bound consent for the user's linked personal Revolut account."""
import hashlib
import hmac
import json
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal
from urllib.parse import urlsplit
from uuid import UUID

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException
from pydantic import BaseModel, Field, AwareDatetime, SecretStr
from sqlalchemy import or_, select, update
from sqlalchemy.exc import IntegrityError

from app.config import settings
from app.database import AsyncSession
from app.models import EnableBankingConnection as Connection, Workspace, WorkspaceUsers
from app.models.workspace import WorkspaceTypeEnum
from app.services import enable_banking_client as client

logger = logging.getLogger(__name__)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def encryption_cipher() -> Fernet:
    try:
        return Fernet(settings.revolut_token_encryption_key.get_secret_value().encode())
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(503, 'Configure REVOLUT_TOKEN_ENCRYPTION_KEY with a Fernet key') from None


class ConnectionStatus(BaseModel):
    status: Literal['not_connected', 'connected', 'pending', 'expired', 'failed']
    expires_at: datetime | None = None
    last_sync_at: datetime | None = None


class CallbackInput(BaseModel):
    state: str = Field(min_length=1, max_length=128)
    code: SecretStr | None = Field(None, min_length=1, max_length=4096)
    error: str | None = Field(None, max_length=200)


def now_utc():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def personal(workspace):
    if workspace.type != WorkspaceTypeEnum.PERSONAL:
        raise HTTPException(400, 'Bank connection requires a Personal Workspace')


class SessionAccount(BaseModel):
    uid: UUID
    identification_hash: str = Field(min_length=1, max_length=4096)
    currency: str = Field(pattern=r'^[A-Z]{3}$')


class Access(BaseModel):
    valid_until: AwareDatetime


class BankSession(BaseModel):
    session_id: UUID
    accounts: Annotated[list[SessionAccount], Field(min_length=1, max_length=100)]
    access: Access


async def connection_status(workspace: Workspace, db: AsyncSession):
    personal(workspace)
    connection = await db.scalar(select(Connection).where(Connection.workspace_id == workspace.workspace_id))
    if connection is None:
        return ConnectionStatus(status='not_connected')
    now = now_utc()
    if connection.pending_status == 'deleting':
        state = 'failed'
    elif connection.session_encrypted and connection.expires_at and connection.expires_at > now:
        state = 'connected'
    elif connection.pending_status in ('pending', 'exchanging'):
        state = 'pending' if connection.pending_expires_at and connection.pending_expires_at > now else 'expired'
    elif connection.pending_status == 'failed':
        state = 'failed'
    else:
        state = 'expired'
    return ConnectionStatus(status=state,
        expires_at=connection.expires_at.replace(tzinfo=timezone.utc) if connection.expires_at else None,
        last_sync_at=connection.last_sync_at.replace(tzinfo=timezone.utc) if connection.last_sync_at else None)


async def start_authorization(current_user: dict, workspace: Workspace, db: AsyncSession):
    personal(workspace)
    redirect = urlsplit(str(settings.enable_banking_redirect_uri or ''))
    if (redirect.scheme != 'https' or not redirect.hostname or redirect.username or redirect.password
            or redirect.path != '/enable-banking/callback' or redirect.query or redirect.fragment):
        raise HTTPException(503, 'Configure HTTPS ENABLE_BANKING_REDIRECT_URI ending in /enable-banking/callback')
    encryption_cipher()
    connection = await db.scalar(select(Connection).where(Connection.workspace_id == workspace.workspace_id))
    now = now_utc()
    if connection and connection.pending_status == 'deleting':
        raise HTTPException(409, 'Bank connection deletion is in progress; retry deletion first')
    if (connection and connection.pending_status == 'exchanging'
            and connection.pending_expires_at and connection.pending_expires_at > now):
        raise HTTPException(409, 'Bank authorization exchange is already in progress')
    workspace_id, user_id = workspace.workspace_id, int(current_user['sub'])
    connection_id = connection.connection_id if connection else None
    await db.commit()
    state, browser = (secrets.token_urlsafe(32) for _ in range(2))
    try:
        banks = await client.request('GET', '/aspsps', params={'country': 'LV'})
        bank = next(b for b in banks['aspsps'] if b['name'] == 'Revolut' and b['country'] == 'LV')
        validity = bank['maximum_consent_validity']
        if not isinstance(validity, int) or isinstance(validity, bool) or validity <= 60:
            raise ValueError()
        valid_until = datetime.now(timezone.utc) + timedelta(seconds=min(validity, 90*86400)-60)
        result = await client.request('POST', '/auth', json={
            'access': {'valid_until': valid_until.isoformat(), 'balances': True, 'transactions': True},
            'aspsp': {'name': 'Revolut', 'country': 'LV'}, 'psu_type': 'personal',
            'state': state, 'redirect_url': str(settings.enable_banking_redirect_uri)})
        url = result['url']
        parsed = urlsplit(url)
        if (parsed.scheme != 'https' or parsed.netloc not in ('auth.enablebanking.com', 'tilisy.enablebanking.com')
                or parsed.username or parsed.password):
            raise ValueError()
    except (KeyError, TypeError, ValueError, StopIteration):
        raise HTTPException(502, 'Could not start bank authorization') from None
    pending = dict(state_hash=digest(state), browser_hash=digest(browser), pending_user_id=user_id,
        pending_status='pending', pending_expires_at=now + timedelta(minutes=10))
    if connection_id is None:
        db.add(Connection(workspace_id=workspace_id, connected_by_id=user_id, **pending))
    else:
        result = await db.execute(update(Connection).where(Connection.connection_id == connection_id,
            or_(Connection.pending_status.is_(None), Connection.pending_status != 'exchanging',
                Connection.pending_expires_at <= now),
            or_(Connection.pending_status.is_(None), Connection.pending_status != 'deleting')).values(**pending))
        if result.rowcount != 1:
            await db.rollback()
            raise HTTPException(409, 'Bank authorization exchange is already in progress')
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, 'Another bank authorization was started; try again') from None
    return url, browser


async def finish_authorization(data: CallbackInput, browser: str | None, db: AsyncSession):
    state_hash = digest(data.state)
    flow = await db.scalar(select(Connection).where(Connection.state_hash == state_hash)
                           .execution_options(populate_existing=True))
    now = now_utc()
    if (not flow or not browser or not hmac.compare_digest(flow.browser_hash or '', digest(browser))
            or flow.pending_status != 'pending' or not flow.pending_expires_at or flow.pending_expires_at <= now):
        raise HTTPException(400, 'Invalid, expired or already used bank authorization')
    accessible = await db.scalar(select(Workspace.workspace_id).join(WorkspaceUsers).where(
        Workspace.workspace_id == flow.workspace_id, Workspace.type == WorkspaceTypeEnum.PERSONAL,
        WorkspaceUsers.user_id == flow.pending_user_id))
    if accessible is None:
        raise HTTPException(403, 'No access to this Personal Workspace')
    cipher = encryption_cipher()
    previous_session_id = None
    if flow.session_encrypted:
        try:
            previous_session_id = UUID(json.loads(cipher.decrypt(flow.session_encrypted.encode()))['session_id'])
        except (InvalidToken, ValueError, TypeError, KeyError, AttributeError):
            pass
    issued_session_id = None
    workspace_id, user_id = flow.workspace_id, flow.pending_user_id
    claimed = await db.execute(update(Connection).where(Connection.state_hash == state_hash,
        Connection.pending_status == 'pending', Connection.pending_expires_at > now).values(pending_status='exchanging'))
    await db.commit()
    if claimed.rowcount != 1:
        raise HTTPException(400, 'Invalid, expired or already used bank authorization')
    try:
        if data.error or data.code is None:
            raise HTTPException(400, 'Bank authorization was denied or incomplete')
        payload = await client.request('POST', '/sessions', json={'code': data.code.get_secret_value()})
        issued_session_id = UUID(payload['session_id'])
        bank = payload.get('aspsp', {})
        if bank.get('name') != 'Revolut' or bank.get('country') != 'LV' or payload.get('psu_type') != 'personal':
            raise ValueError()
        # Closed/blocked accounts have no usable uid in the provider contract.
        accounts = payload['accounts']
        if not isinstance(accounts, list):
            raise ValueError()
        payload = {**payload, 'accounts': [a for a in accounts if not isinstance(a, dict) or a.get('uid') is not None]}
        session = BankSession.model_validate(payload)
        expiry = session.access.valid_until.astimezone(timezone.utc).replace(tzinfo=None)
        if (expiry <= now_utc() or expiry > now_utc() + timedelta(days=90)
                or len({a.uid for a in session.accounts}) != len(session.accounts)
                or len({(a.identification_hash, a.currency) for a in session.accounts}) != len(session.accounts)):
            raise ValueError()
        # Recheck membership after the provider call, before persisting bank access.
        accessible = await db.scalar(select(Workspace.workspace_id).join(WorkspaceUsers).where(
            Workspace.workspace_id == workspace_id, Workspace.type == WorkspaceTypeEnum.PERSONAL,
            WorkspaceUsers.user_id == user_id))
        if accessible is None:
            raise HTTPException(403, 'No access to this Personal Workspace')
        saved = await db.execute(update(Connection).where(Connection.state_hash == state_hash,
            Connection.pending_status == 'exchanging', Connection.pending_expires_at > now_utc()).values(
                session_encrypted=cipher.encrypt(session.model_dump_json().encode()).decode(), expires_at=expiry,
                connected_by_id=user_id, pending_status='authorized', browser_hash=None))
        if saved.rowcount != 1:
            raise HTTPException(400, 'Bank authorization expired or was replaced; start again')
        await db.commit()
    except (ValueError, TypeError, KeyError, AttributeError, HTTPException) as exc:
        await db.rollback()
        logger.warning('Enable Banking callback failed (%s)', type(exc).__name__)
        # A consent can finish after deletion; close that newly issued, unpersisted session.
        if issued_session_id is not None and issued_session_id != previous_session_id:
            try:
                await client.request('DELETE', '/sessions/' + str(issued_session_id))
            except HTTPException:
                logger.warning('Enable Banking could not revoke an unpersisted session')
        await db.execute(update(Connection).where(Connection.state_hash == state_hash,
            Connection.pending_status == 'exchanging').values(pending_status='failed', browser_hash=None))
        await db.commit()
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(502, 'Could not complete bank authorization; start again') from None
    return {'status': 'authorized', 'workspace_id': workspace_id}
