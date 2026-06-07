"""WebSocket connection manager and real-time ride orchestration for ERide.

Implements first-accept-wins ride matching, live driver location tracking,
and real-time ETA updates between riders and drivers.

All outgoing WebSocket messages use the format:
    {"type": "<MSG_TYPE>", "data": { ... }}
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from fastapi import WebSocket, WebSocketDisconnect

from backend.database import (
    create_ride,
    get_user_by_id,
    update_ride_status,
)
from backend.eta import calculate_eta
from backend.models import (
    WS_DRIVER_OFFLINE,
    WS_DRIVER_ONLINE,
    WS_DRIVER_LOCATIONS,
    WS_RIDE_STARTED,
    WS_ERROR,
    WS_LOCATION_UPDATE,
    WS_RIDE_ACCEPTED,
    WS_RIDE_CANCELLED,
    WS_RIDE_COMPLETED,
    WS_RIDE_REQUEST,
)

logger = logging.getLogger("eride.ws")


def _msg(msg_type: str, data: dict) -> dict:
    """Build a standardised WebSocket message envelope."""
    return {"type": msg_type, "data": data}


class ConnectionManager:
    """Manages WebSocket connections, driver locations, and active rides."""

    def __init__(self) -> None:
        # user_id → WebSocket
        self.rider_connections: dict[int, WebSocket] = {}
        self.driver_connections: dict[int, WebSocket] = {}

        # user_id → {lat, lng, updated_at}
        self.driver_locations: dict[int, dict] = {}

        # ride_id → ride data dict (accepted / in-progress)
        self.active_rides: dict[int, dict] = {}

        # ride_id → ride data dict (waiting for a driver to accept)
        self.pending_rides: dict[int, dict] = {}

    # ── Connection lifecycle ─────────────────────────────────────────────

    async def connect_rider(self, user_id: str, ws: WebSocket) -> None:
        """Register a rider's WebSocket connection."""
        self.rider_connections[user_id] = ws
        logger.info("Rider %s connected (%d riders online)", user_id, len(self.rider_connections))
        # Immediately send active drivers
        await self.send_driver_locations_to_rider(user_id)

    def disconnect_rider(self, user_id: str) -> None:
        """Remove a rider's WebSocket connection."""
        self.rider_connections.pop(user_id, None)
        logger.info("Rider %s disconnected", user_id)

    async def connect_driver(self, user_id: str, ws: WebSocket) -> None:
        """Register a driver's WebSocket connection."""
        self.driver_connections[user_id] = ws
        logger.info("Driver %s connected (%d drivers online)", user_id, len(self.driver_connections))
        await self.broadcast_driver_locations()

    async def disconnect_driver(self, user_id: str) -> None:
        """Remove a driver's WebSocket and location data."""
        self.driver_connections.pop(user_id, None)
        self.driver_locations.pop(user_id, None)
        logger.info("Driver %s disconnected", user_id)
        await self.broadcast_driver_locations()

    # ── Messaging primitives ─────────────────────────────────────────────

    async def broadcast_to_drivers(self, message: dict) -> None:
        """Send a JSON message to every connected driver."""
        dead: list[int] = []
        for uid, ws in self.driver_connections.items():
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(uid)
        for uid in dead:
            await self.disconnect_driver(uid)

    async def send_to_rider(self, user_id: str, message: dict) -> None:
        """Send a JSON message to a specific rider, if connected."""
        ws = self.rider_connections.get(user_id)
        if ws:
            try:
                await ws.send_json(message)
            except Exception:
                self.disconnect_rider(user_id)

    async def send_to_driver(self, user_id: str, message: dict) -> None:
        """Send a JSON message to a specific driver, if connected."""
        ws = self.driver_connections.get(user_id)
        if ws:
            try:
                await ws.send_json(message)
            except Exception:
                await self.disconnect_driver(user_id)

    # ── Availability broadcasting ────────────────────────────────────────

    async def broadcast_driver_locations(self) -> None:
        """Broadcast online driver details to all active riders."""
        drivers = self.get_online_drivers()
        message = _msg(WS_DRIVER_LOCATIONS, {"drivers": drivers})
        dead: list[int] = []
        for uid, ws in list(self.rider_connections.items()):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(uid)
        for uid in dead:
            self.disconnect_rider(uid)

    async def send_driver_locations_to_rider(self, user_id: str) -> None:
        """Send current driver locations to a single rider on connect."""
        drivers = self.get_online_drivers()
        await self.send_to_rider(user_id, _msg(WS_DRIVER_LOCATIONS, {"drivers": drivers}))

    # ── Location tracking ────────────────────────────────────────────────

    def update_driver_location(self, user_id: str, lat: float, lng: float) -> None:
        """Store or update a driver's last-known GPS position."""
        self.driver_locations[user_id] = {
            "lat": lat,
            "lng": lng,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

    def get_online_drivers(self) -> list[dict]:
        """Return a list of all connected drivers with their locations."""
        result: list[dict] = []
        for uid, loc in self.driver_locations.items():
            if uid in self.driver_connections:
                result.append({"driver_id": uid, **loc})
        return result

    # ── Ride-request handler (rider) ─────────────────────────────────────

    async def _handle_ride_request(self, user_id: str, data: dict) -> None:
        """Process a ``RIDE_REQUEST`` from a rider."""
        try:
            ride = await create_ride(
                rider_id=user_id,
                pickup_lat=data["pickup_lat"],
                pickup_lng=data["pickup_lng"],
                pickup_name=data["pickup_name"],
                dest_lat=data["dest_lat"],
                dest_lng=data["dest_lng"],
                dest_name=data["dest_name"],
            )
        except Exception as exc:
            await self.send_to_rider(user_id, _msg(WS_ERROR, {"message": str(exc)}))
            return

        # Get rider info for driver cards
        rider_user = await get_user_by_id(user_id)
        rider_name = rider_user["name"] if rider_user else "Rider"

        self.pending_rides[ride["id"]] = ride

        # Build per-driver ETA and send individually
        drivers_notified = 0
        for driver_id, loc in list(self.driver_locations.items()):
            if driver_id not in self.driver_connections:
                continue
            eta_info = calculate_eta(loc["lat"], loc["lng"], ride["pickup_lat"], ride["pickup_lng"])
            await self.send_to_driver(
                driver_id,
                _msg(WS_RIDE_REQUEST, {
                    "ride_id": ride["id"],
                    "rider_name": rider_name,
                    "pickup_lat": ride["pickup_lat"],
                    "pickup_lng": ride["pickup_lng"],
                    "pickup_name": ride["pickup_name"],
                    "dest_lat": ride["dest_lat"],
                    "dest_lng": ride["dest_lng"],
                    "dest_name": ride["dest_name"],
                    "eta_minutes": eta_info["eta_minutes"],
                    "distance_km": eta_info["distance_km"],
                }),
            )
            drivers_notified += 1

        # If no drivers have locations yet, still broadcast a generic message
        if drivers_notified == 0:
            await self.broadcast_to_drivers(
                _msg(WS_RIDE_REQUEST, {
                    "ride_id": ride["id"],
                    "rider_name": rider_name,
                    "pickup_lat": ride["pickup_lat"],
                    "pickup_lng": ride["pickup_lng"],
                    "pickup_name": ride["pickup_name"],
                    "dest_lat": ride["dest_lat"],
                    "dest_lng": ride["dest_lng"],
                    "dest_name": ride["dest_name"],
                    "eta_minutes": None,
                    "distance_km": None,
                }),
            )

        # Confirm receipt to the rider
        await self.send_to_rider(
            user_id,
            _msg(WS_RIDE_REQUEST, {
                "status": "searching",
                "ride_id": ride["id"],
            }),
        )

    # ── Ride-accepted handler (driver) ───────────────────────────────────

    async def _handle_ride_accepted(self, driver_id: str, data: dict) -> None:
        """Process a ``RIDE_ACCEPTED`` from a driver (first-accept-wins)."""
        ride_id = data.get("ride_id")
        if ride_id is None:
            await self.send_to_driver(driver_id, _msg(WS_ERROR, {"message": "ride_id required"}))
            return

        try:
            ride_id = str(ride_id)
        except (ValueError, TypeError):
            await self.send_to_driver(driver_id, _msg(WS_ERROR, {"message": "Invalid ride_id"}))
            return

        # ── First-accept-wins check ──────────────────────────────────────
        ride = self.pending_rides.pop(ride_id, None)
        if ride is None:
            await self.send_to_driver(
                driver_id,
                _msg(WS_RIDE_CANCELLED, {"ride_id": ride_id, "reason": "Ride already taken or does not exist"}),
            )
            return

        # Persist acceptance
        updated_ride = await update_ride_status(ride_id, "accepted", driver_id=driver_id)
        if updated_ride is None:
            await self.send_to_driver(driver_id, _msg(WS_ERROR, {"message": "Ride not found in DB"}))
            return

        self.active_rides[ride_id] = updated_ride

        # Get driver info for the rider
        driver_user = await get_user_by_id(driver_id)
        driver_name = driver_user["name"] if driver_user else "Driver"
        driver_phone = driver_user["phone"] if driver_user else ""
        vehicle_number = driver_user.get("vehicle_number", "") if driver_user else ""
        upi_id = driver_user.get("upi_id", "") if driver_user else ""
        qr_base64 = driver_user.get("qr_base64", "") if driver_user else ""

        # Calculate ETA from driver to pickup
        driver_loc = self.driver_locations.get(driver_id)
        eta_minutes = None
        driver_lat = None
        driver_lng = None
        if driver_loc:
            eta_info = calculate_eta(
                driver_loc["lat"], driver_loc["lng"],
                updated_ride["pickup_lat"], updated_ride["pickup_lng"],
            )
            eta_minutes = eta_info["eta_minutes"]
            driver_lat = driver_loc["lat"]
            driver_lng = driver_loc["lng"]

        # Notify the rider
        await self.send_to_rider(
            updated_ride["rider_id"],
            _msg(WS_RIDE_ACCEPTED, {
                "ride_id": ride_id,
                "driver_name": driver_name,
                "driver_phone": driver_phone,
                "vehicle_number": vehicle_number,
                "upi_id": upi_id,
                "qr_base64": qr_base64,
                "driver_lat": driver_lat,
                "driver_lng": driver_lng,
                "eta_minutes": eta_minutes,
            }),
        )

        # Confirm to the accepting driver
        await self.send_to_driver(
            driver_id,
            _msg(WS_RIDE_ACCEPTED, {
                "ride_id": ride_id,
                "message": "Ride accepted successfully",
            }),
        )

        # Cancel for all OTHER connected drivers
        for other_id in list(self.driver_connections.keys()):
            if other_id != driver_id:
                await self.send_to_driver(
                    other_id,
                    _msg(WS_RIDE_CANCELLED, {"ride_id": ride_id, "reason": "Accepted by another driver"}),
                )

    # ── Ride Started handler (driver) ────────────────────────────────────

    async def _handle_ride_started(self, driver_id: str, data: dict) -> None:
        """Process a ``RIDE_STARTED`` notification from the driver."""
        ride_id = data.get("ride_id")
        if ride_id is None:
            await self.send_to_driver(driver_id, _msg(WS_ERROR, {"message": "ride_id required"}))
            return

        try:
            ride_id = str(ride_id)
        except (ValueError, TypeError):
            await self.send_to_driver(driver_id, _msg(WS_ERROR, {"message": "Invalid ride_id"}))
            return

        ride = self.active_rides.get(ride_id)
        if ride is None:
            await self.send_to_driver(driver_id, _msg(WS_ERROR, {"message": "No active ride with this ID"}))
            return

        # Update DB status
        updated_ride = await update_ride_status(ride_id, "in_progress")
        if updated_ride is None:
            await self.send_to_driver(driver_id, _msg(WS_ERROR, {"message": "Ride not found in DB"}))
            return

        # Update local cache
        self.active_rides[ride_id] = updated_ride

        # Notify rider
        await self.send_to_rider(
            ride["rider_id"],
            _msg(WS_RIDE_STARTED, {
                "ride_id": ride_id,
                "message": "Your ride has started! You are now en route.",
            }),
        )

        # Confirm to driver
        await self.send_to_driver(
            driver_id,
            _msg(WS_RIDE_STARTED, {
                "ride_id": ride_id,
                "message": "Ride marked in progress",
            }),
        )

    # ── Location-update handler (driver) ─────────────────────────────────

    async def _handle_location_update(self, driver_id: str, data: dict) -> None:
        """Process a ``LOCATION_UPDATE`` from a driver."""
        lat = data.get("lat")
        lng = data.get("lng")
        if lat is None or lng is None:
            await self.send_to_driver(driver_id, _msg(WS_ERROR, {"message": "lat and lng required"}))
            return

        self.update_driver_location(driver_id, lat, lng)

        # Broadcast update to all riders viewing maps
        await self.broadcast_driver_locations()

        # If this driver has an active ride, forward location + ETA to the rider
        for ride_id, ride in self.active_rides.items():
            if ride.get("driver_id") == driver_id:
                # If ride is in progress, target is destination, otherwise pickup
                if ride["status"] == "in_progress":
                    target_lat = ride["dest_lat"]
                    target_lng = ride["dest_lng"]
                else:
                    target_lat = ride["pickup_lat"]
                    target_lng = ride["pickup_lng"]

                eta_info = calculate_eta(lat, lng, target_lat, target_lng)

                await self.send_to_rider(
                    ride["rider_id"],
                    _msg(WS_LOCATION_UPDATE, {
                        "ride_id": ride_id,
                        "lat": lat,
                        "lng": lng,
                        "eta_minutes": eta_info["eta_minutes"],
                    }),
                )
                break

    # ── Ride-completed handler (driver) ──────────────────────────────────

    async def _handle_ride_completed(self, driver_id: str, data: dict) -> None:
        """Process a ``RIDE_COMPLETED`` from a driver."""
        ride_id = data.get("ride_id")
        if ride_id is None:
            await self.send_to_driver(driver_id, _msg(WS_ERROR, {"message": "ride_id required"}))
            return

        try:
            ride_id = str(ride_id)
        except (ValueError, TypeError):
            await self.send_to_driver(driver_id, _msg(WS_ERROR, {"message": "Invalid ride_id"}))
            return

        ride = self.active_rides.pop(ride_id, None)
        if ride is None:
            await self.send_to_driver(driver_id, _msg(WS_ERROR, {"message": "No active ride with this ID"}))
            return

        updated_ride = await update_ride_status(ride_id, "completed")
        if updated_ride is None:
            await self.send_to_driver(driver_id, _msg(WS_ERROR, {"message": "Ride not found in DB"}))
            return

        # Notify the rider
        await self.send_to_rider(
            ride["rider_id"],
            _msg(WS_RIDE_COMPLETED, {
                "ride_id": ride_id,
                "message": "Your ride has been completed!",
            }),
        )

        # Confirm to the driver
        await self.send_to_driver(
            driver_id,
            _msg(WS_RIDE_COMPLETED, {
                "ride_id": ride_id,
                "message": "Ride completed successfully",
            }),
        )


# ── Singleton instance ───────────────────────────────────────────────────────

manager = ConnectionManager()


# ── Top-level WebSocket handler ──────────────────────────────────────────────


async def handle_websocket(websocket: WebSocket, user_id: str, role: str) -> None:
    """Accept a WebSocket connection and route messages based on user role."""
    await websocket.accept()

    try:
        if role == "rider":
            await manager.connect_rider(user_id, websocket)
        else:
            await manager.connect_driver(user_id, websocket)

        # ── Message loop ─────────────────────────────────────────────────
        while True:
            raw = await websocket.receive_text()
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json(_msg(WS_ERROR, {"message": "Invalid JSON"}))
                continue

            msg_type = message.get("type")
            data = message.get("data", {})

            if role == "rider":
                if msg_type == WS_RIDE_REQUEST:
                    await manager._handle_ride_request(user_id, data)
                elif msg_type == WS_RIDE_CANCELLED:
                    # Rider cancels request
                    ride_id = data.get("ride_id")
                    if ride_id:
                        try:
                            r_id = str(ride_id)
                            manager.pending_rides.pop(r_id, None)
                            manager.active_rides.pop(r_id, None)
                            await update_ride_status(r_id, "cancelled")
                            await manager.broadcast_to_drivers(_msg(WS_RIDE_CANCELLED, {"ride_id": r_id, "reason": "Rider cancelled request"}))
                        except Exception:
                            pass
                elif msg_type == "ping":
                    await websocket.send_json({"type": "pong"})
                else:
                    await websocket.send_json(
                        _msg(WS_ERROR, {"message": f"Unknown message type for rider: {msg_type}"})
                    )

            elif role == "driver":
                if msg_type == WS_RIDE_ACCEPTED:
                    await manager._handle_ride_accepted(user_id, data)
                elif msg_type == WS_RIDE_STARTED:
                    await manager._handle_ride_started(user_id, data)
                elif msg_type == WS_LOCATION_UPDATE:
                    await manager._handle_location_update(user_id, data)
                elif msg_type == WS_RIDE_COMPLETED:
                    await manager._handle_ride_completed(user_id, data)
                elif msg_type == "ping":
                    await websocket.send_json({"type": "pong"})
                else:
                    await websocket.send_json(
                        _msg(WS_ERROR, {"message": f"Unknown message type for driver: {msg_type}"})
                    )

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected: user_id=%s role=%s", user_id, role)
    except Exception as exc:
        logger.exception("WebSocket error for user_id=%s: %s", user_id, exc)
    finally:
        if role == "rider":
            manager.disconnect_rider(user_id)
        else:
            await manager.disconnect_driver(user_id)
