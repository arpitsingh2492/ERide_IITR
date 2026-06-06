"""Async SQLite database layer for ERide.

Uses aiosqlite for non-blocking database operations. The database file is
stored at ``d:/ERide/backend/eride.db``.
"""

from __future__ import annotations

import aiosqlite
from datetime import datetime, timezone
from pathlib import Path

DATABASE_PATH = str(Path(__file__).resolve().parent / "eride.db")


async def get_db() -> aiosqlite.Connection:
    """Open and return an async SQLite connection with row-factory enabled.

    The caller is responsible for closing the connection.
    """
    db = await aiosqlite.connect(DATABASE_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    return db


async def init_db() -> None:
    """Create the ``users`` and ``rides`` tables if they don't already exist."""
    db = await get_db()
    try:
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT    NOT NULL,
                phone       TEXT    NOT NULL UNIQUE,
                password_hash TEXT  NOT NULL,
                role        TEXT    NOT NULL CHECK(role IN ('rider', 'driver')),
                vehicle_number TEXT,
                license_number TEXT,
                upi_id      TEXT,
                qr_base64   TEXT,
                created_at  TEXT    NOT NULL
            )
            """
        )
        # Safely try to alter table to add the column if database exists from before
        try:
            await db.execute("ALTER TABLE users ADD COLUMN qr_base64 TEXT")
        except Exception:
            pass

        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS rides (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                rider_id     INTEGER NOT NULL REFERENCES users(id),
                driver_id    INTEGER          REFERENCES users(id),
                pickup_lat   REAL    NOT NULL,
                pickup_lng   REAL    NOT NULL,
                pickup_name  TEXT    NOT NULL,
                dest_lat     REAL    NOT NULL,
                dest_lng     REAL    NOT NULL,
                dest_name    TEXT    NOT NULL,
                status       TEXT    NOT NULL DEFAULT 'requested'
                                     CHECK(status IN (
                                         'requested', 'accepted', 'in_progress',
                                         'completed', 'cancelled', 'scheduled'
                                     )),
                scheduled_time TEXT,
                rating       INTEGER  CHECK(rating BETWEEN 1 AND 5),
                feedback     TEXT,
                created_at   TEXT    NOT NULL,
                accepted_at  TEXT,
                completed_at TEXT
            )
            """
        )
        await db.commit()
    finally:
        await db.close()


# ── Helper: row → dict ──────────────────────────────────────────────────────


def _row_to_dict(row: aiosqlite.Row | None) -> dict | None:
    """Convert an ``aiosqlite.Row`` to a plain ``dict``, or return None."""
    if row is None:
        return None
    return dict(row)


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
    db = await get_db()
    try:
        cursor = await db.execute(
            "INSERT INTO users (name, phone, password_hash, role, vehicle_number, license_number, upi_id, qr_base64, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (name, phone, password_hash, role, vehicle_number, license_number, upi_id, qr_base64, now),
        )
        await db.commit()
        user_id = cursor.lastrowid

        return {
            "id": user_id,
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
    finally:
        await db.close()


async def get_user_by_phone(phone: str) -> dict | None:
    """Look up a user by phone number."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM users WHERE phone = ?", (phone,))
        row = await cursor.fetchone()
        return _row_to_dict(row)
    finally:
        await db.close()


async def get_user_by_id(user_id: int) -> dict | None:
    """Look up a user by primary key."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        row = await cursor.fetchone()
        return _row_to_dict(row)
    finally:
        await db.close()


async def update_user_profile(
    user_id: int,
    name: str,
    phone: str,
    password_hash: str | None = None,
    vehicle_number: str | None = None,
    license_number: str | None = None,
    upi_id: str | None = None,
    qr_base64: str | None = None,
) -> dict | None:
    """Update user profile information. Null values mean no update."""
    db = await get_db()
    try:
        fields = ["name = ?", "phone = ?"]
        params = [name, phone]

        if password_hash:
            fields.append("password_hash = ?")
            params.append(password_hash)
        if vehicle_number is not None:
            fields.append("vehicle_number = ?")
            params.append(vehicle_number)
        if license_number is not None:
            fields.append("license_number = ?")
            params.append(license_number)
        if upi_id is not None:
            fields.append("upi_id = ?")
            params.append(upi_id)
        if qr_base64 is not None:
            fields.append("qr_base64 = ?")
            params.append(qr_base64)

        params.append(user_id)
        await db.execute(f"UPDATE users SET {', '.join(fields)} WHERE id = ?", params)
        await db.commit()

        cursor = await db.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        row = await cursor.fetchone()
        return _row_to_dict(row)
    finally:
        await db.close()


# ── Ride CRUD ────────────────────────────────────────────────────────────────


async def create_ride(
    rider_id: int,
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
    db = await get_db()
    try:
        cursor = await db.execute(
            """
            INSERT INTO rides
                (rider_id, pickup_lat, pickup_lng, pickup_name,
                 dest_lat, dest_lng, dest_name, status, scheduled_time, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rider_id,
                pickup_lat,
                pickup_lng,
                pickup_name,
                dest_lat,
                dest_lng,
                dest_name,
                initial_status,
                scheduled_time,
                now,
            ),
        )
        await db.commit()
        ride_id = cursor.lastrowid

        return {
            "id": ride_id,
            "rider_id": rider_id,
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
    finally:
        await db.close()


async def update_ride_status(
    ride_id: int, status: str, driver_id: int | None = None
) -> dict | None:
    """Update a ride's status and optionally assign a driver."""
    now = datetime.now(timezone.utc).isoformat()
    db = await get_db()
    try:
        fields = ["status = ?"]
        params: list = [status]

        if driver_id is not None:
            fields.append("driver_id = ?")
            params.append(driver_id)

        if status == "accepted":
            fields.append("accepted_at = ?")
            params.append(now)
        elif status in ("completed", "cancelled"):
            fields.append("completed_at = ?")
            params.append(now)

        params.append(ride_id)

        await db.execute(
            f"UPDATE rides SET {', '.join(fields)} WHERE id = ?",
            params,
        )
        await db.commit()

        cursor = await db.execute("SELECT * FROM rides WHERE id = ?", (ride_id,))
        row = await cursor.fetchone()
        return _row_to_dict(row)
    finally:
        await db.close()


async def get_ride(ride_id: int) -> dict | None:
    """Fetch a single ride by ID."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM rides WHERE id = ?", (ride_id,))
        row = await cursor.fetchone()
        return _row_to_dict(row)
    finally:
        await db.close()


async def get_rides_for_user(user_id: int, role: str) -> list[dict]:
    """Get all rides associated with a user."""
    db = await get_db()
    try:
        column = "rider_id" if role == "rider" else "driver_id"
        cursor = await db.execute(
            f"SELECT * FROM rides WHERE {column} = ? ORDER BY created_at DESC",
            (user_id,),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


# ── Specialized Queries (Ratings, Analytics, Scheduling) ──────────────────


async def add_ride_rating(ride_id: int, rating: int, feedback: str | None = None) -> dict | None:
    """Submit a star rating and written feedback comment for a ride."""
    db = await get_db()
    try:
        await db.execute(
            "UPDATE rides SET rating = ?, feedback = ? WHERE id = ?",
            (rating, feedback, ride_id)
        )
        await db.commit()

        cursor = await db.execute("SELECT * FROM rides WHERE id = ?", (ride_id,))
        row = await cursor.fetchone()
        return _row_to_dict(row)
    finally:
        await db.close()


async def get_driver_stats(driver_id: int) -> dict:
    """Aggregate statistics and feedback for a driver's dashboard."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT COUNT(*) FROM rides WHERE driver_id = ? AND status = 'completed'", (driver_id,))
        completed_count = (await cursor.fetchone())[0]

        cursor = await db.execute("SELECT COUNT(*) FROM rides WHERE driver_id = ? AND status IN ('accepted', 'in_progress')", (driver_id,))
        active_count = (await cursor.fetchone())[0]

        cursor = await db.execute("SELECT AVG(rating), COUNT(rating) FROM rides WHERE driver_id = ? AND rating IS NOT NULL", (driver_id,))
        row = await cursor.fetchone()
        avg_rating = round(row[0], 2) if row[0] is not None else 0.0
        ratings_count = row[1]

        cursor = await db.execute(
            "SELECT rating, feedback, created_at FROM rides WHERE driver_id = ? AND feedback IS NOT NULL AND feedback != '' ORDER BY created_at DESC LIMIT 10",
            (driver_id,)
        )
        feedbacks = [dict(r) for r in await cursor.fetchall()]

        return {
            "completed_rides": completed_count,
            "active_rides": active_count,
            "average_rating": avg_rating,
            "ratings_count": ratings_count,
            "feedbacks": feedbacks
        }
    finally:
        await db.close()


async def get_scheduled_rides() -> list[dict]:
    """Retrieve all open scheduled rides waiting for a driver."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM rides WHERE status = 'scheduled' AND driver_id IS NULL ORDER BY scheduled_time ASC")
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


async def claim_scheduled_ride(ride_id: int, driver_id: int) -> dict | None:
    """Assign a driver to a scheduled ride and update its status to accepted."""
    now = datetime.now(timezone.utc).isoformat()
    db = await get_db()
    try:
        await db.execute(
            "UPDATE rides SET driver_id = ?, status = 'accepted', accepted_at = ? WHERE id = ? AND status = 'scheduled'",
            (driver_id, now, ride_id)
        )
        await db.commit()

        cursor = await db.execute("SELECT * FROM rides WHERE id = ?", (ride_id,))
        row = await cursor.fetchone()
        return _row_to_dict(row)
    finally:
        await db.close()


async def get_all_rides() -> list[dict]:
    """Get all rides in the system."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM rides ORDER BY created_at DESC")
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()
