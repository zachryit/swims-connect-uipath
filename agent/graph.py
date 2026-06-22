"""LangGraph ReAct agent (Gemini) — the UiPath coded-agent entrypoint (`graph.py:graph`).

Model = Google Gemini (BYO-key from GOOGLE_API_KEY). In the UiPath tenant, missing runtime
settings are loaded from Orchestrator assets; locally they come from the repo-root .env.
"""
from __future__ import annotations
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

# Load the repo-root .env BEFORE importing modules that read env at import time.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
sys.path.insert(0, str(Path(__file__).resolve().parent))


def _hydrate_runtime_settings() -> None:
    """Load tenant runtime settings from Orchestrator without exposing secret values."""
    assets = {
        "GOOGLE_API_KEY": ("SWIMS_GOOGLE_API_KEY", True),
        "GEMINI_MODEL": ("SWIMS_GEMINI_MODEL", False),
        "PRIMERO_API_BASE_URL": ("SWIMS_PRIMERO_API_BASE_URL", False),
        "PRIMERO_ANON_USERNAME": ("SWIMS_PRIMERO_ANON_USERNAME", True),
        "PRIMERO_ANON_PASSWORD": ("SWIMS_PRIMERO_ANON_PASSWORD", True),
    }
    missing = {env: spec for env, spec in assets.items() if not os.environ.get(env)}
    if not missing:
        return

    from uipath.platform import UiPath

    sdk = UiPath()
    folder_path = os.environ.get("UIPATH_FOLDER_PATH", "Shared")
    for env_name, (asset_name, is_secret) in missing.items():
        if is_secret:
            value = sdk.assets.retrieve_secret(asset_name, folder_path=folder_path)
        else:
            asset = sdk.assets.retrieve(asset_name, folder_path=folder_path)
            value = getattr(asset, "value", None)
        if not value:
            raise RuntimeError(f"Required Orchestrator asset is missing or empty: {asset_name}")
        os.environ[env_name] = str(value)


# This must run before importing tools/primero because primero reads its base URL at import time.
_hydrate_runtime_settings()

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
