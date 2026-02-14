"""
KidsGuard — AI-Powered Child Safety Monitoring System
Main Flask application.
"""

import os
import json
import uuid
import threading
from datetime import datetime

from flask import (
    Flask,
    render_template,
    request,
    jsonify,
    Response,
    stream_with_context,
)

import requests as http_requests
from trio_client import TrioClient

# ──────────────────────────────────────────────────────────────────────
#  Configuration
# ──────────────────────────────────────────────────────────────────────
app = Flask(__name__)
app.secret_key = os.urandom(24)

TRIO_API_KEY = os.environ.get("TRIO_API_KEY", "")
if not TRIO_API_KEY:
    print("⚠️  WARNING: TRIO_API_KEY environment variable not set!")
    print("   Run: export TRIO_API_KEY='your-api-key'")
trio = TrioClient(TRIO_API_KEY)

# In-memory stores (sufficient for hackathon demo)
alert_history: list[dict] = []
webhook_events: list[dict] = []
digest_summaries: list[dict] = []
active_monitors: dict[str, dict] = {}   # job_id -> metadata
webhook_site_token: dict = {}            # current webhook.site token info

WEBHOOK_SITE_BASE = "https://webhook.site"

# ──────────────────────────────────────────────────────────────────────
#  Preset safety conditions
# ──────────────────────────────────────────────────────────────────────
SAFETY_PRESETS = [
    {
        "id": "general_safety",
        "label": "Is Child Safe?",
        "icon": "🛡️",
        "condition": "Is the child in a safe situation? Look for any dangers like climbing, sharp objects, water hazards, or being near windows/balconies.",
        "danger_level": "check",
        "color": "#3b82f6",
    },
    {
        "id": "climbing",
        "label": "Climbing Danger",
        "icon": "🧗",
        "condition": "Is a child climbing on furniture, windows, balconies, shelves, or any elevated surface that could cause a fall?",
        "danger_level": "high",
        "color": "#ef4444",
    },
    {
        "id": "dangerous_objects",
        "label": "Dangerous Objects",
        "icon": "🔪",
        "condition": "Are there dangerous objects accessible to a child, such as knives, scissors, medicine bottles, cleaning products, or small choking hazards?",
        "danger_level": "high",
        "color": "#f97316",
    },
    {
        "id": "stranger",
        "label": "Stranger Alert",
        "icon": "👤",
        "condition": "Is there an unfamiliar adult or stranger present in the room with the child?",
        "danger_level": "high",
        "color": "#dc2626",
    },
    {
        "id": "alone_dangerous",
        "label": "Alone in Danger Zone",
        "icon": "🚪",
        "condition": "Is a child alone in a potentially dangerous area such as a kitchen, bathroom, garage, or near a swimming pool?",
        "danger_level": "medium",
        "color": "#eab308",
    },
    {
        "id": "water_hazard",
        "label": "Water Hazard",
        "icon": "🌊",
        "condition": "Is a child near water such as a bathtub, pool, bucket, or any body of water without adult supervision?",
        "danger_level": "high",
        "color": "#06b6d4",
    },
]


# ──────────────────────────────────────────────────────────────────────
#  Helper
# ──────────────────────────────────────────────────────────────────────
def classify_danger(triggered: bool, condition: str, explanation: str) -> str:
    """Return 'high', 'medium', or 'safe' based on AI response."""
    if not triggered:
        return "safe"
    lower_exp = explanation.lower()
    high_keywords = [
        "climbing", "window", "balcony", "knife", "medicine",
        "stranger", "falling", "sharp", "fire", "drown",
        "pool", "choking", "electric",
    ]
    if any(kw in lower_exp for kw in high_keywords):
        return "high"
    return "medium"


# ══════════════════════════════════════════════════════════════════════
#  ROUTES — Pages
# ══════════════════════════════════════════════════════════════════════

@app.route("/")
def index():
    return render_template("index.html")


# ══════════════════════════════════════════════════════════════════════
#  API — Stream validation
# ══════════════════════════════════════════════════════════════════════

@app.route("/api/validate-stream", methods=["POST"])
def validate_stream():
    data = request.json or {}
    stream_url = data.get("stream_url", "").strip()
    if not stream_url:
        return jsonify({"error": "stream_url is required"}), 400
    result = trio.validate_stream(stream_url)
    return jsonify(result)


# ══════════════════════════════════════════════════════════════════════
#  API — One-shot safety checks  (/check-once)
# ══════════════════════════════════════════════════════════════════════

@app.route("/api/presets", methods=["GET"])
def get_presets():
    return jsonify(SAFETY_PRESETS)


@app.route("/api/check", methods=["POST"])
def safety_check():
    """Run a single safety check via Trio /check-once."""
    data = request.json or {}
    stream_url = data.get("stream_url", "").strip()
    condition = data.get("condition", "").strip()

    if not stream_url or not condition:
        return jsonify({"error": "stream_url and condition are required"}), 400

    try:
        result = trio.check_once(stream_url, condition)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502

    # Classify danger level
    danger = classify_danger(
        result.get("triggered", False),
        condition,
        result.get("explanation", ""),
    )

    record = {
        "id": str(uuid.uuid4())[:8],
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "stream_url": stream_url,
        "condition": condition,
        "triggered": result.get("triggered", False),
        "explanation": result.get("explanation", ""),
        "latency_ms": result.get("latency_ms", 0),
        "danger_level": danger,
    }
    alert_history.insert(0, record)
    # Keep last 200
    if len(alert_history) > 200:
        alert_history.pop()

    return jsonify(record)


# ══════════════════════════════════════════════════════════════════════
#  API — webhook.site integration
# ══════════════════════════════════════════════════════════════════════

@app.route("/api/webhook-site/create", methods=["POST"])
def create_webhook_site_token():
    """
    Create a new webhook.site token (free, no auth).
    Returns the webhook URL to use with Trio.
    """
    global webhook_site_token
    try:
        resp = http_requests.post(
            f"{WEBHOOK_SITE_BASE}/token",
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            json={"cors": True, "expiry": 604800},
            timeout=10,
        )
        resp.raise_for_status()
        token_data = resp.json()
        token_uuid = token_data.get("uuid", "")
        webhook_site_token = {
            "uuid": token_uuid,
            "url": f"{WEBHOOK_SITE_BASE}/{token_uuid}",
            "view_url": f"{WEBHOOK_SITE_BASE}/#!/view/{token_uuid}",
            "created_at": token_data.get("created_at", ""),
        }
        return jsonify(webhook_site_token)
    except Exception as exc:
        return jsonify({"error": f"Failed to create webhook.site token: {exc}"}), 502


@app.route("/api/webhook-site/token", methods=["GET"])
def get_webhook_site_token():
    """Return the current webhook.site token info."""
    if not webhook_site_token:
        return jsonify({"error": "No webhook.site token created yet"}), 404
    return jsonify(webhook_site_token)


@app.route("/api/webhook-site/events", methods=["GET"])
def get_webhook_site_events():
    """
    Poll webhook.site API to fetch events received by our token.
    Parses the Trio webhook payloads from each request's content.
    """
    if not webhook_site_token or not webhook_site_token.get("uuid"):
        return jsonify({"events": [], "total": 0})

    token_uuid = webhook_site_token["uuid"]
    try:
        resp = http_requests.get(
            f"{WEBHOOK_SITE_BASE}/token/{token_uuid}/requests",
            params={"sorting": "newest", "per_page": 50},
            headers={"Accept": "application/json"},
            timeout=10,
        )
        resp.raise_for_status()
        raw = resp.json()
    except Exception as exc:
        return jsonify({"events": [], "total": 0, "error": str(exc)})

    events = []
    for req_item in raw.get("data", []):
        content_str = req_item.get("content", "")
        try:
            payload = json.loads(content_str) if content_str else {}
        except json.JSONDecodeError:
            payload = {"raw": content_str}

        event_type = payload.get("type", "unknown")
        data = payload.get("data", {})

        # Classify danger for triggered events
        danger = "info"
        if event_type == "watch_triggered":
            danger = classify_danger(
                data.get("triggered", False),
                data.get("condition", ""),
                data.get("explanation", ""),
            )

        events.append({
            "id": req_item.get("uuid", "")[:8],
            "webhook_request_id": req_item.get("uuid", ""),
            "received_at": req_item.get("created_at", ""),
            "type": event_type,
            "danger_level": danger,
            "timestamp": payload.get("timestamp", req_item.get("created_at", "")),
            "source_url": payload.get("source_url", ""),
            "condition": data.get("condition", ""),
            "triggered": data.get("triggered", False),
            "explanation": data.get("explanation", ""),
            "frame_b64": data.get("frame_b64", ""),
            "job_id": data.get("job_id", ""),
            "status": data.get("status", ""),
            "reason": data.get("reason", ""),
            "checks_performed": data.get("checks_performed", 0),
            "triggers_fired": data.get("triggers_fired", 0),
        })

    return jsonify({"events": events, "total": raw.get("total", 0)})


# ══════════════════════════════════════════════════════════════════════
#  API — Continuous monitoring  (/live-monitor)
# ══════════════════════════════════════════════════════════════════════

@app.route("/api/monitor/start", methods=["POST"])
def start_monitor():
    """Start a continuous monitoring job via Trio /live-monitor."""
    data = request.json or {}
    stream_url = data.get("stream_url", "").strip()
    condition = data.get("condition", "").strip()
    webhook_url = data.get("webhook_url", "").strip()

    if not stream_url or not condition:
        return jsonify({"error": "stream_url and condition required"}), 400

    # Auto-use webhook.site URL if available and no custom URL given
    if not webhook_url and webhook_site_token.get("url"):
        webhook_url = webhook_site_token["url"]
    elif not webhook_url:
        webhook_url = request.url_root.rstrip("/") + "/api/webhook"

    try:
        result = trio.start_monitor(stream_url, condition, webhook_url)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502

    job_id = result.get("job_id", "unknown")
    active_monitors[job_id] = {
        "job_id": job_id,
        "stream_url": stream_url,
        "condition": condition,
        "webhook_url": webhook_url,
        "status": result.get("status", "running"),
        "started_at": datetime.utcnow().isoformat() + "Z",
    }
    return jsonify(active_monitors[job_id])


@app.route("/api/monitor/stop", methods=["POST"])
def stop_monitor():
    """Cancel a running monitoring job."""
    data = request.json or {}
    job_id = data.get("job_id", "").strip()
    if not job_id:
        return jsonify({"error": "job_id is required"}), 400
    try:
        result = trio.cancel_job(job_id)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502

    if job_id in active_monitors:
        active_monitors[job_id]["status"] = "stopped"
    return jsonify(result)


@app.route("/api/monitor/jobs", methods=["GET"])
def list_monitor_jobs():
    """List all monitoring jobs from Trio API."""
    try:
        result = trio.list_jobs()
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502
    return jsonify(result)


@app.route("/api/monitor/job/<job_id>", methods=["GET"])
def get_monitor_job(job_id):
    """Get details for a specific job."""
    try:
        result = trio.get_job(job_id)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502
    return jsonify(result)


# ══════════════════════════════════════════════════════════════════════
#  API — Webhook receiver
# ══════════════════════════════════════════════════════════════════════

@app.route("/api/webhook", methods=["POST"])
def webhook_receiver():
    """Receive webhook events from Trio API."""
    payload = request.json or {}
    event_type = payload.get("type", "unknown")
    data = payload.get("data", {})
    timestamp = payload.get("timestamp", datetime.utcnow().isoformat() + "Z")

    event_record = {
        "id": str(uuid.uuid4())[:8],
        "received_at": datetime.utcnow().isoformat() + "Z",
        "type": event_type,
        "timestamp": timestamp,
        "source_url": payload.get("source_url", ""),
        "data": data,
    }

    # Classify and store triggered events as alerts
    if event_type == "watch_triggered":
        danger = classify_danger(
            data.get("triggered", False),
            data.get("condition", ""),
            data.get("explanation", ""),
        )
        alert_record = {
            "id": event_record["id"],
            "timestamp": timestamp,
            "stream_url": payload.get("source_url", ""),
            "condition": data.get("condition", ""),
            "triggered": data.get("triggered", False),
            "explanation": data.get("explanation", ""),
            "latency_ms": 0,
            "danger_level": danger,
            "source": "webhook",
            "frame_b64": data.get("frame_b64", ""),
        }
        alert_history.insert(0, alert_record)

    # Handle job status changes
    if event_type in ("job_stopped", "job_completed", "job_failed"):
        job_id = data.get("job_id", "")
        if job_id in active_monitors:
            active_monitors[job_id]["status"] = data.get("status", "stopped")

    webhook_events.insert(0, event_record)
    if len(webhook_events) > 200:
        webhook_events.pop()

    return jsonify({"status": "ok"})


@app.route("/api/webhook/events", methods=["GET"])
def get_webhook_events():
    """Return recent webhook events."""
    return jsonify(webhook_events[:50])


# ══════════════════════════════════════════════════════════════════════
#  API — Live Digest  (/live-digest via SSE proxy)
# ══════════════════════════════════════════════════════════════════════

@app.route("/api/digest/start", methods=["POST"])
def start_digest():
    """
    Proxy the Trio /live-digest SSE stream to the browser.
    The browser calls this with EventSource.
    """
    data = request.json or {}
    stream_url = data.get("stream_url", "").strip()
    if not stream_url:
        return jsonify({"error": "stream_url is required"}), 400

    def generate():
        try:
            for line in trio.start_digest_sse(stream_url):
                yield line + "\n"
                # Also store summaries locally
                if line.startswith("data:"):
                    raw = line[5:].strip()
                    try:
                        parsed = json.loads(raw)
                        if parsed.get("type") == "summary":
                            digest_summaries.insert(0, {
                                "timestamp": datetime.utcnow().isoformat() + "Z",
                                "summary": parsed.get("summary", raw),
                                "stream_url": stream_url,
                            })
                    except json.JSONDecodeError:
                        pass
        except Exception as exc:
            yield f"data: {{\"type\":\"error\",\"message\":\"{exc}\"}}\n\n"

    return Response(
        stream_with_context(generate()),
        content_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.route("/api/digest/start-sse")
def start_digest_sse_get():
    """GET variant so the browser can use EventSource directly."""
    stream_url = request.args.get("stream_url", "").strip()
    if not stream_url:
        return jsonify({"error": "stream_url is required"}), 400

    def generate():
        try:
            for line in trio.start_digest_sse(stream_url):
                yield line + "\n"
        except Exception as exc:
            yield f"data: {{\"type\":\"error\",\"message\":\"{exc}\"}}\n\n"

    return Response(
        stream_with_context(generate()),
        content_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.route("/api/digest/summaries", methods=["GET"])
def get_digests():
    return jsonify(digest_summaries[:50])


# ══════════════════════════════════════════════════════════════════════
#  API — Alert history
# ══════════════════════════════════════════════════════════════════════

@app.route("/api/alerts", methods=["GET"])
def get_alerts():
    level = request.args.get("level", "").strip()
    if level:
        filtered = [a for a in alert_history if a.get("danger_level") == level]
        return jsonify(filtered[:100])
    return jsonify(alert_history[:100])


@app.route("/api/alerts/export", methods=["GET"])
def export_alerts():
    """Export alerts as downloadable JSON."""
    return Response(
        json.dumps(alert_history, indent=2),
        content_type="application/json",
        headers={"Content-Disposition": "attachment; filename=kidsguard_alerts.json"},
    )


@app.route("/api/alerts/clear", methods=["POST"])
def clear_alerts():
    alert_history.clear()
    return jsonify({"status": "cleared"})


# ══════════════════════════════════════════════════════════════════════
#  Run
# ══════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("\n🛡️  KidsGuard — AI-Powered Child Safety Monitoring")
    print("   Dashboard: http://localhost:5001\n")
    app.run(host="0.0.0.0", port=5001, debug=True)
