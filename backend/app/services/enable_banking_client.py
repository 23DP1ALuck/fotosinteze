import re
import time

import httpx
import jwt
from cryptography.exceptions import UnsupportedAlgorithm
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException

from app.config import settings


async def request(method: str, path: str, **kwargs) -> dict:
    uuid = r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
    if not ((method == 'GET' and (path in ('/application', '/aspsps')
            or re.fullmatch(rf'/accounts/{uuid}/(?:balances|transactions)', path)
            or re.fullmatch(rf'/sessions/{uuid}', path)))
            or (method == 'POST' and path in ('/auth', '/sessions'))
            or (method == 'DELETE' and re.fullmatch(rf'/sessions/{uuid}', path))):
        raise HTTPException(400, 'Unsupported Enable Banking endpoint')
    if kwargs.keys() - {'json', 'params', 'headers'}:
        raise HTTPException(400, 'Unsupported Enable Banking request options')
    try:
        headers = httpx.Headers(kwargs.pop('headers', None))
    except (TypeError, ValueError):
        raise HTTPException(400, 'Invalid Enable Banking request headers') from None
    if 'authorization' in headers or 'host' in headers:
        raise HTTPException(400, 'Enable Banking authentication headers cannot be overridden')
    if not settings.enable_banking_app_id or not settings.enable_banking_private_key_path:
        raise HTTPException(503, 'Enable Banking is not configured')
    try:
        key = serialization.load_pem_private_key(
            settings.enable_banking_private_key_path.expanduser().read_bytes(), password=None)
        if not isinstance(key, rsa.RSAPrivateKey) or key.key_size < 2048:
            raise ValueError()
        now = int(time.time())
        token = jwt.encode({'iss': 'enablebanking.com', 'aud': 'api.enablebanking.com',
                            'iat': now, 'exp': now + 300}, key, algorithm='RS256',
                           headers={'kid': settings.enable_banking_app_id, 'typ': 'JWT'})
    except (OSError, ValueError, TypeError, UnsupportedAlgorithm, jwt.PyJWTError):
        raise HTTPException(503, 'Enable Banking signing configuration is invalid') from None
    headers['Authorization'] = f'Bearer {token}'
    try:
        # Keep the signing credential on the verified API host, including on redirects.
        async with httpx.AsyncClient(verify=True, timeout=20, trust_env=False, follow_redirects=False) as client:
            response = await client.request(method, 'https://api.enablebanking.com' + path,
                                            headers=headers, **kwargs)
    except httpx.RequestError:
        raise HTTPException(502, 'Enable Banking could not be reached securely') from None
    if response.status_code == 429:
        try:
            retry = min(86400, max(60, int(response.headers.get('Retry-After', '60'))))
        except ValueError:
            retry = 60
        raise HTTPException(429, 'Bank refresh limit reached; try again later', headers={'Retry-After': str(retry)})
    if method == 'DELETE' and response.status_code in (204, 404):
        return {}
    if response.status_code not in (200, 201):
        raise HTTPException(502, 'Enable Banking request failed')
    try:
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError()
        return payload
    except ValueError:
        raise HTTPException(502, 'Enable Banking returned an invalid response') from None
