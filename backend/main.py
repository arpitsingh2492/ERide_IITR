"""ERide FastAPI application entry point.

Run with:
    cd d:\\ERide
    python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.auth import decode_token, router as auth_router
from backend.database import get_user_by_id, init_db
from backend.routes_ride import router as ride_router
from backend.websocket_manager import handle_websocket

# ── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("eride")

# ── Paths ────────────────────────────────────────────────────────────────────

FRONTEND_DIR = Path("d:/ERide/frontend")

# ── App lifecycle ────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize the database on startup."""
    logger.info("Initializing database…")
    await init_db()
    logger.info("Database ready.")
    yield
    logger.info("Shutting down ERide backend.")


# ── FastAPI application ─────────────────────────────────────────────────────

app = FastAPI(
    title="ERide – IIT Roorkee E-Rickshaw",
    description="Real-time e-rickshaw ride-hailing backend for IIT Roorkee campus.",
    version="1.0.0",
    lifespan=lifespan,
)

# ── CORS ─────────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ──────────────────────────────────────────────────────────────────

app.include_router(auth_router)
app.include_router(ride_router)

# ── Health check ─────────────────────────────────────────────────────────────


@app.get("/api/health", tags=["health"])
async def health_check():
    """Simple liveness probe."""
    return {"status": "ok", "service": "eride-backend"}


# ── WebSocket endpoint ───────────────────────────────────────────────────────


@app.websocket("/ws/{token}")
async def websocket_endpoint(websocket: WebSocket, token: str):
    """Authenticated WebSocket endpoint.

    The client connects with its JWT token in the URL path. The token is
    decoded to identify the user and their role before handing off to the
    connection manager.
    """
    try:
        token_data = decode_token(token)
    except Exception:
        await websocket.close(code=4001, reason="Invalid or expired token")
        return

    user = await get_user_by_id(token_data["user_id"])
    if not user:
        await websocket.close(code=4002, reason="User not found")
        return

    logger.info(
        "WebSocket connection: user_id=%d, role=%s",
        user["id"],
        user["role"],
    )

    await handle_websocket(websocket, user["id"], user["role"])


# ── Static files (frontend) ─────────────────────────────────────────────────

if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
    logger.info("Serving frontend from %s", FRONTEND_DIR)
else:
    logger.warning("Frontend directory not found at %s — static files will not be served.", FRONTEND_DIR)
