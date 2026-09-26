from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends

from app.config import settings
from app.database import sessionmanager

from app.routes import auth

# inspired from
# https://medium.com/@tclaitken/setting-up-a-fastapi-app-with-async-sqlalchemy-2-0-pydantic-v2-e6c540be4308
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Function that handles startup and shutdown events.
    To understand more, read https://fastapi.tiangolo.com/advanced/events/
    """
    yield
    if sessionmanager._engine is not None:
        # Close the DB connection
        await sessionmanager.close()

app = FastAPI(lifespan=lifespan, title=settings.project_name)
app.include_router(auth.router)
@app.get("/")
def read_root():
    return {"message": "Hello World"}
