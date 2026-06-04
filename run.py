#!/usr/bin/env python
"""
Startup wrapper for DisruptIQ backend.
Changes to backend directory and starts the FastAPI app.
Used by Railway deployment.
"""
import os
import sys
from pathlib import Path

backend_dir = Path(__file__).parent / "Swarm Agent" / "backend"
os.chdir(backend_dir)
sys.path.insert(0, str(backend_dir))

if __name__ == "__main__":
    import main
