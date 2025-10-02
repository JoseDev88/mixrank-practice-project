from typing import List, Optional, Dict, Tuple
from fastapi import FastAPI, Query, HTTPException, Path, Depends, Header, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, field_validator
from sqlalchemy import create_engine, Column, Integer, String, Float
from sqlalchemy.orm import declarative_base, Session
import os, time, csv, io, logging, hashlib
from logging.handlers import RotatingFileHandler
from collections import defaultdict, deque
from datetime import datetime, timedelta
from urllib.parse import urlencode, urlsplit, urlunsplit, parse_qsl

# ---------------------------
# Config (env overrides)
# ---------------------------
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")

LOG_DIR = os.environ.get("LOG_DIR", "logs")
LOG_FILE = os.environ.get("LOG_FILE", os.path.join(LOG_DIR, "app.log"))
LOG_MAX_BYTES = int(os.environ.get("LOG_MAX_BYTES", str(5 * 1024 * 1024)))  # 5 MB
LOG_BACKUPS = int(os.environ.get("LOG_BACKUPS", "3"))

# Rate limiting (per-IP sliding window)
RATE_LIMIT_WINDOW_SECONDS = int(os.environ.get("RATE_LIMIT_WINDOW_SECONDS", "60"))
RATE_LIMIT_GET = int(os.environ.get("RATE_LIMIT_GET", "120"))      # per window (GET, HEAD)
RATE_LIMIT_WRITE = int(os.environ.get("RATE_LIMIT_WRITE", "30"))   # per window (POST, PUT, DELETE)

# ---------------------------
# Logging setup
# ---------------------------
os.makedirs(LOG_DIR, exist_ok=True)
logger = logging.getLogger("app")
logger.setLevel(logging.INFO)
if not any(isinstance(h, RotatingFileHandler) for h in logger.handlers):
    fh = RotatingFileHandler(LOG_FILE, maxBytes=LOG_MAX_BYTES, backupCount=LOG_BACKUPS)
    fh.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    fh.setFormatter(fmt)
    logger.addHandler(fh)
if not any(isinstance(h, logging.StreamHandler) for h in logger.handlers):
    sh = logging.StreamHandler()
    sh.setLevel(logging.INFO)
    sh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(sh)

# ---------------------------
# App + CORS
# ---------------------------
app = FastAPI(title="App Explorer API", version="1.1.2")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # adjust in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------
# Metrics (very lightweight)
# ---------------------------
requests_total: Dict[Tuple[str, str, int], int] = defaultdict(int)
request_duration_ms: Dict[Tuple[str, str], deque] = defaultdict(lambda: deque(maxlen=500))

# ---------------------------
# Rate limiting storage
# ---------------------------
hits: Dict[Tuple[str, str], deque] = defaultdict(lambda: deque())

def _ip_from_request(req: Request) -> str:
    xfwd = req.headers.get("x-forwarded-for")
    if xfwd:
        return xfwd.split(",")[0].strip()
    return req.client.host if req.client and req.client.host else "unknown"

def rate_limiter(kind: str):
    limit = RATE_LIMIT_GET if kind == "GET" else RATE_LIMIT_WRITE
    window = timedelta(seconds=RATE_LIMIT_WINDOW_SECONDS)

    async def _inner(request: Request):
        ip = _ip_from_request(request)
        key = (ip, kind)
        now = datetime.utcnow()
        q = hits[key]
        while q and (now - q[0]) > window:
            q.popleft()
        if len(q) >= limit:
            raise HTTPException(status_code=429, detail=f"Rate limit exceeded ({kind.lower()}), try later")
        q.append(now)
        return True
    return _inner

# ---------------------------
# Exceptions
# ---------------------------
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    return JSONResponse(status_code=422, content={"detail": exc.errors()})

# ---------------------------
# Auth helpers
# ---------------------------
def require_admin(authorization: str = Header(default="")):
    if not ADMIN_TOKEN:
        return True  # dev mode
    parts = authorization.split()
    if len(parts) == 2 and parts[0].lower() == "bearer" and parts[1] == ADMIN_TOKEN:
        return True
    raise HTTPException(status_code=401, detail="Unauthorized")

@app.get("/auth/mode", dependencies=[Depends(rate_limiter("GET"))])
def auth_mode():
    return {"requires_token": bool(ADMIN_TOKEN)}

@app.get("/auth/check", dependencies=[Depends(require_admin), Depends(rate_limiter("GET"))])
def auth_check():
    return {"ok": True}

# ---------------------------
# Timing + access logging middleware + metrics
# ---------------------------
@app.middleware("http")
async def timing_and_logging(request: Request, call_next):
    t0 = time.perf_counter()
    method = request.method
    path = request.url.path
    try:
        response: Response = await call_next(request)
        status = response.status_code
        return response
    except Exception as e:
        status = 500
        logger.exception(f"Unhandled error on {method} {path}: {e}")
        raise
    finally:
        dt_ms = (time.perf_counter() - t0) * 1000.0
        requests_total[(method, path, status)] += 1
        request_duration_ms[(method, path)].append(dt_ms)
        logger.info(f'{method} {path} -> {status} in {dt_ms:.1f} ms')

# ---------------------------
# DB setup
# ---------------------------
DB_URL = "sqlite:///./app_explorer.db"
DB_PATH = "./app_explorer.db"  # for quick mtime checks (ETag/Last-Modified)
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
    price = Column(Float, nullable=False, server_default="0.0")  # NEW

def bootstrap():
    # Extra safety: never bootstrap while Alembic is running
    if os.getenv("ALEMBIC_RUNNING") == "1":
        return
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        if s.query(AppRow).count() == 0:
            s.add_all([
                AppRow(name="Pixel Painter", category="Art", rating=4.6, installs=50000, platform="android", price=0.0),
                AppRow(name="FitTrack", category="Fitness", rating=4.2, installs=150000, platform="ios", price=4.99),
                AppRow(name="Budget Buddy", category="Finance", rating=4.7, installs=75000, platform="android", price=0.0),
                AppRow(name="StudySpark", category="Education", rating=4.4, installs=120000, platform="ios", price=2.99),
                AppRow(name="CalmClock", category="Productivity", rating=4.8, installs=300000, platform="android", price=0.0),
            ])
            s.commit()

# Only call bootstrap when not in Alembic context
if os.getenv("ALEMBIC_RUNNING") != "1":
    bootstrap()

# ---------------------------
# Schemas
# ---------------------------
class AppOut(BaseModel):
    id: int
    name: str
    category: str
    rating: float
    installs: int
    platform: str
    price: float  # NEW

class AppCreate(BaseModel):
    name: str
    category: str
    rating: float
    installs: int
    platform: str
    price: float  # NEW

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

    @field_validator("price")
    @classmethod
    def price_nonneg(cls, v: float):
        if v < 0:
            raise ValueError("price must be >= 0")
        return v

class AppUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    rating: Optional[float] = None
    installs: Optional[int] = None
    platform: Optional[str] = None
    price: Optional[float] = None  # NEW

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

    @field_validator("price")
    @classmethod
    def price_nonneg_opt(cls, v: Optional[float]):
        if v is None:
            return v
        if v < 0:
            raise ValueError("price must be >= 0")
        return v

class Page(BaseModel):
    items: List[AppOut]
    total: int
    page: int
    page_size: int
    next_url: Optional[str] = None
    prev_url: Optional[str] = None

# ---------------------------
# Helpers
# ---------------------------
ALLOWED_SORT_FIELDS = {"rating", "installs", "name"}  # add 'price' later if you want to sort by it too
ALLOWED_DIRS = {"asc", "desc"}

def apply_list_query(
    s: Session,
    q: Optional[str],
    category: Optional[str],
    platform: Optional[str],
    min_rating: float,
    sort_by: str,
    sort_dir: str,
):
    query = s.query(AppRow)
    if q:
        query = query.filter(AppRow.name.ilike(f"%{q}%"))
    if category:
        query = query.filter(AppRow.category.ilike(category))
    if platform:
        query = query.filter(AppRow.platform == platform)
    if min_rating:
        query = query.filter(AppRow.rating >= min_rating)
    order_col = {"rating": AppRow.rating, "installs": AppRow.installs, "name": AppRow.name}[sort_by]
    query = query.order_by(order_col.desc() if sort_dir == "desc" else order_col.asc(), AppRow.id.asc())
    return query

# ---- Day 10: caching + links helpers ----
def _db_mtime() -> int:
    try:
        return int(os.path.getmtime(DB_PATH))
    except Exception:
        return 0

def _with_params(url: str, overrides: dict) -> str:
    scheme, netloc, path, query, frag = urlsplit(url)
    q = dict(parse_qsl(query, keep_blank_values=True))
    for k, v in overrides.items():
        if v is None:
            q.pop(k, None)
        else:
            q[k] = v
    new_q = urlencode(q, doseq=True)
    return urlunsplit((scheme, netloc, path, new_q, frag))

def _etag_for_list(total: int, mtime: int, params_fingerprint: str) -> str:
    h = hashlib.sha256(f"{total}:{mtime}:{params_fingerprint}".encode()).hexdigest()[:16]
    return f'W/"{h}"'

# ---------------------------
# Routes
# ---------------------------
@app.get("/health", dependencies=[Depends(rate_limiter("GET"))])
def health():
    return {"status": "ok"}

@app.get("/apps", response_model=Page, dependencies=[Depends(rate_limiter("GET"))])
def list_apps(
    request: Request,
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
        query = apply_list_query(s, q, category, platform, min_rating, sort_by, sort_dir)
        total = query.count()

        # ETag + Last-Modified
        params_fingerprint = f"{q}|{category}|{platform}|{min_rating}|{sort_by}|{sort_dir}|{page}|{page_size}"
        mtime = _db_mtime()
        etag = _etag_for_list(total, mtime, params_fingerprint)
        last_mod_http = time.strftime("%a, %d %b %Y %H:%M:%S GMT", time.gmtime(mtime))

        inm = request.headers.get("if-none-match")
        ims = request.headers.get("if-modified-since")
        if inm == etag or (ims and ims == last_mod_http):
            resp = Response(status_code=304)
            resp.headers["ETag"] = etag
            resp.headers["Last-Modified"] = last_mod_http
            return resp

        rows = query.offset((page - 1) * page_size).limit(page_size).all()
        items = [AppOut.model_validate({
            "id": r.id, "name": r.name, "category": r.category,
            "rating": r.rating, "installs": r.installs, "platform": r.platform,
            "price": r.price,
        }) for r in rows]

        # Pagination link hints
        base_url = str(request.url)
        total_pages = max(1, (total + page_size - 1) // page_size)
        next_url = _with_params(base_url, {"page": page + 1}) if page < total_pages else None
        prev_url = _with_params(base_url, {"page": page - 1}) if page > 1 else None

        payload = Page(items=items, total=total, page=page, page_size=page_size,
                       next_url=next_url, prev_url=prev_url).model_dump()
        out = JSONResponse(payload)
        out.headers["ETag"] = etag
        out.headers["Last-Modified"] = last_mod_http
        links = []
        if next_url: links.append(f'<{next_url}>; rel="next"')
        if prev_url: links.append(f'<{prev_url}>; rel="prev"')
        if links:
            out.headers["Link"] = ", ".join(links)
        return out

@app.get("/apps/export.csv", dependencies=[Depends(rate_limiter("GET"))])
def export_apps_csv(
    q: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    platform: Optional[str] = Query(None, pattern="^(ios|android)$"),
    min_rating: float = Query(0.0, ge=0.0, le=5.0),
    sort_by: str = Query("rating"),
    sort_dir: str = Query("desc"),
):
    if sort_by not in ALLOWED_SORT_FIELDS or sort_dir not in ALLOWED_DIRS:
        raise HTTPException(status_code=400, detail="Invalid sort_by or sort_dir")
    with Session(engine) as s:
        rows = apply_list_query(s, q, category, platform, min_rating, sort_by, sort_dir).all()
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["id","name","category","platform","rating","installs","price"])
        for r in rows:
            w.writerow([r.id, r.name, r.category, r.platform, r.rating, r.installs, r.price])
        out = buf.getvalue()
    headers = {"Content-Disposition": 'attachment; filename="apps_export.csv"'}
    return PlainTextResponse(out, headers=headers, media_type="text/csv")

@app.post("/apps", response_model=AppOut, status_code=201,
          dependencies=[Depends(require_admin), Depends(rate_limiter("WRITE"))])
def create_app(payload: AppCreate):
    with Session(engine) as s:
        exists = s.query(AppRow).filter(AppRow.name == payload.name, AppRow.platform == payload.platform).first()
        if exists:
            raise HTTPException(status_code=409, detail="App with same name and platform already exists")
        row = AppRow(**payload.model_dump())
        s.add(row)
        s.commit()
        s.refresh(row)
        return AppOut.model_validate({
            "id": row.id, "name": row.name, "category": row.category,
            "rating": row.rating, "installs": row.installs, "platform": row.platform,
            "price": row.price,
        })

@app.put("/apps/{app_id}", response_model=AppOut,
         dependencies=[Depends(require_admin), Depends(rate_limiter("WRITE"))])
def update_app(app_id: int = Path(..., ge=1), payload: AppUpdate = ...):
    with Session(engine) as s:
        row = s.get(AppRow, app_id)
        if not row:
            raise HTTPException(status_code=404, detail="App not found")
        data = payload.model_dump(exclude_none=True)
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
        return AppOut.model_validate({
            "id": row.id, "name": row.name, "category": row.category,
            "rating": row.rating, "installs": row.installs, "platform": row.platform,
            "price": row.price,
        })

@app.delete("/apps/{app_id}", status_code=204,
            dependencies=[Depends(require_admin), Depends(rate_limiter("WRITE"))])
def delete_app(app_id: int = Path(..., ge=1)):
    with Session(engine) as s:
        row = s.get(AppRow, app_id)
        if not row:
            raise HTTPException(status_code=404, detail="App not found")
        s.delete(row)
        s.commit()
        return None

# ---------------------------
# Metrics endpoint
# ---------------------------
@app.get("/metrics")
def metrics(format: Optional[str] = Query(None, description="pass 'prom' for Prometheus text format")):
    if format == "prom":
        lines = []
        lines.append("# HELP requests_total Count of requests by method/path/status")
        lines.append("# TYPE requests_total counter")
        for (method, path, status), cnt in sorted(requests_total.items()):
            lines.append(f'requests_total{{method="{method}",path="{path}",status="{status}"}} {cnt}')
        lines.append("# HELP request_duration_ms Recent request durations (last 500), avg")
        lines.append("# TYPE request_duration_ms gauge")
        for (method, path), dq in sorted(request_duration_ms.items()):
            avg = (sum(d)/len(d) if d else 0.0)
            lines.append(f'request_duration_ms{{method="{method}",path="{path}"}} {avg:.2f}')
        return PlainTextResponse("\n".join(lines) + "\n", media_type="text/plain")
    by_key = {f"{m} {p} {s}": c for (m,p,s), c in requests_total.items()}
    avg_ms = {f"{m} {p}": (sum(d)/len(d) if d else 0.0) for (m,p), d in request_duration_ms.items()}
    return {"requests_total": by_key, "request_duration_ms_avg": avg_ms}
