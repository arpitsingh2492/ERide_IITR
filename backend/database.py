"""Async MongoDB database layer for ERide using Motor."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorClient
from bson.objectid import ObjectId
from bson.errors import InvalidId
from dotenv import load_dotenv

# Load environment variables from the project root .env file
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(env_path)

MONGODB_URI = os.getenv("MONGODB_URI")
if not MONGODB_URI:
    raise RuntimeError("MONGODB_URI is not set in the environment or .env file")

# Global MongoDB client
client = AsyncIOMotorClient(MONGODB_URI)
# Use the database specified in the URI (we added /eride to the end)
db = client.get_default_database("eride")


async def init_db() -> None:
    """Initialize MongoDB collections and indexes."""
    # Ensure phone numbers are unique in the users collection
    await db.users.create_index("phone", unique=True)


# ── Helper: MongoDB Document → dict ──────────────────────────────────────────


def _doc_to_dict(doc: dict | None) -> dict | None:
    """Convert a MongoDB document to a standard dict, mapping _id to string id."""
    if doc is None:
        return None
    # Convert ObjectId to string and rename '_id' to 'id'
    doc["id"] = str(doc.pop("_id"))
    
    # Convert any other ObjectIds (like rider_id, driver_id) to strings
    if "rider_id" in doc and doc["rider_id"] is not None:
        doc["rider_id"] = str(doc["rider_id"])
    if "driver_id" in doc and doc["driver_id"] is not None:
        doc["driver_id"] = str(doc["driver_id"])
        
    return doc


def _safe_object_id(id_str: str) -> ObjectId | None:
    """Safely parse an ObjectId from a string, returning None if invalid."""
    try:
        return ObjectId(id_str)
    except InvalidId:
        return None


# ── User CRUD ────────────────────────────────────────────────────────────────


async def create_user(
    name: str,
    phone: str,
    password_hash: str,
    role: str,
    vehicle_number: str | None = None,
    license_number: str | None = None,
    upi_id: str | None = None,
    qr_base64: str | None = None,
) -> dict:
    """Insert a new user and return the created user dict."""
    now = datetime.now(timezone.utc).isoformat()
    
    user_doc = {
        "name": name,
        "phone": phone,
        "password_hash": password_hash,
        "role": role,
        "vehicle_number": vehicle_number,
        "license_number": license_number,
        "upi_id": upi_id,
        "qr_base64": qr_base64,
        "created_at": now,
    }
    
    result = await db.users.insert_one(user_doc)
    
    # Fetch the inserted document to ensure we return it consistently
    doc = await db.users.find_one({"_id": result.inserted_id})
    return _doc_to_dict(doc)


async def get_user_by_phone(phone: str) -> dict | None:
    """Look up a user by phone number."""
    doc = await db.users.find_one({"phone": phone})
    return _doc_to_dict(doc)


async def get_user_by_id(user_id: str) -> dict | None:
    """Look up a user by primary key (ObjectId string)."""
    oid = _safe_object_id(user_id)
    if not oid:
        return None
    doc = await db.users.find_one({"_id": oid})
    return _doc_to_dict(doc)


async def update_user_profile(
    user_id: str,
    name: str,
    phone: str,
    password_hash: str | None = None,
    vehicle_number: str | None = None,
    license_number: str | None = None,
    upi_id: str | None = None,
    qr_base64: str | None = None,
) -> dict | None:
    """Update user profile information. Null values mean no update."""
    oid = _safe_object_id(user_id)
    if not oid:
        return None
        
    update_fields = {"name": name, "phone": phone}

    if password_hash:
        update_fields["password_hash"] = password_hash
    if vehicle_number is not None:
        update_fields["vehicle_number"] = vehicle_number
    if license_number is not None:
        update_fields["license_number"] = license_number
    if upi_id is not None:
        update_fields["upi_id"] = upi_id
    if qr_base64 is not None:
        update_fields["qr_base64"] = qr_base64

    await db.users.update_one({"_id": oid}, {"$set": update_fields})
    
    doc = await db.users.find_one({"_id": oid})
    return _doc_to_dict(doc)


# ── Ride CRUD ────────────────────────────────────────────────────────────────


async def create_ride(
    rider_id: str,
    pickup_lat: float,
    pickup_lng: float,
    pickup_name: str,
    dest_lat: float,
    dest_lng: float,
    dest_name: str,
    scheduled_time: str | None = None,
) -> dict:
    """Create a new ride request (either on-demand or scheduled)."""
    now = datetime.now(timezone.utc).isoformat()
    initial_status = "scheduled" if scheduled_time else "requested"
    
    ride_doc = {
        "rider_id": _safe_object_id(rider_id),
        "driver_id": None,
        "pickup_lat": pickup_lat,
        "pickup_lng": pickup_lng,
        "pickup_name": pickup_name,
        "dest_lat": dest_lat,
        "dest_lng": dest_lng,
        "dest_name": dest_name,
        "status": initial_status,
        "scheduled_time": scheduled_time,
        "rating": None,
        "feedback": None,
        "created_at": now,
        "accepted_at": None,
        "completed_at": None,
    }
    
    result = await db.rides.insert_one(ride_doc)
    doc = await db.rides.find_one({"_id": result.inserted_id})
    return _doc_to_dict(doc)


async def update_ride_status(
    ride_id: str, status: str, driver_id: str | None = None
) -> dict | None:
    """Update a ride's status and optionally assign a driver."""
    now = datetime.now(timezone.utc).isoformat()
    oid = _safe_object_id(ride_id)
    if not oid:
        return None
        
    update_fields = {"status": status}

    if driver_id is not None:
        update_fields["driver_id"] = _safe_object_id(driver_id)

    if status == "accepted":
        update_fields["accepted_at"] = now
    elif status in ("completed", "cancelled"):
        update_fields["completed_at"] = now

    await db.rides.update_one({"_id": oid}, {"$set": update_fields})
    
    doc = await db.rides.find_one({"_id": oid})
    return _doc_to_dict(doc)


async def get_ride(ride_id: str) -> dict | None:
    """Fetch a single ride by ID."""
    oid = _safe_object_id(ride_id)
    if not oid:
        return None
    doc = await db.rides.find_one({"_id": oid})
    return _doc_to_dict(doc)


async def get_rides_for_user(user_id: str, role: str) -> list[dict]:
    """Get all rides associated with a user."""
    oid = _safe_object_id(user_id)
    if not oid:
        return []
        
    column = "rider_id" if role == "rider" else "driver_id"
    cursor = db.rides.find({column: oid}).sort("created_at", -1)
    
    rows = await cursor.to_list(length=1000)
    return [_doc_to_dict(r) for r in rows]


# ── Specialized Queries (Ratings, Analytics, Scheduling) ──────────────────


async def add_ride_rating(ride_id: str, rating: int, feedback: str | None = None) -> dict | None:
    """Submit a star rating and written feedback comment for a ride."""
    oid = _safe_object_id(ride_id)
    if not oid:
        return None
        
    await db.rides.update_one(
        {"_id": oid}, 
        {"$set": {"rating": rating, "feedback": feedback}}
    )
    
    doc = await db.rides.find_one({"_id": oid})
    return _doc_to_dict(doc)


async def get_driver_stats(driver_id: str) -> dict:
    """Aggregate statistics and feedback for a driver's dashboard."""
    oid = _safe_object_id(driver_id)
    if not oid:
        return {
            "completed_rides": 0,
            "active_rides": 0,
            "average_rating": 0.0,
            "ratings_count": 0,
            "feedbacks": []
        }

    completed_count = await db.rides.count_documents({"driver_id": oid, "status": "completed"})
    active_count = await db.rides.count_documents({"driver_id": oid, "status": {"$in": ["accepted", "in_progress"]}})

    # Calculate average rating using aggregation
    pipeline = [
        {"$match": {"driver_id": oid, "rating": {"$ne": None}}},
        {"$group": {"_id": None, "avg_rating": {"$avg": "$rating"}, "count": {"$sum": 1}}}
    ]
    rating_stats = await db.rides.aggregate(pipeline).to_list(length=1)
    
    if rating_stats:
        avg_rating = round(rating_stats[0]["avg_rating"], 2)
        ratings_count = rating_stats[0]["count"]
    else:
        avg_rating = 0.0
        ratings_count = 0

    # Get recent feedbacks
    cursor = db.rides.find(
        {"driver_id": oid, "feedback": {"$ne": None, "$ne": ""}},
        {"rating": 1, "feedback": 1, "created_at": 1}
    ).sort("created_at", -1).limit(10)
    
    feedbacks = await cursor.to_list(length=10)
    feedbacks = [_doc_to_dict(f) for f in feedbacks]

    return {
        "completed_rides": completed_count,
        "active_rides": active_count,
        "average_rating": avg_rating,
        "ratings_count": ratings_count,
        "feedbacks": feedbacks
    }


async def get_scheduled_rides() -> list[dict]:
    """Retrieve all open scheduled rides waiting for a driver."""
    cursor = db.rides.find(
        {"status": "scheduled", "driver_id": None}
    ).sort("scheduled_time", 1)
    
    rows = await cursor.to_list(length=100)
    return [_doc_to_dict(r) for r in rows]


async def claim_scheduled_ride(ride_id: str, driver_id: str) -> dict | None:
    """Assign a driver to a scheduled ride and update its status to accepted."""
    now = datetime.now(timezone.utc).isoformat()
    ride_oid = _safe_object_id(ride_id)
    driver_oid = _safe_object_id(driver_id)
    
    if not ride_oid or not driver_oid:
        return None
        
    result = await db.rides.update_one(
        {"_id": ride_oid, "status": "scheduled"},
        {"$set": {
            "driver_id": driver_oid,
            "status": "accepted",
            "accepted_at": now
        }}
    )
    
    if result.modified_count == 0:
        return None # Ride might have been claimed by someone else or doesn't exist
        
    doc = await db.rides.find_one({"_id": ride_oid})
    return _doc_to_dict(doc)


async def get_all_rides() -> list[dict]:
    """Get all rides in the system."""
    cursor = db.rides.find().sort("created_at", -1)
    rows = await cursor.to_list(length=1000)
    return [_doc_to_dict(r) for r in rows]
