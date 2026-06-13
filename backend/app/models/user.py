from typing import Optional, Literal
from datetime import datetime
from sqlmodel import SQLModel, Field

class UserBase(SQLModel):
    email: str = Field(unique=True, index=True)
    full_name: Optional[str] = Field(default=None)
    role: str = Field(default="owner", description="EV Owner (owner), Fleet Manager (manager), Administrator (admin)")
    is_active: bool = Field(default=True)

class User(UserBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    hashed_password: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

class UserCreate(SQLModel):
    email: str
    password: str
    full_name: Optional[str] = None
    role: Literal["owner", "manager", "admin"] = "owner"

class UserResponse(UserBase):
    id: int
    created_at: datetime
