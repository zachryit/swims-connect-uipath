"""Primero / SWIMS REST client (Python port of the source runtime's swims-client + case-create).

Native Devise cookie auth (3-step) + the case-create field mapping, ported faithfully so
the UiPath coded agent writes the same valid records the original system did. In the UiPath
tenant these operations move into API Workflows / an Integration Service connector; this module
is the reference implementation + the local-dev path used to validate extraction quality.
"""
from __future__ import annotations
import os
import re
from datetime import date, datetime, timezone
from urllib.parse import unquote

import requests

from concerns import normalize_concerns

API_BASE = os.environ.get("PRIMERO_API_BASE_URL", "http://127.0.0.1:3000/api/v2").rstrip("/")
TIMEOUT = float(os.environ.get("PRIMERO_TIMEOUT_S", "60"))


# ── field helpers (ported) ────────────────────────────────────────────────────
def _normalise_sex(v) -> str | None:
    s = str(v or "").strip().lower()
    if re.fullmatch(r"m|male|boy|man|son|he|him", s):
        return "male"
    if re.fullmatch(r"f|female|girl|woman|daughter|she|her", s):
        return "female"
    return None


def _infer_sex_from_text(text: str) -> str | None:
    t = str(text or "").lower()
    if re.search(r"\b(girl|daughter|female|woman|she|her)\b", t):
        return "female"
    if re.search(r"\b(boy|son|male|man|he|his|him)\b", t):
        return "male"
    return None


def _infer_name_from_text(text: str) -> str | None:
    m = re.search(r"\b(?:named|called|name(?:'s| is)?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)", str(text or ""))
    return m.group(1).strip() if m else None


def _is_date(s) -> bool:
    return bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(s or "")))


def build_case_data(report: dict) -> dict:
    """Port of swims-case-create.js → the Primero `data` payload for POST /cases."""
    report = dict(report or {})
    narrative = report.get("narrative") or report.get("what_happened") or "(No narrative provided)"

    # infer sex / name from narrative when not explicitly given
    if not report.get("child_sex") and narrative:
        s = _infer_sex_from_text(narrative)
        if s:
            report["child_sex"] = s
    if report.get("child_sex"):
        report["child_sex"] = _normalise_sex(report["child_sex"])
    if not report.get("child_name") and narrative:
        n = _infer_name_from_text(narrative)
        if n:
            report["child_name"] = n

    concerns = report.get("protection_concerns") or []
    seed = list(concerns)
    if report.get("incident_type"):
        seed.append(report["incident_type"])
    concern_codes = normalize_concerns(seed, narrative)["codes"]

    report_dt = datetime.now(timezone.utc).isoformat()
    today = date.today().isoformat()
    wa_sender = report.get("whatsapp_sender") or report.get("sender")
    reporter_contact = report.get("reporter_contact")
    follow_up = report.get("follow_up_allowed")
    consent_text = "yes" if follow_up is True else ("NO" if follow_up is False else "not recorded")

    contact_lines = []
    if wa_sender:
        contact_lines.append(f"Reporter WhatsApp sender: {wa_sender}.")
    if reporter_contact and reporter_contact != wa_sender:
        contact_lines.append(f"Reporter provided callback contact: {reporter_contact}.")
    if not contact_lines:
        contact_lines.append("Reporter contact: unknown.")

    channel = report.get("channel") or ("anonymous" if report.get("anonymous") else "whatsapp_text")
    note_lines = [
        narrative, "", "—",
        f"Reported via {channel} on {today}.",
        *contact_lines,
        f"Reporter consents to follow-up contact: {consent_text}.",
    ]
    if report.get("incident_type"):
        note_lines.append(f"Incident type: {report['incident_type']}.")
    if report.get("urgency") or report.get("risk_level"):
        note_lines.append(f"Urgency: {report.get('urgency') or report.get('risk_level')}.")

    assessment_due = report.get("assessment_due_date")
    if assessment_due and not _is_date(assessment_due):
        assessment_due = None

    data = {
        "module_id": "primeromodule-cp",
        "status": "open",
        "record_state": True,
        "consent_for_services": True,
        "disclosure_other_orgs": True,
        "risk_level": report.get("risk_level") or "medium",
        "assessment_due_date": assessment_due or today,
        "protection_concerns": concern_codes,
        "hidden_name": report.get("hide_child_name") is True,
        "name": report.get("child_name") or "Unknown",
        "notes_section": [{
            "note_date": report_dt,
            "note_subject": "Initial report (SWIMS-Connect)",
            "note_text": "\n".join(str(l) for l in note_lines if l is not None),
        }],
    }
    if report.get("location_code"):
        data["location_current"] = report["location_code"]
    if report.get("location_name"):
        data["address_current"] = report["location_name"]
    if report.get("child_age") not in (None, ""):
        try:
            data["age"] = int(report["child_age"])
        except (TypeError, ValueError):
            pass
    if report.get("child_sex"):
        data["sex"] = report["child_sex"]
    return data


# ── client ──────────────────────────────────────────────────────────────────
class PrimeroClient:
    def __init__(self, base_url: str | None = None):
        self.base = (base_url or API_BASE).rstrip("/")
        self.s = requests.Session()
        self.s.headers.update({"Accept": "application/json"})
        self._user: dict | None = None

    def _csrf(self) -> str | None:
        raw = self.s.cookies.get("CSRF-TOKEN")
        return unquote(raw) if raw else None

    def login(self, username: str, password: str) -> dict:
        """3-step native Devise login. Returns the SWIMS user object on success."""
        if not username or not password:
            raise RuntimeError("Primero login requires a username and password")
        # 1: preflight GET seeds CSRF + session cookies
        self.s.get(f"{self.base}/identity_providers", timeout=TIMEOUT)
        csrf = self._csrf()
        if not csrf:
            raise RuntimeError("Could not obtain CSRF token from Primero")
        # 2: POST /tokens
        r = self.s.post(
            f"{self.base}/tokens",
            headers={"X-CSRF-Token": csrf},
            json={"user": {"user_name": username, "password": password}},
            timeout=TIMEOUT,
        )
        if r.status_code != 200:
            raise RuntimeError(f"Primero login failed (HTTP {r.status_code}): {r.text[:300]}")
        self._user = r.json()
        # 3: refresh CSRF for the post-login session
        self.s.get(f"{self.base}/identity_providers", timeout=TIMEOUT)
        return self._user

    def request(self, method: str, path: str, params: dict | None = None, json: dict | None = None) -> requests.Response:
        headers = {}
        if method.upper() not in ("GET", "HEAD"):
            csrf = self._csrf()
            if csrf:
                headers["X-CSRF-Token"] = csrf
        return self.s.request(method, f"{self.base}{path}", params=params, json=json, headers=headers, timeout=TIMEOUT)

    # ── high-level operations (mirror the source tools) ──
    def create_case(self, report: dict) -> dict:
        data = build_case_data(report)
        r = self.request("POST", "/cases", json={"data": data})
        if r.status_code not in (200, 201):
            body = r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text
            raise RuntimeError(f"Case creation failed (HTTP {r.status_code}): {body}")
        d = r.json().get("data", {})
        return {
            "ok": True,
            "case_id_display": d.get("case_id_display") or d.get("short_id"),
            "swims_case_id": d.get("id"),
            "protection_concerns": data["protection_concerns"],
            "assessment_due_date": data["assessment_due_date"],
        }

    def get_case(self, case_id: str) -> dict:
        r = self.request("GET", f"/cases/{case_id}")
        r.raise_for_status()
        return r.json().get("data", {})

    def list_cases(self, per: int = 20, **filters) -> list[dict]:
        params = {"per": per, **{k: v for k, v in filters.items() if v is not None}}
        r = self.request("GET", "/cases", params=params)
        r.raise_for_status()
        return r.json().get("data", [])


def anon_client() -> PrimeroClient:
    """A client logged in as the anonymous-reporter service account (from env)."""
    c = PrimeroClient()
    c.login(os.environ.get("PRIMERO_ANON_USERNAME", ""), os.environ.get("PRIMERO_ANON_PASSWORD", ""))
    return c
