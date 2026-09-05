"""CKAN resolver for catalogue.data.wa.gov.au.

Given a dataset name (or search query), returns the WFS/WMS resource URLs from
the CKAN package. Endpoints in this catalogue change over time, so per §3 of the
brief we resolve them at runtime rather than hardcoding.

Usage:
    from ingest.ckan import find_dataset, wfs_endpoints
    pkg = find_dataset("Cadastre")
    wfs = wfs_endpoints(pkg)
"""

from __future__ import annotations

from typing import Any

import httpx

CKAN_BASE = "https://catalogue.data.wa.gov.au/api/3/action"
TIMEOUT = 30.0


class CKANError(RuntimeError):
    pass


def _get(path: str, params: dict[str, Any]) -> dict[str, Any]:
    url = f"{CKAN_BASE}/{path}"
    r = httpx.get(url, params=params, timeout=TIMEOUT)
    r.raise_for_status()
    payload = r.json()
    if not payload.get("success"):
        raise CKANError(f"CKAN call failed: {payload}")
    return payload["result"]


def package_search(query: str, rows: int = 20) -> list[dict[str, Any]]:
    """Search CKAN packages by free-text query. Returns list of package dicts."""
    result = _get("package_search", {"q": query, "rows": rows})
    return result.get("results", [])


def package_show(name_or_id: str) -> dict[str, Any]:
    """Fetch a package by exact name/id."""
    return _get("package_show", {"id": name_or_id})


def find_dataset(query: str) -> dict[str, Any]:
    """Search for a dataset by query and return the top result.

    Halts loudly if there are zero matches — per §0, we do not silently
    substitute a dataset. Caller should inspect result['title'] and confirm
    it matches expectations before using the endpoints.
    """
    matches = package_search(query, rows=5)
    if not matches:
        raise CKANError(f"No CKAN package matches query: {query!r}")
    return matches[0]


def resources_of_format(package: dict[str, Any], fmt: str) -> list[dict[str, Any]]:
    """Return resources on a package whose format matches (case-insensitive)."""
    fmt_lower = fmt.lower()
    return [r for r in package.get("resources", []) if r.get("format", "").lower() == fmt_lower]


def wfs_endpoints(package: dict[str, Any]) -> list[str]:
    """Return WFS resource URLs from a package. May be empty."""
    return [r["url"] for r in resources_of_format(package, "WFS") if r.get("url")]


def wms_endpoints(package: dict[str, Any]) -> list[str]:
    return [r["url"] for r in resources_of_format(package, "WMS") if r.get("url")]


if __name__ == "__main__":
    import sys

    query = " ".join(sys.argv[1:]) or "Cadastre"
    print(f"Searching CKAN for: {query!r}\n")
    for i, pkg in enumerate(package_search(query, rows=5)):
        print(f"[{i}] {pkg.get('title')}  (name={pkg.get('name')})")
        for r in pkg.get("resources", []):
            print(f"      - [{r.get('format')}] {r.get('name')}")
            print(f"        {r.get('url')}")
        print()
