"""FastAPI backend for the SWWA land screener.

Serves the same DuckDB snapshot the Streamlit app reads. Keeps ingest and
scoring modules unchanged — this is a thin HTTP layer over them.
"""
