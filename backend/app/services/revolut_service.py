import asyncio
import ssl
from typing import Literal

import httpx
from pydantic import BaseModel, Field, SecretStr

from app.config import Settings, settings


class RevolutToken(BaseModel):
    # Prevent accidental disclosure when this model is printed or logged.
    access_token: SecretStr = Field(min_length=1)
    token_type: Literal['Bearer']
    expires_in: int = Field(gt=0)


async def get_sandbox_access_token(config: Settings = settings) -> RevolutToken:
    if not all((config.revolut_api_client_id, config.revolut_transport_cert_path,
                config.revolut_private_key_path, config.revolut_ca_bundle_path)):
        raise RuntimeError('Configure REVOLUT_API_CLIENT_ID, REVOLUT_TRANSPORT_CERT_PATH, '
                           'REVOLUT_PRIVATE_KEY_PATH and REVOLUT_CA_BUNDLE_PATH first')
    try:
        # Verify the server using the CA bundle and identify our app using mTLS.
        context = ssl.create_default_context(cafile=str(config.revolut_ca_bundle_path.expanduser()))
        context.load_cert_chain(str(config.revolut_transport_cert_path.expanduser()),
                                str(config.revolut_private_key_path.expanduser()))
    except (OSError, ValueError):
        raise RuntimeError('Cannot load Revolut sandbox certificate/key/CA files; check paths and PEM contents') from None

    try:
        # Pin the sandbox host and disable redirects/proxy inheritance to keep credentials there.
        async with httpx.AsyncClient(verify=context, timeout=15, trust_env=False, follow_redirects=False) as client:
            response = await client.post('https://sandbox-oba-auth.revolut.com/token', data={
                'grant_type': 'client_credentials', 'scope': 'accounts',
                'client_id': config.revolut_api_client_id,
            })
    except httpx.RequestError:
        raise RuntimeError('Could not reach Revolut sandbox securely; check TLS trust and connectivity') from None
    if response.status_code != 200:
        # Never include response bodies: they may contain tokens or other credentials.
        raise RuntimeError(f'Revolut sandbox authentication failed (HTTP {response.status_code})')
    try:
        return RevolutToken.model_validate(response.json())
    except ValueError:
        raise RuntimeError('Invalid Revolut sandbox token response') from None


async def check_sandbox_connection(config: Settings = settings) -> None:
    token = await get_sandbox_access_token(config)
    print(f'Revolut sandbox authentication succeeded with verified TLS; token expires in {token.expires_in} seconds.')


if __name__ == '__main__':
    try:
        asyncio.run(check_sandbox_connection())
    except RuntimeError as exc:
        raise SystemExit(str(exc)) from None
