"""JWT authentication and auth routes for ERide.

Uses bcrypt for password hashing and PyJWT for token management.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel

from backend.models import UserLogin, UserRegister, ProfileUpdate
from backend.database import create_user, get_user_by_id, get_user_by_phone, update_user_profile

# ── Configuration ────────────────────────────────────────────────────────────

SECRET_KEY = "eride-iitr-secret-key-2024"
ALGORITHM = "HS256"
TOKEN_EXPIRY_HOURS = 24

router = APIRouter(prefix="/api/auth", tags=["auth"])


# ── Password Utilities ───────────────────────────────────────────────────────


def hash_password(password: str) -> str:
    """Hash a plain-text password with bcrypt."""
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    """Check a plain-text password against a bcrypt hash."""
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))


# ── JWT Utilities ────────────────────────────────────────────────────────────


def create_token(user_id: str, role: str) -> str:
    """Create a signed JWT token."""
    payload = {
        "user_id": user_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRY_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    """Decode and validate a JWT token."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return {"user_id": payload["user_id"], "role": payload["role"]}
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )


# ── Helper: extract token from header ───────────────────────────────────────


def _extract_bearer_token(authorization: str) -> str:
    """Pull the raw token from an ``Authorization: Bearer <token>`` header."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authorization header",
        )
    return authorization[7:]


# ── Helper: build safe user response (no password hash) ─────────────────────


def _safe_user(user: dict) -> dict:
    """Return a user dict without the password hash."""
    return {
        "id": user["id"],
        "name": user["name"],
        "phone": user["phone"],
        "role": user["role"],
        "vehicle_number": user.get("vehicle_number"),
        "license_number": user.get("license_number"),
        "upi_id": user.get("upi_id"),
        "qr_base64": user.get("qr_base64"),
        "created_at": user["created_at"],
    }


# ── Routes ───────────────────────────────────────────────────────────────────


@router.post("/register")
async def register(data: UserRegister):
    """Register a new rider or driver account.

    Returns a JWT token and the created user profile.
    """
    # Check for duplicate phone
    existing = await get_user_by_phone(data.phone)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Phone number already registered",
        )

    hashed = hash_password(data.password)
    user = await create_user(
        name=data.name,
        phone=data.phone,
        password_hash=hashed,
        role=data.role,
        vehicle_number=getattr(data, "vehicle_number", None),
        license_number=getattr(data, "license_number", None),
        upi_id=getattr(data, "upi_id", None),
        qr_base64=getattr(data, "qr_base64", None),
    )
    token = create_token(user["id"], user["role"])

    return {
        "token": token,
        "user": _safe_user(user),
    }


@router.post("/login")
async def login(data: UserLogin):
    """Authenticate with phone + password and receive a JWT token."""
    user = await get_user_by_phone(data.phone)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid phone or password",
        )

    if not verify_password(data.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid phone or password",
        )

    token = create_token(user["id"], user["role"])
    return {
        "token": token,
        "user": _safe_user(user),
    }


@router.get("/me")
async def get_current_user(authorization: str = Header(None)):
    """Return the currently authenticated user's profile."""
    raw_token = _extract_bearer_token(authorization)
    token_data = decode_token(raw_token)
    user = await get_user_by_id(token_data["user_id"])

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return {"user": _safe_user(user)}


@router.put("/profile")
async def update_profile(data: ProfileUpdate, authorization: str = Header(None)):
    """Update profile details of currently authenticated rider or driver."""
    raw_token = _extract_bearer_token(authorization)
    token_data = decode_token(raw_token)
    user_id = token_data["user_id"]

    # Verify new phone is unique
    existing = await get_user_by_phone(data.phone)
    if existing and existing["id"] != user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Phone number is already registered to another user",
        )

    hashed_pw = None
    if data.password:
        hashed_pw = hash_password(data.password)

    updated_user = await update_user_profile(
        user_id=user_id,
        name=data.name,
        phone=data.phone,
        password_hash=hashed_pw,
        vehicle_number=data.vehicle_number,
        license_number=data.license_number,
        upi_id=data.upi_id,
        qr_base64=data.qr_base64,
    )

    if not updated_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User profile not found",
        )

    return {"user": _safe_user(updated_user)}
