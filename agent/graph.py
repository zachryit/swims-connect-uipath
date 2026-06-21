"""LangGraph ReAct agent (Gemini) — the UiPath coded-agent entrypoint (`graph.py:graph`).

Model = Google Gemini (BYO-key from GOOGLE_API_KEY). In the UiPath tenant the key comes
from an Orchestrator Credential/Secret asset injected as an env var; locally it comes from .env.
"""
from __future__ import annotations
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

# Load the repo-root .env BEFORE importing modules that read env at import time.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
sys.path.insert(0, str(Path(__file__).resolve().parent))

from langchain_google_genai import ChatGoogleGenerativeAI  # noqa: E402
from langgraph.prebuilt import create_react_agent  # noqa: E402

from tools import TOOLS  # noqa: E402
from prompts import SYSTEM_PROMPT  # noqa: E402


def _make_agent(llm, tools, system):
    """create_react_agent's system-prompt kwarg name varies across langgraph versions."""
    for kw in ("prompt", "state_modifier", "messages_modifier"):
        try:
            return create_react_agent(llm, tools, **{kw: system})
        except TypeError:
            continue
    return create_react_agent(llm, tools)


def build_graph(model: str | None = None):
    model = model or os.environ.get("GEMINI_MODEL", "gemini-3.1-pro-preview")
    llm = ChatGoogleGenerativeAI(
        model=model,
        google_api_key=os.environ.get("GOOGLE_API_KEY"),
        temperature=0,
    )
    return _make_agent(llm, TOOLS, SYSTEM_PROMPT)


# Module-level entrypoint UiPath introspects (langgraph.json -> graph.py:graph).
graph = build_graph()
