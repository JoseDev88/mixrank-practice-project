from typing import List, Optional
from fastapi import FastAPI, Query, HTTPException, Path, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from sqlalchemy import create_engine, Column, Integer, String, Float
from sqlalchemy.orm import declarative_base, Session
import os

# --- Auth / Admin token ---
# Set ADMIN_TOKEN in your environment; when empty, writes are allowed (dev mode).
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")

def require_admin(authorization: str = Header(default="")):
    """
    Expect header: Authorization: Bearer <ADMIN_TOKEN>
    If ADMIN_TOKEN is unset, allow writes (developer convenience).
    """
    if not ADMIN_TOKEN:
        return True  # dev mode
    parts = authorization.split()
    if len(parts) == 2 and parts[0].lower() == "bearer" and parts[1] == ADMIN_TOKEN:
        return True
    raise HTTPException(status_code=401, detail="Unauthorized")

# --- FastAPI app ---
app = FastAPI(title="App Explorer API", version="0.6.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- SQLite + SQLAlchemy setup ---
DB_URL = "sqlite:///./app_explorer.db"
engine = create_engine(DB_URL, echo=False, future=True)
Base = declarative_base()

class AppRow(Base):
    __tablename__ = "apps"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False, index=True)
    category = Column(String, nullable=False, index=True)
    rating = Column(Float, nullable=False)
    installs = Column(Integer, nullable=False)
    platform = Column(String, nullable=False)  # "ios" | "android"

def bootstrap():
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        if s.query(AppRow).count() == 0:
            s.add_all([
                AppRow(name="Pixel Painter", category="Art", rating=4.6, installs=50000, platform="android"),
                AppRow(name="FitTrack", category="Fitness", rating=4.2, installs=150000, platform="ios"),
                AppRow(name="Budget Buddy", category="Finance", rating=4.7, installs=75000, platform="android"),
                AppRow(name="StudySpark", category="Education", rating=4.4, installs=120000, platform="ios"),
                AppRow(name="CalmClock", category="Productivity", rating=4.8, installs=300000, platform="android"),
            ])
            s.commit()
bootstrap()

# --- Pydantic models ---
class AppOut(BaseModel):
    id: int
    name: str
    category: str
    rating: float
    installs: int
    platform: str

class AppCreate(BaseModel):
    name: str
    category: str
    rating: float
    installs: int
    platform: str  # ios | android

    @field_validator("name", "category")
    @classmethod
    def non_empty(cls, v: str):
        if not v or not v.strip():
            raise ValueError("must not be empty")
        return v.strip()

    @field_validator("rating")
    @classmethod
    def rating_range(cls, v: float):
        if v < 0 or v > 5:
            raise ValueError("rating must be between 0 and 5")
        return v

    @field_validator("installs")
    @classmethod
    def installs_nonneg(cls, v: int):
        if v < 0:
            raise ValueError("installs must be >= 0")
        return v

    @field_validator("platform")
    @classmethod
    def platform_choice(cls, v: str):
        v2 = v.lower().strip()
        if v2 not in {"ios", "android"}:
            raise ValueError("platform must be ios or android")
        return v2

class AppUpdate(BaseModel):
    # all fields optional for PATCH-like PUT
    name: Optional[str] = None
    category: Optional[str] = None
    rating: Optional[float] = None
    installs: Optional[int] = None
    platform: Optional[str] = None

    @field_validator("name", "category")
    @classmethod
    def non_empty_opt(cls, v: Optional[str]):
        if v is None:
            return v
        if not v.strip():
            raise ValueError("must not be empty")
        return v.strip()

    @field_validator("rating")
    @classmethod
    def rating_range_opt(cls, v: Optional[float]):
        if v is None:
            return v
        if v < 0 or v > 5:
            raise ValueError("rating must be between 0 and 5")
        return v

    @field_validator("installs")
    @classmethod
    def installs_nonneg_opt(cls, v: Optional[int]):
        if v is None:
            return v
        if v < 0:
            raise ValueError("installs must be >= 0")
        return v

    @field_validator("platform")
    @classmethod
    def platform_choice_opt(cls, v: Optional[str]):
        if v is None:
            return v
        v2 = v.lower().strip()
        if v2 not in {"ios", "android"}:
            raise ValueError("platform must be ios or android")
        return v2

class Page(BaseModel):
    items: List[AppOut]
    total: int
    page: int
    page_size: int

@app.get("/health")
def health():
    return {"status": "ok"}

ALLOWED_SORT_FIELDS = {"rating", "installs", "name"}
ALLOWED_DIRS = {"asc", "desc"}

@app.get("/apps", response_model=Page)
def list_apps(
    q: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    platform: Optional[str] = Query(None, pattern="^(ios|android)$"),
    min_rating: float = Query(0.0, ge=0.0, le=5.0),
    sort_by: str = Query("rating"),
    sort_dir: str = Query("desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(5, ge=1, le=50),
):
    if sort_by not in ALLOWED_SORT_FIELDS or sort_dir not in ALLOWED_DIRS:
        raise HTTPException(status_code=400, detail="Invalid sort_by or sort_dir")

    with Session(engine) as s:
        query = s.query(AppRow)
        if q:
            query = query.filter(AppRow.name.ilike(f"%{q}%"))
        if category:
            query = query.filter(AppRow.category.ilike(category))
        if platform:
            query = query.filter(AppRow.platform == platform)
        if min_rating:
            query = query.filter(AppRow.rating >= min_rating)

        total = query.count()

        order_col = {"rating": AppRow.rating, "installs": AppRow.installs, "name": AppRow.name}[sort_by]
        query = query.order_by(order_col.desc() if sort_dir == "desc" else order_col.asc(), AppRow.id.asc())

        rows = query.offset((page - 1) * page_size).limit(page_size).all()
        items = [AppOut.model_validate(
            {"id": r.id, "name": r.name, "category": r.category, "rating": r.rating, "installs": r.installs, "platform": r.platform}
        ) for r in rows]
        return Page(items=items, total=total, page=page, page_size=page_size)

@app.post("/apps", response_model=AppOut, status_code=201, dependencies=[Depends(require_admin)])
def create_app(payload: AppCreate):
    with Session(engine) as s:
        exists = s.query(AppRow).filter(AppRow.name == payload.name, AppRow.platform == payload.platform).first()
        if exists:
            raise HTTPException(status_code=409, detail="App with same name and platform already exists")
        row = AppRow(**payload.model_dump())
        s.add(row)
        s.commit()
        s.refresh(row)
        return AppOut(**row.__dict__)

@app.put("/apps/{app_id}", response_model=AppOut, dependencies=[Depends(require_admin)])
def update_app(
    app_id: int = Path(..., ge=1),
    payload: AppUpdate = ...,
):
    with Session(engine) as s:
        row = s.get(AppRow, app_id)
        if not row:
            raise HTTPException(status_code=404, detail="App not found")

        data = payload.model_dump(exclude_none=True)
        # duplicate protection on (name, platform) if both provided (or either changes)
        if ("name" in data or "platform" in data):
            new_name = data.get("name", row.name)
            new_plat = data.get("platform", row.platform)
            dup = s.query(AppRow).filter(AppRow.id != app_id, AppRow.name == new_name, AppRow.platform == new_plat).first()
            if dup:
                raise HTTPException(status_code=409, detail="Another app with same name and platform exists")

        for k, v in data.items():
            setattr(row, k, v)
        s.commit()
        s.refresh(row)
        return AppOut(**row.__dict__)

@app.delete("/apps/{app_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_app(app_id: int = Path(..., ge=1)):
    with Session(engine) as s:
        row = s.get(AppRow, app_id)
        if not row:
            raise HTTPException(status_code=404, detail="App not found")
        s.delete(row)
        s.commit()
        return None
