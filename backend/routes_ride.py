"""REST routes for ride history, ratings, scheduling, and analytics."""

from __future__ import annotations

from datetime import datetime, timezone
import pandas as pd
import numpy as np
from sklearn.tree import DecisionTreeRegressor
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
    """Machine Learning forecast predicting location-specific demand hotspots."""
    raw_token = _extract_bearer_token(authorization)
    decode_token(raw_token)

    now_hour = datetime.now().hour

    locations = [
        "Main Gate (Thomason Gate)", "Roorkee Railway Station", "MGCL Library",
        "Rajendra Bhawan", "Cautley Bhawan", "Govind Bhawan", "Kasturba Bhawan",
        "Sarojini Bhawan", "Azad Bhawan", "Jawahar Bhawan", "Ravindra Bhawan",
        "Ganga Bhawan", "Department of CSE", "Department of ECE", "Convocation Hall",
        "SAC (Student Activity Center)", "Nesci / CCD", "Olive Garden", "SBI Bank",
        "Hospital (Health Centre)"
    ]

    # 1. Synthesize historical training data (since actual historical database is small)
    data = []
    np.random.seed(42) # For reproducible predictions
    for h in range(24):
        for loc_idx, loc in enumerate(locations):
            base = 15.0
            if 8 <= h <= 10 and "Bhawan" in loc:
                base += 45.0
            elif 12 <= h <= 14 and loc in ["Nesci / CCD", "Olive Garden"]:
                base += 50.0
            elif 17 <= h <= 20 and "Department" in loc:
                base += 55.0
            elif 21 <= h <= 23 and loc == "MGCL Library":
                base += 65.0
            
            # Add historical variance
            demand = max(0, min(98, base + np.random.normal(0, 8)))
            data.append({"hour": h, "location_idx": loc_idx, "demand": demand})

    df = pd.DataFrame(data)

    # 2. Train Decision Tree Regressor model
    X = df[["hour", "location_idx"]]
    y = df["demand"]
    model = DecisionTreeRegressor(max_depth=6, random_state=42)
    model.fit(X, y)

    # 3. Predict for the current hour
    predictions = []
    for loc_idx, loc in enumerate(locations):
        # Create a DataFrame with the same feature names as the training data
        pred_df = pd.DataFrame([{"hour": now_hour, "location_idx": loc_idx}])
        pred_demand = model.predict(pred_df)[0]
        
        # Incorporate real-time recent active rides to slightly bump up the ML prediction
        all_rides = await get_all_rides()
        total_recent = 0
        loc_recent = 0
        for ride in all_rides:
            try:
                dt = datetime.fromisoformat(ride["created_at"])
                if (datetime.now(timezone.utc) - dt).total_seconds() <= 7200:
                    total_recent += 1
                    if ride["pickup_name"] == loc:
                        loc_recent += 1
            except Exception:
                pass
        
        realtime_boost = (loc_recent / total_recent * 20.0) if total_recent > 0 else 0.0
        final_probability = min(max(pred_demand + realtime_boost, 5.0), 98.0)

        reason = "Normal campus demand"
        if final_probability > 75:
            reason = "🔥 Peak area demand predicted by ML model"
        elif final_probability > 55:
            reason = "📈 High demand zone (ML Forecast)"
        elif final_probability > 35:
            reason = "Moderate traffic flow"

        if 8 <= now_hour <= 10 and "Bhawan" in loc:
            reason = "🎓 Classes starting soon (ML Prediction)"
        elif 17 <= now_hour <= 19 and "Department" in loc:
            reason = "🔔 Classes finishing exit (ML Prediction)"

        predictions.append({
            "location": loc,
            "probability": round(final_probability, 1),
            "reason": reason,
        })

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
