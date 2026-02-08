import os
import httpx

NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org"
USER_AGENT = os.getenv("NOMINATIM_USER_AGENT", "ursa-spatial-app/1.0")
NOMINATIM_EMAIL = os.getenv("NOMINATIM_EMAIL")

def _client():
    return httpx.Client(
        base_url=NOMINATIM_BASE_URL,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=10.0,
    )


def _request(path: str, params: dict[str, str | float]):
    if NOMINATIM_EMAIL:
        params["email"] = NOMINATIM_EMAIL
    with _client() as client:
        response = client.get(path, params=params)
        response.raise_for_status()
        return response.json()


def geocode(query: str):
    return _request("/search", {"q": query, "format": "json"})

def reverse_geocode(lat: float, lon: float):
    return _request("/reverse", {"lat": lat, "lon": lon, "format": "json"})
