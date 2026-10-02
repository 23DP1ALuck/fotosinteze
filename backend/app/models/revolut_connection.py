from typing import TYPE_CHECKING

from app.database import Base
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Text, DateTime, ForeignKey

from datetime import datetime

if TYPE_CHECKING: # need specify to prevent circular import error
    from app.models import User


class RevolutConnection(Base):
    __tablename__ = "revolut_connections"

    revolut_connection_id: Mapped[int] = mapped_column(primary_key=True, index=True)
    external_consent_id: Mapped[str] = mapped_column(String(255), nullable=False)
    access_token_encrypted: Mapped[str] = mapped_column(Text, nullable=True)
    refresh_token_encrypted: Mapped[str] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    last_sync_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, nullable=False)

    connected_by_id: Mapped[int] = mapped_column(
        ForeignKey("users.user_id"),
        nullable=False
    )

    connected_by: Mapped["User"] = relationship("User", back_populates="revolut_connection")
