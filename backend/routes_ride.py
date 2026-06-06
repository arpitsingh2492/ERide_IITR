"""REST routes for ride history, ratings, scheduling, and analytics."""

from __future__ import annotations

from datetime import datetime, timezone
from fastapi import APIRouter, Header, HTTPException, status

from backend.auth import _extract_bearer_token, decode_token
from backend.database import (
    add_ride_rating,
    claim_scheduled_ride,
    create_ride,
    get_all_rides,
    get_driver_stats,
    get_ride,
    get_rides_for_user,
    get_scheduled_rides,
    get_user_by_id,
)
from backend.models import RideRate, RideSchedule, WS_RIDE_RATED
from backend.websocket_manager import manager

router = APIRouter(prefix="/api/rides", tags=["rides"])


@router.get("/history")
async def ride_history(authorization: str = Header(None)):
    """Return the authenticated user's ride history (newest first)."""
    raw_token = _extract_bearer_token(authorization)
    token_data = decode_token(raw_token)
    user_id = token_data["user_id"]
    role = token_data["role"]

    user = await get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    rides = await get_rides_for_user(user_id, role)
    return {"rides": rides}


@router.get("/scheduled/available")
async def available_schedules(authorization: str = Header(None)):
    """Retrieve unclaimed scheduled rides. Only available for drivers."""
    raw_token = _extract_bearer_token(authorization)
    token_data = decode_token(raw_token)
    role = token_data["role"]

    if role != "driver":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only drivers can view available scheduled rides",
        )

    rides = await get_scheduled_rides()
    return {"rides": rides}


@router.post("/scheduled/{ride_id}/claim")
async def claim_booking(ride_id: str, authorization: str = Header(None)):
    """Let a driver claim a scheduled ride."""
    raw_token = _extract_bearer_token(authorization)
    token_data = decode_token(raw_token)
    user_id = token_data["user_id"]
    role = token_data["role"]

    if role != "driver":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only drivers can claim scheduled rides",
        )

    ride = await get_ride(ride_id)
    if not ride:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ride booking not found")

    if ride["status"] != "scheduled" or ride["driver_id"] is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ride is already claimed or not in scheduled state",
        )

    updated_ride = await claim_scheduled_ride(ride_id, user_id)
    return {"ride": updated_ride}


@router.post("/schedule")
async def schedule_new_ride(data: RideSchedule, authorization: str = Header(None)):
    """Create a new future scheduled ride request."""
    raw_token = _extract_bearer_token(authorization)
    token_data = decode_token(raw_token)
    user_id = token_data["user_id"]

    ride = await create_ride(
        rider_id=user_id,
        pickup_lat=data.pickup_lat,
        pickup_lng=data.pickup_lng,
        pickup_name=data.pickup_name,
        dest_lat=data.dest_lat,
        dest_lng=data.dest_lng,
        dest_name=data.dest_name,
        scheduled_time=data.scheduled_time,
    )
    return {"ride": ride}


@router.post("/{ride_id}/rate")
async def rate_ride(ride_id: str, data: RideRate, authorization: str = Header(None)):
    """Submit a rating and comment feedback for a completed ride.

    Pushes a real-time notification to the driver if they are connected.
    """
    raw_token = _extract_bearer_token(authorization)
    token_data = decode_token(raw_token)
    user_id = token_data["user_id"]

    ride = await get_ride(ride_id)
    if not ride:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ride not found")

    if ride["rider_id"] != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the rider of this ride can submit feedback",
        )

    if ride["status"] != "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can only rate completed rides",
        )

    updated_ride = await add_ride_rating(ride_id, data.rating, data.feedback)

    # Notify driver via WebSockets
    driver_id = ride.get("driver_id")
    if driver_id:
        await manager.send_to_driver(
            driver_id,
            {
                "type": WS_RIDE_RATED,
                "data": {
                    "ride_id": ride_id,
                    "rating": data.rating,
                    "feedback": data.feedback or "",
                }
            }
        )

    return {"ride": updated_ride}


@router.get("/stats/driver")
async def driver_dashboard_stats(authorization: str = Header(None)):
    """Get statistics, reviews, and summaries for driver dashboard."""
    raw_token = _extract_bearer_token(authorization)
    token_data = decode_token(raw_token)
    user_id = token_data["user_id"]
    role = token_data["role"]

    if role != "driver":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only drivers have dashboard statistics",
        )

    stats = await get_driver_stats(user_id)
    return stats


@router.get("/analytics/demand")
async def demand_analytics(authorization: str = Header(None)):
    """Aggregate historical completed ride coordinates and hourly patterns."""
    raw_token = _extract_bearer_token(authorization)
    decode_token(raw_token)

    all_rides = await get_all_rides()

    hourly_counts = {h: 0 for h in range(24)}
    location_counts: dict[str, int] = {}

    for ride in all_rides:
        if ride["status"] != "completed":
            continue

        try:
            dt = datetime.fromisoformat(ride["created_at"])
            hourly_counts[dt.hour] += 1
        except Exception:
            pass

        loc = ride["pickup_name"]
        location_counts[loc] = location_counts.get(loc, 0) + 1

    sorted_locations = [{"name": k, "count": v} for k, v in location_counts.items()]
    sorted_locations.sort(key=lambda x: x["count"], reverse=True)

    return {
        "hourly_demand": [hourly_counts[h] for h in range(24)],
        "top_locations": sorted_locations[:10],
    }


@router.get("/analytics/forecast")
async def demand_forecasting(authorization: str = Header(None)):
    """Hybrid forecast predicting location-specific demand hotspots."""
    raw_token = _extract_bearer_token(authorization)
    decode_token(raw_token)

    now_hour = datetime.now().hour

    base_probabilities = {
        "Main Gate (Thomason Gate)": 30.0,
        "Roorkee Railway Station": 20.0,
        "MGCL Library": 25.0,
        "Rajendra Bhawan": 15.0,
        "Cautley Bhawan": 15.0,
        "Govind Bhawan": 15.0,
        "Kasturba Bhawan": 15.0,
        "Sarojini Bhawan": 15.0,
        "Azad Bhawan": 15.0,
        "Jawahar Bhawan": 15.0,
        "Ravindra Bhawan": 15.0,
        "Ganga Bhawan": 15.0,
        "Department of CSE": 10.0,
        "Department of ECE": 10.0,
        "Convocation Hall": 15.0,
        "SAC (Student Activity Center)": 15.0,
        "Nesci / CCD": 20.0,
        "Olive Garden": 15.0,
        "SBI Bank": 10.0,
        "Hospital (Health Centre)": 10.0,
    }

    if 8 <= now_hour <= 10:
        for loc in ["Rajendra Bhawan", "Govind Bhawan", "Cautley Bhawan", "Ravindra Bhawan"]:
            base_probabilities[loc] += 40.0
        for loc in ["Department of CSE", "Department of ECE", "Convocation Hall"]:
            base_probabilities[loc] += 30.0
        base_probabilities["Main Gate (Thomason Gate)"] += 20.0
    elif 12 <= now_hour <= 14:
        for loc in ["Nesci / CCD", "Olive Garden", "MGCL Library"]:
            base_probabilities[loc] += 50.0
    elif 17 <= now_hour <= 20:
        for loc in ["Department of CSE", "Department of ECE"]:
            base_probabilities[loc] += 55.0
        for loc in ["SAC (Student Activity Center)", "Nesci / CCD", "Main Gate (Thomason Gate)"]:
            base_probabilities[loc] += 40.0
    elif 21 <= now_hour <= 23:
        for loc in ["MGCL Library"]:
            base_probabilities[loc] += 65.0
        for loc in ["Rajendra Bhawan", "Govind Bhawan", "Jawahar Bhawan"]:
            base_probabilities[loc] += 30.0

    all_rides = await get_all_rides()
    recent_demands: dict[str, int] = {}
    total_recent = 0

    for ride in all_rides:
        try:
            dt = datetime.fromisoformat(ride["created_at"])
            elapsed = (datetime.now(timezone.utc) - dt).total_seconds()
            if elapsed <= 7200:
                loc = ride["pickup_name"]
                recent_demands[loc] = recent_demands.get(loc, 0) + 1
                total_recent += 1
        except Exception:
            pass

    predictions = []
    for loc, p in base_probabilities.items():
        hist_weight = 0.0
        if total_recent > 0:
            hist_weight = (recent_demands.get(loc, 0) / total_recent) * 50.0

        final_probability = min(p + hist_weight, 98.0)

        reason = "Normal campus demand"
        if final_probability > 75:
            reason = "🔥 Peak area demand predicted"
        elif final_probability > 55:
            reason = "📈 High demand zone"
        elif final_probability > 35:
            reason = "Moderate traffic flow"

        if 8 <= now_hour <= 10 and "Bhawan" in loc:
            reason = "🎓 Classes starting soon"
        elif 17 <= now_hour <= 19 and "Department" in loc:
            reason = "🔔 Classes finishing exit"
        elif 21 <= now_hour <= 23 and loc == "MGCL Library":
            reason = "📚 Late night library study session"

        predictions.append(
            {
                "location": loc,
                "probability": round(final_probability, 1),
                "reason": reason,
            }
        )

    predictions.sort(key=lambda x: x["probability"], reverse=True)
    return {"predictions": predictions[:5]}


@router.get("/{ride_id}")
async def get_ride_detail(ride_id: str, authorization: str = Header(None)):
    """Return details for a specific ride."""
    raw_token = _extract_bearer_token(authorization)
    token_data = decode_token(raw_token)
    user_id = token_data["user_id"]

    ride = await get_ride(ride_id)
    if not ride:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ride not found")

    if ride["rider_id"] != user_id and ride.get("driver_id") != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to view this ride"
        )

    return {"ride": ride}
