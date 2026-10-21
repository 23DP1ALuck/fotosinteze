from fastapi import HTTPException
from sqlalchemy import select

from app.database import AsyncSession


async def check_unique_name(db: AsyncSession, name_column, name: str, *conditions, detail: str) -> None:
    # shortcut: concurrent case-only inserts can race; add normalized unique DB keys for atomic enforcement.
    # SQLite LOWER is ASCII-only; Python casefold also handles Latvian letters.
    normalized = name.strip().casefold()
    names = await db.scalars(select(name_column).where(*conditions))
    if any(existing.strip().casefold() == normalized for existing in names):
        raise HTTPException(status_code=409, detail=detail)
