from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class EnableBankingConnection(Base):
    __tablename__ = 'enable_banking_connections'
    connection_id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey('workspaces.workspace_id', ondelete='CASCADE'), unique=True)
    connected_by_id: Mapped[int] = mapped_column(ForeignKey('users.user_id'))
    session_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    state_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    browser_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    pending_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    pending_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    pending_user_id: Mapped[int | None] = mapped_column(ForeignKey('users.user_id'), nullable=True)
    pending_transactions_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    sync_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    sync_retry_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    sync_lease_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
