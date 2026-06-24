#!/usr/bin/env python3
"""Invoke the deployed SWIMS coded agent for one WhatsApp turn.

stdin : {"messages": [{"role","content"}, ...], "session": {"cookie","csrf"} | null}
stdout: a single line  <<<AGENT_RESULT>>>{"reply": "...", "state": "Successful"}
        (logs go to stderr so the Node side can parse the marker line)

Uses the proven path: StartJobs (REST) -> poll -> sdk.jobs.extract_output (reads the
job's output attachment). The agent's reply is the text of the last output message.
"""
import os, sys, json, time
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]  # /home/azureuser/swims-connect-uipath
load_dotenv(ROOT / ".env.uipath")

import requests  # noqa: E402
from uipath.platform import UiPath  # noqa: E402

URL = os.environ["UIPATH_URL"].rstrip("/")
ORCH = f"{URL}/orchestrator_"
PAT = os.environ.get("UIPATH_PAT") or os.environ.get("UIPATH_ACCESS_TOKEN")
FOLDER_ID = os.environ.get("SWIMS_SHARED_FOLDER_ID", "3141212")
RELEASE_KEY = os.environ.get("SWIMS_AGENT_RELEASE_KEY", "62d451f2-7ccb-4302-8841-826083aedf87")
H = {"Authorization": f"Bearer {PAT}", "X-UIPATH-OrganizationUnitId": FOLDER_ID, "Content-Type": "application/json"}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def emit(obj):
    print("<<<AGENT_RESULT>>>" + json.dumps(obj), flush=True)


def text_of(message):
    c = message.get("content")
    if isinstance(c, list):
        return " ".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text").strip()
    return str(c or "").strip()


def main():
    req = json.load(sys.stdin)
    inp = json.dumps({"messages": req.get("messages") or [], "swims_session": req.get("session")})

    start = requests.post(
        f"{ORCH}/odata/Jobs/UiPath.Server.Configuration.OData.StartJobs", headers=H,
        json={"startInfo": {"ReleaseKey": RELEASE_KEY, "Strategy": "ModernJobsCount", "JobsCount": 1, "InputArguments": inp}},
        timeout=60)
    if not start.ok:
        emit({"error": f"StartJobs {start.status_code}: {start.text[:200]}"}); return
    key = start.json()["value"][0]["Key"]
    log(f"job {key} started")

    state = None
    for _ in range(50):  # ~150s ceiling
        time.sleep(3)
        state = requests.get(f"{ORCH}/odata/Jobs?$filter=Key eq {key}&$select=State", headers=H, timeout=30).json()["value"][0]["State"]
        if state in ("Successful", "Faulted", "Stopped"):
            break
    log(f"job {key} -> {state}")
    if state != "Successful":
        emit({"error": f"agent job {state}", "state": state}); return

    sdk = UiPath()
    job = sdk.jobs.retrieve(job_key=key, folder_path="Shared")
    out = sdk.jobs.extract_output(job) or ""
    reply = ""
    try:
        msgs = json.loads(out).get("messages") or []
        # Only an assistant message is a valid reply — never echo the user's own message
        # back if the agent returned an empty turn.
        for m in reversed(msgs):
            if (m.get("type") or m.get("role")) in ("ai", "assistant"):
                t = text_of(m)
                if t:
                    reply = t
                    break
    except Exception as e:
        log("parse error:", e)
        reply = out
    emit({"reply": reply or "I'm sorry, I couldn't process that. Please try again.", "state": state})


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        emit({"error": f"{type(e).__name__}: {e}"})
