"""FastAPI backend for Lima.

Serves the same DuckDB snapshot the Streamlit app reads. Keeps ingest and
scoring modules unchanged — this is a thin HTTP layer over them.
"""
