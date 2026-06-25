"""LangGraph ReAct agent (Gemini) — the UiPath coded-agent entrypoint (`graph.py:graph`).

Model = Google Gemini (BYO-key from GOOGLE_API_KEY). In the UiPath tenant, missing runtime
settings are loaded from Orchestrator assets; locally they come from the repo-root .env.
"""
from __future__ import annotations
import os
import sys
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

# Load the repo-root .env BEFORE importing modules that read env at import time.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
sys.path.insert(0, str(Path(__file__).resolve().parent))


def _hydrate_runtime_settings() -> None:
    """Load tenant runtime settings from Orchestrator without exposing secret values."""
    required = (
        "GOOGLE_API_KEY",
        "GEMINI_MODEL",
        "PRIMERO_API_BASE_URL",
        "PRIMERO_ANON_USERNAME",
        "PRIMERO_ANON_PASSWORD",
    )
    if all(os.environ.get(name) for name in required):
        return

    from uipath.platform import UiPath

    sdk = UiPath()
    folder_path = os.environ.get("UIPATH_FOLDER_PATH", "Shared")

    def secret(*names: str):
        for name in names:
            try:
                value = sdk.assets.retrieve_secret(name, folder_path=folder_path)
                if value:
                    return value
            except Exception:
                pass
        return None

    def text_asset(*names: str):
        for name in names:
            try:
                value = sdk.assets.retrieve(name, folder_path=folder_path).value
                if value:
                    return value
            except Exception:
                pass
        return None

    values = {
        "GOOGLE_API_KEY": secret("SWIMS_GOOGLE_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY"),
        "GEMINI_MODEL": text_asset("SWIMS_GEMINI_MODEL", "GEMINI_MODEL"),
        "PRIMERO_API_BASE_URL": text_asset("SWIMS_PRIMERO_API_BASE_URL", "SWIMS_API_BASE_URL", "PRIMERO_API_BASE_URL"),
        "PRIMERO_ANON_USERNAME": secret("SWIMS_PRIMERO_ANON_USERNAME", "SWIMS_ANONYMOUS_USERNAME", "PRIMERO_ANON_USERNAME"),
        "PRIMERO_ANON_PASSWORD": secret("SWIMS_PRIMERO_ANON_PASSWORD", "SWIMS_ANONYMOUS_PASSWORD", "PRIMERO_ANON_PASSWORD"),
    }
    for env_name, value in values.items():
        if not value:
            raise RuntimeError(f"Required Orchestrator setting is missing: {env_name}")
        os.environ.setdefault(env_name, str(value))

    # Optional: which district social worker owns anonymous reports (so a worker can act).
    # Worker/manager creds are NOT loaded here — authenticated ops use the per-request
    # acting-user session injected by the gateway, not a stored account.
    try:
        owner = text_asset("SWIMS_PRIMERO_DEFAULT_OWNER", "PRIMERO_DEFAULT_OWNER")
        if owner:
            os.environ.setdefault("PRIMERO_DEFAULT_OWNER", str(owner))
    except Exception:
        pass


# This must run before importing tools/primero because primero reads its base URL at import time.
_hydrate_runtime_settings()

from langchain_google_genai import ChatGoogleGenerativeAI  # noqa: E402
from langgraph.prebuilt import create_react_agent  # noqa: E402
from langgraph.graph import StateGraph, START, END, MessagesState  # noqa: E402

from tools import TOOLS  # noqa: E402
from prompts import SYSTEM_PROMPT  # noqa: E402


class SwimsState(MessagesState):
    """Agent state = conversation messages + the acting user's SWIMS session (cookie/csrf)."""
    swims_session: Optional[dict]
    swims_sender: Optional[str]
    swims_message_id: Optional[str]
    swims_channel: Optional[str]


def _make_agent(llm, tools, system):
    """create_react_agent's system-prompt kwarg name varies across langgraph versions."""
    for kw in ("prompt", "state_modifier", "messages_modifier"):
        try:
            return create_react_agent(llm, tools, **{kw: system})
        except TypeError:
            continue
    return create_react_agent(llm, tools)


def _wrap_with_auth(react):
    """Front the ReAct agent with an auth node so the invocation can carry the acting user's
    SWIMS session. The gateway passes `swims_session` ({cookie, csrf}) from the logged-in
    WhatsApp user; the node sets it so every tool acts AS that user (Primero enforces role).
    No session -> anonymous reporting only (create_case) + dev fallback."""
    from tools import set_acting_session, set_channel_context

    def auth(state):
        sess = state.get("swims_session") or {}
        set_acting_session(sess.get("cookie"), sess.get("csrf"))
        set_channel_context(state.get("swims_sender"), state.get("swims_message_id"), state.get("swims_channel"))
        return {}

    builder = StateGraph(SwimsState)
    builder.add_node("auth", auth)
    builder.add_node("agent", react)
    builder.add_edge(START, "auth")
    builder.add_edge("auth", "agent")
    builder.add_edge("agent", END)
    return builder.compile()


def build_graph(model: str | None = None):
    model = model or os.environ.get("GEMINI_MODEL", "gemini-3.1-pro-preview")
    llm = ChatGoogleGenerativeAI(
        model=model,
        google_api_key=os.environ.get("GOOGLE_API_KEY"),
        temperature=0,
    )
    return _wrap_with_auth(_make_agent(llm, TOOLS, SYSTEM_PROMPT))


# Module-level entrypoint UiPath introspects (langgraph.json -> graph.py:graph).
graph = build_graph()
