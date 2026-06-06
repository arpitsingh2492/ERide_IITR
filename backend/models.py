"""Pydantic models and WebSocket message type constants for ERide."""

from pydantic import BaseModel, field_validator


# ── Pydantic Request Models ──────────────────────────────────────────────────


class UserRegister(BaseModel):
    """Schema for user registration."""

    name: str
    phone: str  # 10-digit Indian mobile number
    password: str
    role: str  # 'rider' or 'driver'
    vehicle_number: str | None = None
    license_number: str | None = None
    upi_id: str | None = None
    qr_base64: str | None = None

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        if not v.isdigit() or len(v) != 10:
            raise ValueError("Phone must be exactly 10 digits")
        return v

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in ("rider", "driver"):
            raise ValueError("Role must be 'rider' or 'driver'")
        return v

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name cannot be empty")
        return v.strip()

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 4:
            raise ValueError("Password must be at least 4 characters")
        return v


class UserLogin(BaseModel):
    """Schema for user login."""

    phone: str
    password: str


class RideCreate(BaseModel):
    """Schema for creating a new ride request (on-demand)."""

    pickup_lat: float
    pickup_lng: float
    pickup_name: str
    dest_lat: float
    dest_lng: float
    dest_name: str

    @field_validator("pickup_name", "dest_name")
    @classmethod
    def validate_location_name(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Location name cannot be empty")
        return v.strip()


class RideSchedule(BaseModel):
    """Schema for scheduling a ride in the future."""

    pickup_lat: float
    pickup_lng: float
    pickup_name: str
    dest_lat: float
    dest_lng: float
    dest_name: str
    scheduled_time: str  # ISO string representation, e.g. "2026-06-07T14:30:00"


class RideRate(BaseModel):
    """Schema for submitting ratings and written comments."""

    rating: int
    feedback: str | None = None

    @field_validator("rating")
    @classmethod
    def validate_rating(cls, v: int) -> int:
        if v < 1 or v > 5:
            raise ValueError("Rating must be between 1 and 5 stars")
        return v


class ProfileUpdate(BaseModel):
    """Schema for updating user account details."""
    name: str
    phone: str
    password: str | None = None
    vehicle_number: str | None = None
    license_number: str | None = None
    upi_id: str | None = None
    qr_base64: str | None = None


# ── WebSocket Message Type Constants ─────────────────────────────────────────

WS_RIDE_REQUEST = "RIDE_REQUEST"
WS_RIDE_ACCEPTED = "RIDE_ACCEPTED"
WS_RIDE_STARTED = "RIDE_STARTED"
WS_RIDE_CANCELLED = "RIDE_CANCELLED"
WS_LOCATION_UPDATE = "LOCATION_UPDATE"
WS_RIDE_COMPLETED = "RIDE_COMPLETED"
WS_RIDE_RATED = "RIDE_RATED"
WS_DRIVER_ONLINE = "DRIVER_ONLINE"
WS_DRIVER_OFFLINE = "DRIVER_OFFLINE"
WS_DRIVER_LOCATIONS = "DRIVER_LOCATIONS"
WS_ETA_UPDATE = "ETA_UPDATE"
WS_ERROR = "ERROR"
