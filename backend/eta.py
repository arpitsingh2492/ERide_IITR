"""ETA and distance calculations using the Haversine formula.

Assumes an average e-rickshaw speed of 15 km/h on IIT Roorkee campus.
"""

import math

# Average e-rickshaw speed on campus in km/h
AVERAGE_SPEED_KMH = 15.0

# Earth's mean radius in kilometres
EARTH_RADIUS_KM = 6371.0

# Minimum ETA in minutes (even for very short distances)
MIN_ETA_MINUTES = 1.0


def calculate_distance_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Calculate the great-circle distance between two GPS points using Haversine.

    Args:
        lat1: Latitude of point 1 in decimal degrees.
        lng1: Longitude of point 1 in decimal degrees.
        lat2: Latitude of point 2 in decimal degrees.
        lng2: Longitude of point 2 in decimal degrees.

    Returns:
        Distance in kilometres.
    """
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)

    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlng / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return EARTH_RADIUS_KM * c


def calculate_eta(
    from_lat: float, from_lng: float, to_lat: float, to_lng: float
) -> dict:
    """Calculate estimated time of arrival between two GPS points.

    Args:
        from_lat: Origin latitude.
        from_lng: Origin longitude.
        to_lat: Destination latitude.
        to_lng: Destination longitude.

    Returns:
        Dict with ``distance_km`` (float) and ``eta_minutes`` (float, >= 1).
    """
    distance_km = calculate_distance_km(from_lat, from_lng, to_lat, to_lng)
    eta_minutes = (distance_km / AVERAGE_SPEED_KMH) * 60

    # Enforce minimum ETA
    eta_minutes = max(eta_minutes, MIN_ETA_MINUTES)

    return {
        "distance_km": round(distance_km, 2),
        "eta_minutes": round(eta_minutes, 1),
    }
