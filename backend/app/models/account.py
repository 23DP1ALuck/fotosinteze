from decimal import Decimal
from typing import TYPE_CHECKING

from app.database import Base
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import BigInteger, CHAR, String, DECIMAL, ForeignKey

if TYPE_CHECKING:
    from app.models import Workspace, RevolutConnection, Transaction


class Account(Base):
    __tablename__ = "accounts"

    account_id: Mapped[int] = mapped_column(BigInteger,primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    currency: Mapped[str] = mapped_column(CHAR(3), nullable=False)
    balance: Mapped[Decimal] = mapped_column(DECIMAL(10,2), nullable=False)

    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.workspace_id"), nullable=False)
    workspace: Mapped["Workspace"] = relationship(back_populates="accounts")

    connection_id: Mapped[int | None] = mapped_column(
        ForeignKey("revolut_connections.revolut_connection_id"),
        nullable=True,
        unique=True,
    )



    connection: Mapped["RevolutConnection"] = relationship(back_populates="account")

    transactions: Mapped["Transaction"] = relationship(
        back_populates="account",
        cascade="all, delete-orphan"
    )
