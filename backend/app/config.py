from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

class Settings(BaseSettings):
    database_url: str
    echo_sql: bool = True
    test: bool = False
    jwt_secret: str
    project_name: str = "Fotosinteze backend"
    oauth_token_secret: str = "my_dev_secret"
    log_level: str = "DEBUG"
    client_url: str
    # Optional until the sandbox integration is used; credentials stay outside Git.
    revolut_api_client_id: str | None = None
    revolut_transport_cert_path: Path | None = None
    revolut_private_key_path: Path | None = None
    revolut_ca_bundle_path: Path | None = None
    revolut_signing_cert_path: Path | None = None
    revolut_signing_kid: str = "fotosinteze-sandbox"
    revolut_redirect_uri: HttpUrl | None = None
    revolut_token_encryption_key: SecretStr | None = None
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()  # type: ignore