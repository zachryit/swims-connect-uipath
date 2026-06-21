"""LangChain tools the agent calls. In local dev these hit Primero directly via
primero.py; in the UiPath tenant the same operations are invoked as API Workflows
(swap the bodies for `sdk.processes.invoke(...)`), keeping the agent contract identical.
"""
from __future__ import annotations
from langchain_core.tools import tool

from primero import PrimeroClient, anon_client

_anon: PrimeroClient | None = None


def _client() -> PrimeroClient:
    """Cached anonymous-service-account client (community reports are anonymous)."""
    global _anon
    if _anon is None:
        _anon = anon_client()
    return _anon


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
) -> dict:
    """File a child-protection case in SWIMS/Primero from an intake report.

    Pass the full report text as `narrative`; set the other fields from whatever the
    report states (leave blank/None if not stated). `risk_level` is one of
    critical|high|medium|low. Returns the REAL SWIMS Case ID as `case_id_display` —
    report that value to the user verbatim and never invent one.
    """
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
        "follow_up_allowed": follow_up_allowed,
        "anonymous": True,
        "channel": "whatsapp_text",
    }
    return _client().create_case(report)


@tool
def get_case(case_id: str) -> dict:
    """Look up a SWIMS case by its case_id_display or UUID. Returns status, workflow stage,
    risk level, and key fields."""
    d = _client().get_case(case_id)
    return {
        "case_id_display": d.get("case_id_display"),
        "status": d.get("status"),
        "workflow": d.get("workflow"),
        "risk_level": d.get("risk_level"),
        "name": d.get("name"),
        "protection_concerns": d.get("protection_concerns"),
    }


@tool
def list_cases(per: int = 10, status: str = "", risk_level: str = "") -> list[dict]:
    """List recent SWIMS cases, optionally filtered by status (open|closed) or risk_level."""
    rows = _client().list_cases(per=per, status=status or None, risk_level=risk_level or None)
    return [
        {"case_id_display": r.get("case_id_display"), "status": r.get("status"),
         "risk_level": r.get("risk_level"), "workflow": r.get("workflow")}
        for r in rows
    ]


TOOLS = [create_case, get_case, list_cases]
