from contextlib import contextmanager

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker

from yazzy.config import settings

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    connect_args={"check_same_thread": False, "timeout": 30}
    if settings.database_url.startswith("sqlite")
    else {},
)

if engine.dialect.name == "sqlite":

    @event.listens_for(engine, "connect")
    def sqlite_pragmas(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA journal_mode=WAL")


Session = sessionmaker(engine, expire_on_commit=False)


def set_tenant(db, tenant_id: str):
    db.info["tenant_id"] = tenant_id
    if db.bind.dialect.name == "postgresql":
        db.execute(text("SELECT set_config('app.tenant_id', :tenant, true)"), {"tenant": tenant_id})


@contextmanager
def transaction(tenant_id: str | None = None):
    with Session() as db, db.begin():
        if tenant_id:
            set_tenant(db, tenant_id)
        yield db


def get_db():
    with Session() as db:
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
