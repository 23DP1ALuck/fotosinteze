from decimal import Decimal
from typing import TYPE_CHECKING

from app.database import Base
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import BigInteger, Integer, CHAR, String, DECIMAL, ForeignKey, Boolean, Index, text

if TYPE_CHECKING:
    from app.models import Workspace, RevolutConnection, Transaction


class Account(Base):
    __tablename__ = "accounts"

    account_id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"),primary_key=True, autoincrement=True)
    is_main: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    __table_args__ = (Index("uq_accounts_main_per_workspace", "workspace_id", unique=True,
                            postgresql_where=text("is_main = true"), sqlite_where=text("is_main = 1")),)

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

    transactions: Mapped[list["Transaction"]] = relationship(
        back_populates="account",
        cascade="all, delete-orphan"
    )
