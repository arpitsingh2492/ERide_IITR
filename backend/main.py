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
from fastapi.responses import FileResponse, HTMLResponse

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

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if not FRONTEND_DIR.exists():
    # Fallback to current working directory or parent check
    if (Path.cwd() / "frontend").exists():
        FRONTEND_DIR = Path.cwd() / "frontend"
    elif (Path.cwd().parent / "frontend").exists():
        FRONTEND_DIR = Path.cwd().parent / "frontend"

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


# ── Root / Index Route ───────────────────────────────────────────────────────


@app.get("/")
async def serve_index():
    """Explicitly serve index.html or diagnostic info if not found."""
    if not FRONTEND_DIR.exists() or not (FRONTEND_DIR / "index.html").exists():
        cwd_files = []
        try:
            cwd_files = [p.name for p in Path.cwd().iterdir()]
        except Exception:
            pass
        return HTMLResponse(
            status_code=404,
            content=f"""
            <html>
            <head>
                <title>Frontend Not Found</title>
                <style>
                    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 2rem; background: #0f172a; color: #f1f5f9; line-height: 1.5; }}
                    .card {{ background: #1e293b; border-radius: 8px; padding: 2rem; max-width: 600px; margin: auto; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); border: 1px solid #334155; }}
                    h1 {{ color: #f43f5e; margin-top: 0; }}
                    code {{ background: #0f172a; padding: 0.2rem 0.4rem; border-radius: 4px; color: #fda4af; font-family: monospace; }}
                    ul {{ padding-left: 1.2rem; }}
                    li {{ margin-bottom: 0.5rem; }}
                </style>
            </head>
            <body>
                <div class="card">
                    <h1>🛺 ERide Frontend Not Found</h1>
                    <p>The backend server is running successfully, but the static frontend files could not be located.</p>
                    <hr style="border: 0; border-top: 1px solid #334155; margin: 1.5rem 0;" />
                    <h3>Diagnostic Details:</h3>
                    <ul>
                        <li><strong>Expected Path:</strong> <code>{FRONTEND_DIR.resolve() if FRONTEND_DIR else 'None'}</code></li>
                        <li><strong>Folder Exists:</strong> <code>{FRONTEND_DIR.exists() if FRONTEND_DIR else 'False'}</code></li>
                        <li><strong>Working Dir (CWD):</strong> <code>{Path.cwd().resolve()}</code></li>
                        <li><strong>Files in CWD:</strong> <code>{cwd_files}</code></li>
                    </ul>
                    <p style="margin-bottom: 0; font-size: 0.9rem; color: #94a3b8;">
                        Please verify your deployment settings to ensure that the <code>frontend</code> folder is copied and uvicorn is started from the correct root directory.
                    </p>
                </div>
            </body>
            </html>
            """
        )
    return FileResponse(FRONTEND_DIR / "index.html")


# ── Static files (frontend) ─────────────────────────────────────────────────

if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
    logger.info("Serving frontend from %s", FRONTEND_DIR)
else:
    logger.warning("Frontend directory not found at %s — static files will not be served.", FRONTEND_DIR)

