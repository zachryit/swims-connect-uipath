"""Local test harness — exercises the agent end-to-end WITHOUT the UiPath runtime.

  python run_local.py "A 12-year-old boy is working in a mine in Tarkwa."

Loads .env, builds the LangGraph agent (Gemini), feeds the message, and prints every
tool call + the final reply so you can see the real SWIMS Case ID being created.
Falls back to GEMINI_FALLBACK_MODEL if the primary model id isn't available.
"""
from __future__ import annotations
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from graph import build_graph  # noqa: E402

DEFAULT_MSG = "A 12-year-old boy is working in a mine in Tarkwa. He looks malnourished and is not in school."


def _invoke(model: str | None, msg: str):
    g = build_graph(model)
    return g.invoke({"messages": [{"role": "user", "content": msg}]})


def main() -> int:
    msg = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_MSG
    print(f"\n>>> USER: {msg}\n")
    try:
        out = _invoke(None, msg)
    except Exception as e:  # primary model unavailable → fall back
        fb = os.environ.get("GEMINI_FALLBACK_MODEL", "gemini-2.5-flash")
        print(f"[primary model failed: {e}\n retrying with {fb}]\n")
        out = _invoke(fb, msg)

    for m in out["messages"]:
        role = getattr(m, "type", "?")
        calls = getattr(m, "tool_calls", None)
        if calls:
            for c in calls:
                print(f"[TOOL CALL] {c['name']}({json.dumps(c['args'], ensure_ascii=False)})")
        elif role == "tool":
            print(f"[TOOL RESULT] {m.content}")
        elif role == "ai" and getattr(m, "content", ""):
            content = m.content
            if isinstance(content, list):  # Gemini returns parts; keep only text
                content = " ".join(p.get("text", "") for p in content if isinstance(p, dict)).strip()
            if content:
                print(f"\n<<< AGENT: {content}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
