import time
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.endpoints import telemetry, auth, battery
from app.db.database import create_db_and_tables

# Configure logging format to emphasize latency tracking and neuromorphic events
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger("neurocharge")

from sqlmodel import Session, select
from app.db.database import create_db_and_tables, engine
from app.models.user import User
from app.models.prediction import BatteryPrediction
from app.core.security import get_password_hash

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize SQLModel database tables on server start
    create_db_and_tables()
    
    # Seed default admin user if it does not exist
    with Session(engine) as db:
        statement = select(User).where(User.email == "admin@neurocharge.com")
        admin = db.exec(statement).first()
        if not admin:
            logger.info("Seeding default administrator account...")
            hashed_pwd = get_password_hash("adminpassword123")
            admin_user = User(
                email="admin@neurocharge.com",
                hashed_password=hashed_pwd,
                full_name="NeuroCharge Admin",
                role="admin"
            )
            db.add(admin_user)
            db.commit()
            logger.info("Default administrator seeded: admin@neurocharge.com / adminpassword123")
    yield

app = FastAPI(
    title=settings.APP_NAME,
    description="Brain-inspired EV Battery Intelligence Platform API",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for Next.js frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict this to specific domains in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Custom middleware to monitor endpoint latencies and log alerts if response time exceeds 500ms
@app.middleware("http")
async def latency_monitoring_middleware(request: Request, call_next):
    start_time = time.perf_counter()
    response = await call_next(request)
    process_time_ms = (time.perf_counter() - start_time) * 1000.0
    
    # Exclude basic paths from logging warnings
    if not request.url.path.startswith("/docs") and not request.url.path.startswith("/openapi.json"):
        log_msg = f"{request.method} {request.url.path} processed in {process_time_ms:.2f}ms"
        
        if process_time_ms > settings.LATENCY_WARNING_THRESHOLD_MS:
            logger.warning(f"[LATENCY ALERT] {log_msg} (Exceeded target threshold of {settings.LATENCY_WARNING_THRESHOLD_MS}ms)")
        else:
            logger.info(log_msg)
            
        # Add latency details directly in the response headers for monitoring
        response.headers["X-Process-Time-Ms"] = f"{process_time_ms:.2f}"
        
    return response

# Include endpoint routes
app.include_router(auth.router, prefix=settings.API_V1_STR, tags=["auth"])
app.include_router(telemetry.router, prefix=settings.API_V1_STR, tags=["telemetry"])
app.include_router(battery.router, prefix=f"{settings.API_V1_STR}/battery", tags=["battery"])

@app.get("/", tags=["health"])
async def root():
    return {
        "status": "healthy",
        "app": settings.APP_NAME,
        "environment": settings.APP_ENV
    }
