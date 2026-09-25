from datetime import datetime

from app.database import Base
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, DateTime

class User(Base):
    __tablename__ = "users"

    user_id: Mapped[int] = mapped_column(primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255),unique=True, index=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(255),index=True, nullable=False)
    password: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime,default=datetime.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime,default=datetime.now(), nullable=False)
