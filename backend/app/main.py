from typing import List, Optional
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, Integer, String, Float
from sqlalchemy.orm import declarative_base, Session

# --- FastAPI app ---
app = FastAPI(title="App Explorer API", version="0.3.0")
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

class App(Base):
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
        if s.query(App).count() == 0:
            s.add_all([
                App(name="Pixel Painter", category="Art", rating=4.6, installs=50000, platform="android"),
                App(name="FitTrack", category="Fitness", rating=4.2, installs=150000, platform="ios"),
                App(name="Budget Buddy", category="Finance", rating=4.7, installs=75000, platform="android"),
                App(name="StudySpark", category="Education", rating=4.4, installs=120000, platform="ios"),
                App(name="Travel Lite", category="Travel", rating=4.1, installs=90000, platform="android"),
                App(name="Daily Digest", category="News", rating=3.9, installs=45000, platform="ios"),
                App(name="CalmClock", category="Productivity", rating=4.8, installs=300000, platform="android"),
                App(name="ChefMate", category="Food & Drink", rating=4.5, installs=110000, platform="ios"),
                App(name="TrailMap", category="Maps & Navigation", rating=4.3, installs=80000, platform="android"),
                App(name="ShopSaver", category="Shopping", rating=4.0, installs=95000, platform="ios"),
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

class Page(BaseModel):
    items: List[AppOut]
    total: int
    page: int
    page_size: int

@app.get("/health")
def health():
    return {"status": "ok"}

# Allowed sorting fields/directions
ALLOWED_SORT_FIELDS = {"rating", "installs", "name"}
ALLOWED_DIRS = {"asc", "desc"}

@app.get("/apps", response_model=Page)
def list_apps(
    q: Optional[str] = Query(None, description="Free-text search in name"),
    category: Optional[str] = Query(None, description="Exact category match"),
    platform: Optional[str] = Query(None, pattern="^(ios|android)$"),
    min_rating: float = Query(0.0, ge=0.0, le=5.0),
    # NEW:
    sort_by: str = Query("rating", description=f"One of {sorted(ALLOWED_SORT_FIELDS)}"),
    sort_dir: str = Query("desc", description="asc|desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(5, ge=1, le=50),
):
    if sort_by not in ALLOWED_SORT_FIELDS or sort_dir not in ALLOWED_DIRS:
        raise HTTPException(status_code=400, detail="Invalid sort_by or sort_dir")

    with Session(engine) as s:
        query = s.query(App)
        if q:
            like = f"%{q}%"
            query = query.filter(App.name.ilike(like))
        if category:
            query = query.filter(App.category.ilike(category))
        if platform:
            query = query.filter(App.platform == platform)
        if min_rating:
            query = query.filter(App.rating >= min_rating)

        total = query.count()

        # ORDER BY
        if sort_by == "rating":
            order_col = App.rating
        elif sort_by == "installs":
            order_col = App.installs
        else:  # "name"
            order_col = App.name

        query = query.order_by(order_col.desc() if sort_dir == "desc" else order_col.asc(), App.id.asc())

        # Pagination
        offset = (page - 1) * page_size
        rows = query.offset(offset).limit(page_size).all()

        items = [AppOut.model_validate({
            "id": r.id,
            "name": r.name,
            "category": r.category,
            "rating": r.rating,
            "installs": r.installs,
            "platform": r.platform
        }) for r in rows]

        return Page(items=items, total=total, page=page, page_size=page_size)
