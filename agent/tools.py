"""LangChain tools the agent calls. In local dev these hit Primero directly via
primero.py; in the UiPath tenant the same operations are invoked as API Workflows
(swap the bodies for `sdk.processes.invoke(...)`), keeping the agent contract identical.
"""
from __future__ import annotations
import contextvars
from typing import Annotated

from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState

from primero import PrimeroClient, anon_client, worker_client, client_from_session

_anon: PrimeroClient | None = None
_worker_c: PrimeroClient | None = None

# The acting user's SWIMS session for the current invocation. PRIMARY channel is the graph
# state (InjectedState) — the gateway/auth-node puts the logged-in worker's session there, and
# state crosses node/process boundaries in the hosted runtime (module globals do NOT). The
# contextvars/globals below are a fallback for the local single-process path. There is NO
# hard-coded role — the user's real Primero role governs every authenticated action.
_acting_session: contextvars.ContextVar[dict | None] = contextvars.ContextVar("acting_session", default=None)
_acting_global: dict | None = None
_channel_context: contextvars.ContextVar[dict | None] = contextvars.ContextVar("channel_context", default=None)
_channel_global: dict | None = None


def set_acting_session(cookie: str | None, csrf: str | None) -> None:
    """Set the logged-in user's SWIMS session for this invocation (or clear it with None)."""
    global _acting_global
    val = {"cookie": cookie, "csrf": csrf} if cookie else None
    _acting_session.set(val)
    _acting_global = val


def set_channel_context(sender: str | None, message_id: str | None, channel: str | None = "whatsapp") -> None:
    global _channel_global
    val = {"sender": sender, "message_id": message_id, "channel": channel or "whatsapp"}
    _channel_context.set(val)
    _channel_global = val


def _session_from(state: dict | None) -> dict | None:
    """The acting session for THIS call: injected graph state first (cross-process safe),
    then the contextvar/global fallback (local path)."""
    if state:
        s = state.get("swims_session")
        if isinstance(s, dict) and s.get("cookie"):
            return s
    return _acting_session.get() or _acting_global


def _channel(state: dict | None = None) -> dict:
    if state and (state.get("swims_sender") or state.get("swims_channel")):
        return {"sender": state.get("swims_sender"), "message_id": state.get("swims_message_id"),
                "channel": state.get("swims_channel") or "whatsapp"}
    return _channel_context.get() or _channel_global or {}


def _client() -> PrimeroClient:
    """Cached anonymous-service-account client (community reports are anonymous)."""
    global _anon
    if _anon is None:
        _anon = anon_client()
    return _anon


def _worker() -> PrimeroClient:
    """Dev-only fallback worker login, used when no acting-user session is injected."""
    global _worker_c
    if _worker_c is None:
        _worker_c = worker_client()
    return _worker_c


def _acting(state: dict | None = None) -> PrimeroClient:
    """The authenticated user acting now: their injected session. All authenticated lifecycle
    actions (incl. close) run as this user; Primero enforces role."""
    sess = _session_from(state)
    if sess and sess.get("cookie"):
        return client_from_session(sess["cookie"], sess["csrf"])
    raise PermissionError("needs_login: worker authentication is required for this SWIMS action")


def _has_acting(state: dict | None = None) -> bool:
    sess = _session_from(state)
    return bool(sess and sess.get("cookie"))


def _needs_login(action: str = "this SWIMS action") -> dict:
    return {
        "ok": False,
        "needs_login": True,
        "message": f"To use {action}, you need to be a signed-in SWIMS worker.",
    }


@tool
def create_case(
    narrative: str,
    incident_type: str = "",
    risk_level: str = "medium",
    urgency: str = "",
    protection_concerns: list[str] | None = None,
    location_name: str = "",
    location_code: str = "",
    child_name: str = "",
    child_age: int | None = None,
    child_sex: str = "",
    reporter_contact: str = "",
    follow_up_allowed: bool | None = None,
    state: Annotated[dict, InjectedState] = None,
) -> dict:
    """File a child-protection case in SWIMS/Primero from an intake report.

    DO NOT call this on the same turn the concern is first described. Call it ONLY AFTER the
    reporter has answered the follow-up-consent question (yes/no), and pass their answer as
    `follow_up_allowed`. Asking consent first is mandatory for community reports.

    Pass the full report text as `narrative`; set the other fields from whatever the
    report states (leave blank/None if not stated). `risk_level` is one of
    critical|high|medium|low. Returns the REAL SWIMS Case ID as `case_id_display` —
    report that value to the user verbatim and never invent one.
    """
    ctx = _channel(state)
    use_worker = _has_acting(state)
    report = {
        "narrative": narrative,
        "incident_type": incident_type or None,
        "risk_level": risk_level or None,
        "urgency": urgency or None,
        "protection_concerns": protection_concerns or [],
        "location_name": location_name or None,
        "location_code": location_code or None,
        "child_name": child_name or None,
        "child_age": child_age,
        "child_sex": child_sex or None,
        "reporter_contact": reporter_contact or None,
        "whatsapp_sender": ctx.get("sender"),
        "message_id": ctx.get("message_id"),
        "follow_up_allowed": follow_up_allowed,
        "anonymous": not use_worker,
        "channel": ctx.get("channel") or "whatsapp_text",
    }
    return (_acting(state) if use_worker else _client()).create_case(report)


@tool
def get_case(case_id: str, state: Annotated[dict, InjectedState] = None) -> dict:
    """Look up a SWIMS case by its case_id_display or UUID. Returns status, workflow stage,
    risk level, and key fields. Reads as the acting (logged-in) user — Primero scopes
    visibility to cases they own/are assigned."""
    if not _has_acting(state):
        return _needs_login("case information")
    d = _acting(state).get_case(case_id)
    if not d:
        return {"ok": False, "message": f"I couldn't find case {case_id}, or you don't have access to it."}
    return {
        "case_id_display": d.get("case_id_display"),
        "status": d.get("status"),
        "workflow": d.get("workflow"),
        "risk_level": d.get("risk_level"),
        "name": d.get("name"),
        "protection_concerns": d.get("protection_concerns"),
    }


@tool
def list_cases(per: int = 10, status: str = "", risk_level: str = "",
               state: Annotated[dict, InjectedState] = None) -> list[dict]:
    """List recent SWIMS cases (as the acting user), optionally filtered by status
    (open|closed) or risk_level."""
    if not _has_acting(state):
        return [_needs_login("case lists and reports")]
    rows = _acting(state).list_cases(per=per, status=status or None, risk_level=risk_level or None)
    return [
        {"case_id_display": r.get("case_id_display"), "status": r.get("status"),
         "risk_level": r.get("risk_level"), "workflow": r.get("workflow")}
        for r in rows
    ]


@tool
def find_services(district: str = "", category: str = "", search: str = "") -> dict:
    """Look up real service providers in the Ghana Social Welfare Service Directory (Collation)
    to refer a case to. Filter by district/region, service `category`, or a free `search` term
    (e.g. an org name/abbreviation like CHRAJ). Returns providers with contact details. Use this
    to pick a REAL provider (name + phone/contact) before calling add_service_referral."""
    from collation import find_services as _find
    rows = _find(district=district or None, category=category or None, search=search or None)
    return {"ok": True, "count": len(rows), "services": rows}


# ── lifecycle write tools — all run as the acting (logged-in) user via _acting() ──
# No hard-coded role: Primero enforces what the user may do. Worker close -> 403 ->
# approval requested; manager close -> done. Maestro Case invokes these per stage.

@tool
def record_assessment(case_id: str, assessment_date: str, case_plan_due: str,
                      requested_by: str = "", threats: str = "", capacities: str = "",
                      category: str = "", decision: str = "",
                      state: Annotated[dict, InjectedState] = None) -> dict:
    """Record the safety assessment on a SWIMS case and advance it to the assessment stage.
    Dates are YYYY-MM-DD. `category` is one of safe|safety_plan|unsafe. `case_plan_due` is
    required (it creates the native Case Plan task). Use after the intake report is filed."""
    if not _has_acting(state):
        return _needs_login("case lifecycle updates")
    return _acting(state).record_assessment(
        case_id, assessment_date=assessment_date, case_plan_due=case_plan_due,
        requested_by=requested_by or None, threats=threats or None, capacities=capacities or None,
        category=category or None, decision=decision or None)


@tool
def record_case_plan(case_id: str, date: str, goal: str = "", goal_due: str = "",
                    review_date: str = "", interventions: list[dict] | None = None,
                    state: Annotated[dict, InjectedState] = None) -> dict:
    """Record the case plan (advances the case to the case_plan stage) and add interventions.
    `date` (YYYY-MM-DD) is the workflow trigger. `interventions` is a list of
    {service, goal?, provider?, due?} items."""
    if not _has_acting(state):
        return _needs_login("case lifecycle updates")
    return _acting(state).record_case_plan(
        case_id, date=date, goal=goal or None, goal_due=goal_due or None,
        review_date=review_date or None, interventions=interventions or [])


@tool
def add_service_referral(case_id: str, service_type: str, timeframe: str,
                        appointment: str = "", notes: str = "", provider: str = "",
                        state: Annotated[dict, InjectedState] = None) -> dict:
    """Refer a service on a SWIMS case (advances to service_provision). `service_type` e.g.
    psychosocial_service, health_medical_service. `timeframe` is one of 1_hour|3_hours|1_day|3_days."""
    if not _has_acting(state):
        return _needs_login("case service referrals")
    return _acting(state).add_service_referral(
        case_id, service_type=service_type, timeframe=timeframe,
        appointment=appointment or None, notes=notes or None, provider=provider or None)


@tool
def mark_service_delivered(case_id: str, date: str, service_type: str = "", service_id: str = "",
                           state: Annotated[dict, InjectedState] = None) -> dict:
    """Mark a referred service delivered (YYYY-MM-DD). Identify it by service_type or service_id.
    When all services are delivered the case advances to services_implemented."""
    if not _has_acting(state):
        return _needs_login("case service updates")
    return _acting(state).mark_service_delivered(
        case_id, date=date, service_type=service_type or None, service_id=service_id or None)


@tool
def record_followup(case_id: str, needed_by: str = "", date: str = "", followup_type: str = "",
                   service_type: str = "", comments: str = "",
                   state: Annotated[dict, InjectedState] = None) -> dict:
    """Add a follow-up to a SWIMS case. Provide `needed_by` (planned, YYYY-MM-DD) or `date`
    (completed). Optional followup_type, service_type, comments."""
    if not _has_acting(state):
        return _needs_login("case follow-up updates")
    return _acting(state).record_followup(
        case_id, needed_by=needed_by or None, date=date or None,
        followup_type=followup_type or None, service_type=service_type or None, comments=comments or None)


@tool
def close_case(case_id: str, reason: str = "", notes: str = "",
               state: Annotated[dict, InjectedState] = None) -> dict:
    """Close a SWIMS case. If the acting account lacks the CLOSE permission (CP Worker), this
    returns approval_requested=true and routes the closure to a CP Manager for approval."""
    if not _has_acting(state):
        return _needs_login("case closure")
    return _acting(state).close_case(case_id, reason=reason or None, notes=notes or None)


TOOLS = [
    create_case, get_case, list_cases, find_services,
    record_assessment, record_case_plan, add_service_referral,
    mark_service_delivered, record_followup, close_case,
]
