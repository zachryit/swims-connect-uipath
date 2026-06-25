"""LangGraph ReAct agent (Gemini) — the UiPath coded-agent entrypoint (`graph.py:graph`).

Model = Google Gemini (BYO-key from GOOGLE_API_KEY). In the UiPath tenant, missing runtime
settings are loaded from Orchestrator assets; locally they come from the repo-root .env.
"""
from __future__ import annotations
import os
import re
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

    # Optional: worker auth-context bridge. The agent exchanges an opaque token (carried in the
    # message by the gateway) for the logged-in worker's Primero session via this endpoint.
    # If unset, worker features stay gated (anonymous reporting is unaffected).
    try:
        bridge_url = text_asset("SWIMS_BRIDGE_URL")
        if bridge_url:
            os.environ.setdefault("SWIMS_BRIDGE_URL", str(bridge_url))
        bridge_secret = secret("SWIMS_BRIDGE_SECRET") or text_asset("SWIMS_BRIDGE_SECRET")
        if bridge_secret:
            os.environ.setdefault("SWIMS_BRIDGE_SECRET", str(bridge_secret))
    except Exception:
        pass


# This must run before importing tools/primero because primero reads its base URL at import time.
_hydrate_runtime_settings()

from langchain_google_genai import ChatGoogleGenerativeAI  # noqa: E402
from langgraph.prebuilt import create_react_agent  # noqa: E402
from langgraph.prebuilt.chat_agent_executor import AgentState  # noqa: E402
from langgraph.graph import StateGraph, START, END, MessagesState  # noqa: E402

from tools import TOOLS  # noqa: E402
from prompts import SYSTEM_PROMPT  # noqa: E402


class SwimsState(MessagesState):
    """Agent state = conversation messages + the acting user's SWIMS session (cookie/csrf)."""
    swims_session: Optional[dict]
    swims_sender: Optional[str]
    swims_message_id: Optional[str]
    swims_channel: Optional[str]


class ReactState(AgentState):
    """The ReAct sub-agent's state. Carrying the SWIMS session HERE (not in a module global)
    is what lets tools read it via InjectedState — graph state crosses node/process boundaries
    in the hosted runtime, module globals do not."""
    swims_session: Optional[dict]
    swims_sender: Optional[str]
    swims_message_id: Optional[str]
    swims_channel: Optional[str]


def _make_agent(llm, tools, system):
    """create_react_agent's system-prompt kwarg name varies across langgraph versions."""
    for kw in ("prompt", "state_modifier", "messages_modifier"):
        try:
            return create_react_agent(llm, tools, state_schema=ReactState, **{kw: system})
        except TypeError:
            continue
    return create_react_agent(llm, tools, state_schema=ReactState)


_CTX_RE = re.compile(r"\[SWIMS_CTX\s+([^\]]+)\]")


def _resolve_bridge_token(token: str) -> dict | None:
    """Exchange an opaque bridge token for the worker's Primero session via the gateway's
    secret-protected resolver. Returns {cookie, csrf, sender, user} or None."""
    url = os.environ.get("SWIMS_BRIDGE_URL")
    secret_val = os.environ.get("SWIMS_BRIDGE_SECRET")
    if not (url and secret_val and token):
        return None
    try:
        import requests
        r = requests.post(url, headers={"X-Bridge-Auth": secret_val, "Content-Type": "application/json"},
                          json={"token": token}, timeout=20)
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return None


def _wrap_with_auth(react):
    """Front the ReAct agent with an auth node that establishes the acting worker's SWIMS
    session. A conversational agent can only receive the message text, so the gateway prepends
    an opaque, sender-bound, short-TTL token ([SWIMS_CTX ...]) for signed-in workers; this node
    exchanges it for the worker's Primero session, sets it so every tool acts AS that user
    (Primero enforces role), and STRIPS the token before the LLM sees it. No token -> anonymous
    reporting only. Also honors a direct `swims_session` for the non-conversational job path."""
    from tools import set_acting_session, set_channel_context
    from langchain_core.messages import HumanMessage

    def _text_of(content):
        if isinstance(content, str):
            return content
        if isinstance(content, list):  # some runtimes deliver content as parts
            return " ".join(p.get("text", "") for p in content if isinstance(p, dict))
        return ""

    def auth(state):
        cookie = csrf = sender = None
        updated = None
        for m in reversed(state.get("messages") or []):
            content = getattr(m, "content", None)
            text = _text_of(content)
            if text and "[SWIMS_CTX" in text:
                match = _CTX_RE.search(text)
                if match:
                    ctx = _resolve_bridge_token(match.group(1).strip())
                    if ctx:
                        cookie, csrf, sender = ctx.get("cookie"), ctx.get("csrf"), ctx.get("sender")
                    mid = getattr(m, "id", None)
                    if mid and isinstance(content, str):  # strip so the LLM never sees the token
                        updated = HumanMessage(content=_CTX_RE.sub("", content).strip(), id=mid)
                break
        if not cookie:  # non-conversational job path / dev fallback
            sess = state.get("swims_session") or {}
            cookie, csrf = sess.get("cookie"), sess.get("csrf")
            sender = sender or state.get("swims_sender")
        set_acting_session(cookie, csrf)  # local single-process fallback
        sender = sender or state.get("swims_sender")
        set_channel_context(sender, state.get("swims_message_id"), state.get("swims_channel"))
        # PRIMARY channel: put the session in graph state so the ReAct tools read it via
        # InjectedState (works across the hosted runtime's node/process boundaries).
        out = {
            "swims_session": {"cookie": cookie, "csrf": csrf} if cookie else None,
            "swims_sender": sender,
            "swims_channel": state.get("swims_channel") or "whatsapp",
            "swims_message_id": state.get("swims_message_id"),
        }
        if updated is not None:
            out["messages"] = [updated]
        return out

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
