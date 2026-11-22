import os
from dataclasses import dataclass
from urllib.parse import urlsplit


def _database_url(raw: str) -> str:
    """Hosted Postgres providers hand out postgres:// or postgresql:// URLs; use psycopg 3."""
    for prefix in ("postgres://", "postgresql://"):
        if raw.startswith(prefix):
            return "postgresql+psycopg://" + raw[len(prefix) :]
    return raw


@dataclass(frozen=True)
class Settings:
    database_url: str = _database_url(os.getenv("DATABASE_URL", "sqlite:///./yazzy.db"))
    environment: str = os.getenv("YAZZY_ENV", "development")
    demo_enabled: bool = os.getenv("YAZZY_DEMO_ENABLED", "false").lower() == "true"
    # Browsers send the origin without a trailing slash, so a pasted "https://x.app/" must match.
    web_origin: str = os.getenv("WEB_ORIGIN", "http://localhost:5173").rstrip("/")
    redis_url: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    oidc_issuer: str = os.getenv("OIDC_ISSUER", "")
    oidc_audience: str = os.getenv("OIDC_AUDIENCE", "yazzy")
    oidc_client_id: str = os.getenv("OIDC_CLIENT_ID", "")
    oidc_client_secret: str = os.getenv("OIDC_CLIENT_SECRET", "")
    session_secret: str = os.getenv("SESSION_SECRET", "")
    advisor_url: str = os.getenv("ADVISOR_URL", "")
    advisor_key: str = os.getenv("ADVISOR_API_KEY", "")
    advisor_model: str = os.getenv("ADVISOR_MODEL", "")
    # Hosted single-user mode: the demo login stays on, but behind a shared password.
    access_password: str = os.getenv("YAZZY_ACCESS_PASSWORD", "")
    # Run the job worker inside the API process (free hosts have no separate worker).
    embedded_worker: bool = os.getenv("YAZZY_EMBEDDED_WORKER", "false").lower() == "true"
    # Where scripts/build_apk.py --publish puts APKs: the GitHub release `android`.
    updates_url: str = os.getenv(
        "YAZZY_UPDATES_URL", "https://github.com/AAVezirova22/Yazzy/releases/download/android"
    ).rstrip("/")
    # While a car drives, trip rebuilds for its uploads wait this long and share one pass.
    rebuild_delay_seconds: float = float(os.getenv("YAZZY_REBUILD_DELAY_SECONDS", "300"))
    # carimage.dev key for VIN decoding and car pictures (yazzy.modules.garage.car_picture); off when empty.
    car_image_api_key: str = os.getenv("CAR_IMAGE_API_KEY", "")

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
        if self.demo_enabled and self.environment not in {"development", "test"}:
            # Short passwords are allowed because wrong ones lock the login (api.main.login_locked).
            if len(self.access_password) < 4:
                raise ValueError(
                    "A hosted demo login requires YAZZY_ACCESS_PASSWORD of at least 4 characters"
                )
        if self.environment == "production":
            if self.demo_enabled:
                raise ValueError("Demo login must be disabled in production")
            if not self.database_url.startswith("postgresql"):
                raise ValueError("Production requires PostgreSQL")
            if not self.oidc_issuer.startswith("https://") or len(self.session_secret) < 32:
                raise ValueError("Production requires HTTPS OIDC and a strong session secret")


settings = Settings()
