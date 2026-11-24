import os
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Integer, String, create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./sysmap.db")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False)

# JSONB on Postgres, plain JSON elsewhere (lets you run locally with SQLite)
JsonType = JSON().with_variant(JSONB(), "postgresql")


class Base(DeclarativeBase):
    pass


class Submission(Base):
    __tablename__ = "submissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    questionnaire_id: Mapped[str] = mapped_column(String(100), index=True)
    questionnaire_version: Mapped[int] = mapped_column(Integer)
    system_name: Mapped[str] = mapped_column(String(200), index=True)
    answers: Mapped[dict] = mapped_column(JsonType)      # raw answers, untouched
    normalized: Mapped[dict] = mapped_column(JsonType)   # common model
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


def init_db():
    # v1 shortcut. Replace with Alembic migrations before real use.
    Base.metadata.create_all(engine)
