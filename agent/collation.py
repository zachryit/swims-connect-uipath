"""Ghana Social Welfare Service Directory (Collation API) — Python port of .swimsbot's
swims-services.js. Read-only, no-auth REST. This is the service-provider directory that
feeds SWIMS service referrals: find real providers (NGOs, CHRAJ, health, schools, …) by
district/region, category, or search, with their contact details, so a worker refers a
case to a REAL provider rather than a made-up name.

Three upstream endpoints are merged into one directory:
  DirectoryPlatformCategory/get      -> service categories  (id -> name)
  DirectoryPlatformListing/get       -> the provider listings
  DirectoryPlatformLocation/getregion-> regions/locations   (id -> name)
"""
from __future__ import annotations
import os
import time

import requests

COLLATION_BASE = os.environ.get("COLLATION_API_BASE_URL", "https://api.collation.org").rstrip("/")
TIMEOUT = float(os.environ.get("COLLATION_TIMEOUT_S", "15"))
_TTL_S = 24 * 60 * 60  # directory changes rarely; cache for a day (per process)
_SNAPSHOT = (os.environ.get("COLLATION_SNAPSHOT_FILE")
             or os.path.join(os.path.dirname(__file__), "data", "collation_snapshot.json"))
_cache: dict = {"providers": None, "at": 0.0, "source": None}


def _get(api_path: str) -> dict:
    r = requests.get(
        f"{COLLATION_BASE}/{api_path}",
        headers={"Accept": "application/json", "User-Agent": "SWIMS-Connect/1.0"},
        timeout=TIMEOUT,
    )
    if r.status_code < 200 or r.status_code >= 300:
        raise RuntimeError(f"Service directory endpoint {api_path} returned HTTP {r.status_code}")
    return r.json()


def _arr(body: dict) -> list:
    return body.get("response") or body.get("data") or []


def _fetch_directory() -> dict:
    cat = _get("DirectoryPlatformCategory/get")
    lst = _get("DirectoryPlatformListing/get")
    loc = _get("DirectoryPlatformLocation/getregion")
    d = {"categories": _arr(cat), "listings": _arr(lst), "regions": _arr(loc)}
    if not d["listings"]:
        raise RuntimeError("Service directory returned no listings")
    return d


def _load_snapshot() -> list[dict]:
    """The bundled, pre-normalised directory snapshot (fallback when the live API is down).
    Mirrors .swimsbot's cached collation.json fallback."""
    import json
    with open(_SNAPSHOT, encoding="utf-8") as f:
        return json.load(f).get("providers", [])


def _providers() -> list[dict]:
    """Normalised provider list: the live directory when reachable, else the bundled
    snapshot. The live Collation API is frequently 403/unavailable, so the snapshot is the
    reliable source — exactly the cache-fallback .swimsbot relies on."""
    now = time.time()
    if _cache["providers"] is not None and now - _cache["at"] < _TTL_S:
        return _cache["providers"]
    try:
        d = _fetch_directory()
        cat, loc = _maps(d)
        providers = [_normalise(l, cat, loc) for l in d.get("listings", []) if (l.get("name") or l.get("title"))]
        source = "collation_api"
    except Exception:
        providers = _load_snapshot()
        source = "snapshot"
    _cache.update(providers=providers, at=now, source=source)
    return providers


def _clean(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip().strip("\"'").strip()  # some values are wrapped in literal quotes
    return s or None


def _maps(d: dict) -> tuple[dict, dict]:
    cat = {str(c["id"]): c["name"] for c in d.get("categories", []) if c.get("id") is not None and c.get("name")}
    loc = {str(r["id"]): r["name"] for r in d.get("regions", []) if r.get("id") is not None and r.get("name")}
    return cat, loc


def _normalise(l: dict, cat: dict, loc: dict) -> dict:
    district = l.get("district") or (loc.get(str(l["district_id"])) if l.get("district_id") is not None else None)
    region = l.get("region") or (loc.get(str(l["location_id"])) if l.get("location_id") is not None else None)
    category = (l.get("category") or l.get("category_name")
                or (cat.get(str(l["category_id"])) if l.get("category_id") is not None else None))
    return {
        "id": l.get("id"),
        "name": l.get("name") or l.get("title"),
        "abbrev": l.get("abbrev") or None,
        "category": category,
        "district": district,
        "region": region,
        "town": l.get("town_of_operation") or None,
        "phone": _clean(l.get("phone")) or _clean(l.get("telephone")) or _clean(l.get("mobilephone")),
        "contact_person": _clean(l.get("cp_name")),
        "contact_person_phone": _clean(l.get("cp_contact")) or _clean(l.get("contact_person_phone")),
        "contact_person_position": _clean(l.get("cp_position")),
        "email": _clean(l.get("email")),
        "address": l.get("address") or l.get("physical_address") or l.get("town_of_operation"),
        "source": "collation_api",
    }


def find_services(district: str | None = None, category: str | None = None,
                  search: str | None = None, limit: int = 20) -> list[dict]:
    """Return matching service providers from the directory. A place term matches the
    resolved district, region, town, or address (Collation stores location mainly as
    free-text town_of_operation). Search matches name/abbrev/category/place tokens."""
    services = list(_providers())

    if district:
        dd = district.lower()
        services = [s for s in services
                    if any(dd in (s.get(k) or "").lower() for k in ("district", "region", "town", "address"))]
    if category:
        cc = category.lower()
        services = [s for s in services if cc in (s.get("category") or "").lower()]
    if search:
        term = search.lower()
        tokens = [t for t in term.split() if len(t) > 2]

        def hay(s: dict) -> str:
            return " ".join(filter(None, [s.get("name"), s.get("abbrev"), s.get("description"),
                                          s.get("category"), s.get("district"), s.get("region"),
                                          s.get("town")])).lower()

        def matches(s: dict) -> bool:
            h = hay(s)
            if term in h:
                return True
            words = [w for w in h.replace("-", " ").split() if w]
            return bool(tokens) and all(any(t in w or (len(w) >= 4 and w in t) for w in words) for t in tokens)

        services = [s for s in services if matches(s)]

    return services[:limit]
