"""Run only on loopback. The Next.js server is the authenticated browser proxy."""

from __future__ import annotations

import os

import uvicorn

from app import create_app


def main() -> None:
    app = create_app()
    port = int(os.getenv("AI_LIVE_WORKER_PORT", "8765"))
    uvicorn.run(app, host="127.0.0.1", port=port, access_log=False)


if __name__ == "__main__":
    main()
