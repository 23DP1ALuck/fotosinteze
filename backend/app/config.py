from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import HttpUrl, SecretStr

class Settings(BaseSettings):
    database_url: str
    echo_sql: bool = True
    test: bool = False
    jwt_secret: str
    project_name: str = "Fotosinteze backend"
    oauth_token_secret: str = "my_dev_secret"
    log_level: str = "DEBUG"
    client_url: str
    # Deprecated sandbox fields accept existing .env files; no direct Revolut integration remains.
    revolut_api_client_id: str | None = None
    revolut_transport_cert_path: Path | None = None
    revolut_private_key_path: Path | None = None
    revolut_ca_bundle_path: Path | None = None
    revolut_signing_cert_path: Path | None = None
    revolut_signing_kid: str = "fotosinteze-sandbox"
    revolut_redirect_uri: HttpUrl | None = None
    # Keep the existing key: Enable Banking sessions are encrypted with it.
    revolut_token_encryption_key: SecretStr | None = None
    enable_banking_app_id: str | None = None
    enable_banking_private_key_path: Path | None = None
    enable_banking_redirect_uri: HttpUrl | None = None
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()  # type: ignore
