from sqlmodel import SQLModel, create_engine, Session
from app.core.config import settings

# Configure SQLite-specific argument check_same_thread if using SQLite.
# This prevents errors during async FastAPI routing.
connect_args = {}
if settings.DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

# Initialize SQLModel engine
engine = create_engine(
    settings.DATABASE_URL,
    echo=False,
    connect_args=connect_args
)

def create_db_and_tables():
    """Initializes tables using SQLModel metadata."""
    SQLModel.metadata.create_all(engine)

def get_session():
    """FastAPI dependency yielding a thread-safe database session."""
    with Session(engine) as session:
        yield session
