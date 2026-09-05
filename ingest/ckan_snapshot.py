"""Snapshot CKAN searches for our Tier 1 datasets to notes/CKAN_INDEX.md.

Runs a fixed list of queries against catalogue.data.wa.gov.au and writes a
readable Markdown index of matches, LGATE codes, and download URLs. Also
dumps the raw JSON alongside for programmatic reuse.

Regenerate when you suspect the catalogue has changed:

    uv run python -m ingest.ckan_snapshot
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ingest.ckan import package_search

NOTES_DIR = Path(__file__).resolve().parents[1] / "notes"
JSON_PATH = NOTES_DIR / "ckan_search_results.json"
MD_PATH = NOTES_DIR / "CKAN_INDEX.md"

QUERIES = [
    "cadastre",
    "local government",
    "LGA boundaries",
    "administrative boundaries",
    "townsites",
    "crown reserves",
    "DBCA",
    "groundwater",
    "surface water",
    "soil landscape",
    "land capability",
    "bushfire prone",
    "road centrelines",
    "rainfall",
    "digital elevation model",
    "DEM",
]

DOWNLOAD_FORMATS = {"GeoPackage", "SHP", "GeoJSON", "FGDB", "CSV", "ZIP", "NetCDF", "GeoTIFF"}
SERVICE_FORMATS = {"WFS", "WMS"}


def snapshot() -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for q in QUERIES:
        matches = package_search(q, rows=10)
        out[q] = [
            {
                "title": m.get("title"),
                "name": m.get("name"),
                "organization": (m.get("organization") or {}).get("title"),
                "resources": [
                    {"format": r.get("format"), "name": r.get("name"), "url": r.get("url")}
                    for r in m.get("resources", [])
                ],
            }
            for m in matches
        ]
    return out


def to_markdown(data: dict[str, list[dict[str, Any]]]) -> str:
    lines: list[str] = [
        "# CKAN Search Results — Landgate / DataWA",
        "",
        "Auto-generated snapshot of `catalogue.data.wa.gov.au` searches for the Tier 1",
        "datasets we need. Use this as a quick lookup for LGATE-XXX codes and download URLs",
        "without re-running CKAN queries. Regenerate with:",
        "",
        "```",
        "uv run python -m ingest.ckan_snapshot",
        "```",
        "",
        "Datasets that require a SLIP login are downloaded manually per notes/DOWNLOADS.md.",
        "",
        "---",
        "",
    ]

    for query, matches in data.items():
        lines.append(f"## Query: `{query}`")
        lines.append("")
        if not matches:
            lines.append("*No matches.*")
            lines.append("")
            continue
        for i, m in enumerate(matches):
            title = m["title"] or "(no title)"
            name = m["name"]
            org = m["organization"] or "(unknown org)"
            lines.append(f"### {i + 1}. {title}")
            lines.append(f"- **CKAN name:** `{name}`")
            lines.append(f"- **Publisher:** {org}")

            downloads = [r for r in m["resources"] if r["format"] in DOWNLOAD_FORMATS]
            services = [r for r in m["resources"] if r["format"] in SERVICE_FORMATS]

            if downloads:
                lines.append("- **Downloads:**")
                for r in downloads:
                    lines.append(f"  - [{r['format']}] {r['url']}")
            if services:
                lines.append("- **Services:**")
                for r in services:
                    lines.append(f"  - [{r['format']}] {r['url']}")
            lines.append("")
        lines.append("---")
        lines.append("")

    return "\n".join(lines)


def main() -> None:
    data = snapshot()
    JSON_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    MD_PATH.write_text(to_markdown(data))
    n_packages = sum(len(v) for v in data.values())
    print(f"Wrote {JSON_PATH} ({n_packages} package entries across {len(data)} queries)")
    print(f"Wrote {MD_PATH}")


if __name__ == "__main__":
    main()
