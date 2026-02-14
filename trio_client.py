"""
Trio API Client Wrapper for KidsGuard
Handles all communication with the Trio live stream monitoring API.
"""

import requests
import json
import time
from typing import Optional, Generator


class TrioClient:
    """Client wrapper for the Trio API (https://trio.machinefi.com)."""

    BASE_URL = "https://trio.machinefi.com/api"

    def __init__(self, api_key: str):
        self.api_key = api_key.strip()
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    # ------------------------------------------------------------------ #
    #  /check-once  –  single synchronous condition check
    # ------------------------------------------------------------------ #
    def check_once(self, stream_url: str, condition: str) -> dict:
        """
        Perform a single synchronous safety check on a live stream.

        Returns:
            {
                "triggered": bool,
                "explanation": str,
                "latency_ms": int
            }
        """
        payload = {
            "stream_url": stream_url,
            "condition": condition,
        }
        resp = requests.post(
            f"{self.BASE_URL}/check-once",
            headers=self.headers,
            json=payload,
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()

    # ------------------------------------------------------------------ #
    #  /live-monitor  –  continuous monitoring with webhook
    # ------------------------------------------------------------------ #
    def start_monitor(
        self,
        stream_url: str,
        condition: str,
        webhook_url: str,
    ) -> dict:
        """
        Start a continuous monitoring job.

        Returns:
            {
                "job_id": str,
                "status": "running"
            }
        """
        payload = {
            "stream_url": stream_url,
            "condition": condition,
            "webhook_url": webhook_url,
        }
        resp = requests.post(
            f"{self.BASE_URL}/live-monitor",
            headers=self.headers,
            json=payload,
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()

    # ------------------------------------------------------------------ #
    #  /live-monitor  –  SSE streaming mode
    # ------------------------------------------------------------------ #
    def start_monitor_sse(
        self,
        stream_url: str,
        condition: str,
    ) -> Generator[dict, None, None]:
        """
        Start a continuous monitoring job with SSE streaming.
        Yields parsed SSE events as dicts.
        """
        payload = {
            "stream_url": stream_url,
            "condition": condition,
        }
        sse_headers = {
            **self.headers,
            "Accept": "text/event-stream",
        }
        resp = requests.post(
            f"{self.BASE_URL}/live-monitor",
            headers=sse_headers,
            json=payload,
            stream=True,
            timeout=600,
        )
        resp.raise_for_status()

        for line in resp.iter_lines(decode_unicode=True):
            if line and line.startswith("data:"):
                data_str = line[len("data:"):].strip()
                try:
                    yield json.loads(data_str)
                except json.JSONDecodeError:
                    yield {"raw": data_str}

    # ------------------------------------------------------------------ #
    #  /live-digest  –  periodic narrative summaries (SSE)
    # ------------------------------------------------------------------ #
    def start_digest_sse(self, stream_url: str) -> Generator[str, None, None]:
        """
        Start a live digest job with SSE streaming.
        Yields raw SSE event lines.
        """
        payload = {"stream_url": stream_url}
        sse_headers = {
            **self.headers,
            "Accept": "text/event-stream",
        }
        resp = requests.post(
            f"{self.BASE_URL}/live-digest",
            headers=sse_headers,
            json=payload,
            stream=True,
            timeout=600,
        )
        resp.raise_for_status()

        for line in resp.iter_lines(decode_unicode=True):
            if line:
                yield line

    def start_digest_webhook(self, stream_url: str, webhook_url: str) -> dict:
        """Start a live digest job with webhook delivery."""
        payload = {
            "stream_url": stream_url,
            "webhook_url": webhook_url,
        }
        resp = requests.post(
            f"{self.BASE_URL}/live-digest",
            headers=self.headers,
            json=payload,
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()

    # ------------------------------------------------------------------ #
    #  /jobs  –  job management
    # ------------------------------------------------------------------ #
    def list_jobs(
        self,
        status: Optional[str] = None,
        job_type: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> dict:
        """
        List all jobs, optionally filtered by status / type.

        Returns:
            {
                "jobs": [...],
                "total": int,
                "limit": int,
                "offset": int
            }
        """
        params: dict = {"limit": limit, "offset": offset}
        if status:
            params["status"] = status
        if job_type:
            params["type"] = job_type

        resp = requests.get(
            f"{self.BASE_URL}/jobs",
            headers=self.headers,
            params=params,
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()

    def get_job(self, job_id: str) -> dict:
        """Get detailed status and statistics for a specific job."""
        resp = requests.get(
            f"{self.BASE_URL}/jobs/{job_id}",
            headers=self.headers,
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()

    def cancel_job(self, job_id: str) -> dict:
        """Cancel a running job immediately."""
        resp = requests.delete(
            f"{self.BASE_URL}/jobs/{job_id}",
            headers=self.headers,
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()

    # ------------------------------------------------------------------ #
    #  Convenience: validate that a stream URL is live
    # ------------------------------------------------------------------ #
    def validate_stream(self, stream_url: str) -> dict:
        """
        Quick validation by running a trivial check-once.
        If the stream is live, it returns a successful response.
        If not, the API returns a 400 with NOT_LIVESTREAM error.
        """
        try:
            result = self.check_once(stream_url, "Is this a live video stream?")
            return {
                "valid": True,
                "message": "Stream is live and accessible",
                "details": result,
            }
        except requests.exceptions.HTTPError as e:
            error_body = {}
            try:
                error_body = e.response.json()
            except Exception:
                pass
            return {
                "valid": False,
                "message": error_body.get("error", {}).get(
                    "message", str(e)
                ),
                "remediation": error_body.get("error", {}).get(
                    "remediation", ""
                ),
            }
        except requests.exceptions.RequestException as e:
            return {"valid": False, "message": str(e)}
