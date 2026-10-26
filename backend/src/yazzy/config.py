import os
from dataclasses import dataclass
from urllib.parse import urlsplit


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./yazzy.db")
    environment: str = os.getenv("YAZZY_ENV", "development")
    demo_enabled: bool = os.getenv("YAZZY_DEMO_ENABLED", "false").lower() == "true"
    web_origin: str = os.getenv("WEB_ORIGIN", "http://localhost:5173")
    redis_url: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    oidc_issuer: str = os.getenv("OIDC_ISSUER", "")
    oidc_audience: str = os.getenv("OIDC_AUDIENCE", "yazzy")
    oidc_client_id: str = os.getenv("OIDC_CLIENT_ID", "")
    oidc_client_secret: str = os.getenv("OIDC_CLIENT_SECRET", "")
    session_secret: str = os.getenv("SESSION_SECRET", "")
    advisor_url: str = os.getenv("ADVISOR_URL", "")
    advisor_key: str = os.getenv("ADVISOR_API_KEY", "")
    advisor_model: str = os.getenv("ADVISOR_MODEL", "")

    @property
    def allowed_web_origins(self) -> tuple[str, ...]:
        """Only development loopback origins share the configured scheme and port."""
        origin = urlsplit(self.web_origin)
        if (
            self.environment == "development"
            and origin.scheme in {"http", "https"}
            and origin.hostname in {"localhost", "127.0.0.1"}
            and origin.username is None
            and origin.password is None
            and origin.path == ""
            and not origin.query
            and not origin.fragment
        ):
            port = f":{origin.port}" if origin.port is not None else ""
            return tuple(f"{origin.scheme}://{host}{port}" for host in ("localhost", "127.0.0.1"))
        return (self.web_origin,)

    def validate(self):
        if self.environment == "production":
            if self.demo_enabled:
                raise ValueError("Demo login must be disabled in production")
            if not self.database_url.startswith("postgresql"):
                raise ValueError("Production requires PostgreSQL")
            if not self.oidc_issuer.startswith("https://") or len(self.session_secret) < 32:
                raise ValueError("Production requires HTTPS OIDC and a strong session secret")


settings = Settings()
