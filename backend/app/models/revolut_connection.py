from typing import TYPE_CHECKING

from app.database import Base
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Text, DateTime, ForeignKey

from datetime import datetime

if TYPE_CHECKING: # need specify to prevent circular import error
    from app.models import User, Account


class RevolutConnection(Base):
    __tablename__ = "revolut_connections"

    revolut_connection_id: Mapped[int] = mapped_column(primary_key=True, index=True)
    external_consent_id: Mapped[str] = mapped_column(String(255), nullable=False)
    access_token_encrypted: Mapped[str] = mapped_column(Text, nullable=True)
    refresh_token_encrypted: Mapped[str] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, nullable=False)

    # Nullable for legacy rows which have not yet been linked to a workspace.
    workspace_id: Mapped[int | None] = mapped_column(
        ForeignKey("workspaces.workspace_id", ondelete="CASCADE"), nullable=True, unique=True
    )
    authorization_state_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    authorization_browser_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    authorization_nonce: Mapped[str | None] = mapped_column(String(64), nullable=True)
    authorization_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    authorization_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    authorization_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.user_id"), nullable=True)
    pending_consent_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    refresh_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    connected_by_id: Mapped[int] = mapped_column(
        ForeignKey("users.user_id"),
        nullable=False
    )

    connected_by: Mapped["User"] = relationship("User", back_populates="revolut_connections", foreign_keys=[connected_by_id])
    accounts: Mapped[list["Account"]] = relationship("Account",
                                              back_populates="connection",
                                              cascade="all, delete-orphan")
