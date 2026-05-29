"""
Demo backend (Python / Flask). Two endpoints:
  GET /api/status   -> { service, version }   (version = deployed SHA; used by
                       Beacon's fullstack cross-service check)
  GET /api/greeting -> response gated by the boolean flag "new-greeting"

LaunchDarkly is optional: if the SDK or LD_SDK_KEY is absent, the flag defaults
to false and the app still runs.
"""

import os

from flask import Flask, jsonify

SHA = os.environ.get("RAILWAY_GIT_COMMIT_SHA", "dev")
SDK_KEY = os.environ.get("LD_SDK_KEY")

app = Flask(__name__)

_ld_client = None


def _ld():
    """Lazily initialize the LaunchDarkly client (or return None if unavailable)."""
    global _ld_client
    if _ld_client is not None:
        return _ld_client
    if not SDK_KEY:
        return None
    try:
        import ldclient
        from ldclient.config import Config

        ldclient.set_config(Config(SDK_KEY))
        _ld_client = ldclient.get()
        return _ld_client
    except Exception:  # noqa: BLE001 - demo: degrade gracefully without LD
        return None


def _flag(key: str, default: bool = False) -> bool:
    client = _ld()
    if client is None:
        return default
    from ldclient.context import Context

    ctx = Context.builder("demo-user").kind("user").build()
    return bool(client.variation(key, ctx, default))


@app.get("/api/status")
def status():
    return jsonify({"service": "demo-backend", "version": SHA})


@app.get("/api/greeting")
def greeting():
    use_new = _flag("new-greeting", False)
    return jsonify(
        {
            "greeting": "Hello from the future! 🚀" if use_new else "Hello, world.",
            "flag_new_greeting": use_new,
            "version": SHA,
        }
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
