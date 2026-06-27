"""Primero / SWIMS REST client for the UiPath conversational agent.

Implements native Devise cookie authentication and the case field mappings used by the deployed
agent and local development.
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
_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


# ── field helpers ─────────────────────────────────────────────────────────────
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
    """Build the Primero `data` payload for POST /cases."""
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
    if report.get("message_id"):
        note_lines.append(f"Source message ID: {report['message_id']}.")
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
    # Route ownership to a case worker so they can act on the case (Primero access is
    # owner-based). Anonymous WhatsApp reports are owned by a district social worker —
    # mirrors swims_connect.rb's owner_for_swims_case. Explicit owned_by > env default.
    owner = report.get("owned_by") or os.environ.get("PRIMERO_DEFAULT_OWNER")
    if owner:
        data["owned_by"] = owner
    return data


# ── client ──────────────────────────────────────────────────────────────────
class PrimeroClient:
    def __init__(self, base_url: str | None = None):
        self.base = (base_url or API_BASE).rstrip("/")
        self.s = requests.Session()
        self.s.headers.update({"Accept": "application/json"})
        self._user: dict | None = None
        # Freshest CSRF token the server issued, tracked in RESPONSE order (see _capture_csrf).
        self._csrf_token: str | None = None
        # Creds held after a login() so a CSRF/session failure can transparently re-auth.
        self._creds: tuple[str, str] | None = None

    def _capture_csrf(self, resp: requests.Response) -> requests.Response:
        """Record the freshest CSRF token the server issued, in RESPONSE order.

        Primero/Rails RESETS the session and ROTATES the CSRF-TOKEN on login (POST /tokens),
        so the X-CSRF-Token sent on a later POST must be the post-login token — a stale one
        yields `403 ActionController::InvalidAuthenticityToken`. The cookiejar can retain
        stale/duplicate CSRF-TOKEN entries whose *iteration order* is not stable across
        requests/urllib3/Python versions, so the header must NOT be derived from jar order.
        Response order is deterministic, so we take the token from each response's Set-Cookie."""
        for r in [*resp.history, resp]:
            raw = None
            try:
                raw = r.cookies.get("CSRF-TOKEN")
            except Exception:  # CookieConflictError (same name, different scope)
                for ck in r.cookies:
                    if ck.name == "CSRF-TOKEN":
                        raw = ck.value
            if raw:
                self._csrf_token = unquote(raw)
        return resp

    def _csrf(self) -> str | None:
        if self._csrf_token:
            return self._csrf_token
        # Fallback for clients built from an injected session (no login round-trip).
        raw = None
        for ck in self.s.cookies:
            if ck.name == "CSRF-TOKEN":
                raw = ck.value
        if raw:
            self._csrf_token = unquote(raw)
        return self._csrf_token

    @staticmethod
    def _is_csrf_error(resp: requests.Response) -> bool:
        if resp.status_code != 403:
            return False
        try:
            return "InvalidAuthenticityToken" in resp.text
        except Exception:
            return False

    def login(self, username: str, password: str) -> dict:
        """3-step native Devise login. Returns the SWIMS user object on success."""
        if not username or not password:
            raise RuntimeError("Primero login requires a username and password")
        # 1: preflight GET seeds CSRF + session cookies
        self._capture_csrf(self.s.get(f"{self.base}/identity_providers", timeout=TIMEOUT))
        csrf = self._csrf()
        if not csrf:
            raise RuntimeError("Could not obtain CSRF token from Primero")
        # 2: POST /tokens (also rotates the session + CSRF-TOKEN — captured for later POSTs)
        r = self._capture_csrf(self.s.post(
            f"{self.base}/tokens",
            headers={"X-CSRF-Token": csrf},
            json={"user": {"user_name": username, "password": password}},
            timeout=TIMEOUT,
        ))
        if r.status_code != 200:
            raise RuntimeError(f"Primero login failed (HTTP {r.status_code}): {r.text[:300]}")
        self._user = r.json()
        self._creds = (username, password)
        # 3: refresh CSRF for the post-login (rotated) session
        self._capture_csrf(self.s.get(f"{self.base}/identity_providers", timeout=TIMEOUT))
        return self._user

    def _send(self, method: str, path: str, params: dict | None = None, json: dict | None = None) -> requests.Response:
        headers = {}
        if method.upper() not in ("GET", "HEAD"):
            csrf = self._csrf()
            if csrf:
                headers["X-CSRF-Token"] = csrf
        return self._capture_csrf(
            self.s.request(method, f"{self.base}{path}", params=params, json=json, headers=headers, timeout=TIMEOUT))

    def request(self, method: str, path: str, params: dict | None = None, json: dict | None = None) -> requests.Response:
        resp = self._send(method, path, params=params, json=json)
        # A stale X-CSRF-Token (cookiejar ordering differences across runtimes, or a session
        # that expired/rotated in a long-lived hosted process) yields 403 InvalidAuthenticityToken.
        # Refresh the token on the current session and retry once; if the session itself is gone
        # and we hold creds, re-login and retry. Idempotent for the GET-refresh; create_case is
        # only reached once per turn so a single retry cannot double-file.
        if method.upper() not in ("GET", "HEAD") and self._is_csrf_error(resp):
            self._capture_csrf(self.s.get(f"{self.base}/identity_providers", timeout=TIMEOUT))
            resp = self._send(method, path, params=params, json=json)
            if self._is_csrf_error(resp) and self._creds:
                self.login(*self._creds)
                resp = self._send(method, path, params=params, json=json)
        return resp

    # ── high-level operations (mirror the source tools) ──
    def create_case(self, report: dict) -> dict:
        data = build_case_data(report)
        # Idempotency at the source-system edge: WhatsApp retries and gateway restarts must not
        # create duplicate child-protection cases for the same inbound message.
        # Primero has no dedicated idempotency key in this deployment, so this remains best-effort
        # at the gateway level; the message_id is still persisted in the initial note for audit.
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

    def _case_uuid(self, case_id: str) -> str | None:
        """Resolve a SWIMS Case ID to the record UUID. Primero's /cases/{id} endpoint needs the
        UUID; people (and list_cases) use the short case_id_display (e.g. '43abe2a'). Returns the
        UUID, or None if the short id can't be found (so callers fail gracefully, not with a 404)."""
        cid = str(case_id or "").strip()
        if _UUID_RE.match(cid):
            return cid
        r = self.request("GET", "/cases", params={"query": cid, "per": 20})
        if r.status_code == 200:
            rows = r.json().get("data", [])
            exact = next((x for x in rows if str(x.get("case_id_display") or x.get("short_id") or "") == cid), None)
            if exact and exact.get("id"):
                return exact["id"]
            if len(rows) == 1 and rows[0].get("id"):
                return rows[0]["id"]
        return None

    def get_case(self, case_id: str) -> dict:
        uuid = self._case_uuid(case_id)
        if not uuid:
            return {}  # not found / not accessible — caller returns a friendly message
        r = self.request("GET", f"/cases/{uuid}")
        if r.status_code != 200:
            return {}
        return r.json().get("data", {})

    def list_cases(self, per: int = 20, **filters) -> list[dict]:
        params = {"per": per, **{k: v for k, v in filters.items() if v is not None}}
        r = self.request("GET", "/cases", params=params)
        r.raise_for_status()
        return r.json().get("data", [])

    # ── lifecycle write operations ────────────────────────────────────────────
    @staticmethod
    def _norm(v) -> str:
        return str(v if v is not None else "").strip().lower()

    def _patch(self, case_id: str, data: dict, record_action: str | None = None) -> requests.Response:
        uuid = self._case_uuid(case_id) or case_id  # lifecycle PATCHes also need the UUID
        body: dict = {"data": data}
        if record_action:
            body["record_action"] = record_action
        return self.request("PATCH", f"/cases/{uuid}", json=body)

    @staticmethod
    def _ok(r: requests.Response, op: str) -> dict:
        if r.status_code in (200, 201):
            return r.json().get("data", {})
        if r.status_code == 403:
            raise PermissionError(f"{op}: NOT_AUTHORIZED (HTTP 403)")
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text
        raise RuntimeError(f"{op} failed (HTTP {r.status_code}): {body}")

    def record_assessment(self, case_id: str, *, assessment_date: str, case_plan_due: str,
                          requested_by: str | None = None, threats: str | None = None,
                          capacities: str | None = None, category: str | None = None,
                          decision: str | None = None) -> dict:
        """Advance the case to assessment and record its safety content in one PATCH."""
        data = {"assessment_requested_on": assessment_date, "workflow": "assessment",
                "case_plan_due_date": case_plan_due}
        if requested_by: data["assessment_requested_by"] = requested_by
        if threats: data["assessment_safety_threats_present"] = threats
        if capacities: data["assessment_safety_protective_capacities"] = capacities
        if category: data["assessment_safety_category"] = category
        if decision: data["assessment_safety_category_decision"] = decision
        d = self._ok(self._patch(case_id, data), "record_assessment")
        return {"ok": True, "workflow": d.get("workflow"), "assessment_date": d.get("assessment_requested_on")}

    def add_intervention(self, case_id: str, *, service: str, goal: str | None = None,
                         provider: str | None = None, due: str | None = None) -> dict:
        """Append one case-plan intervention, deduplicated by service name."""
        current = self.get_case(case_id).get("cp_case_plan_subform_case_plan_interventions") or []
        if any(self._norm(it.get("intervention_service_to_be_provided")) == self._norm(service) for it in current):
            return {"ok": True, "skipped": True, "intervention": service}
        entry = {"intervention_service_to_be_provided": service}
        if goal: entry["intervention_service_goal"] = goal
        if provider: entry["case_plan_provider_and_contact_details"] = provider
        if due: entry["case_plan_timeframe"] = due
        self._ok(self._patch(case_id, {"cp_case_plan_subform_case_plan_interventions": [entry]}), "add_intervention")
        return {"ok": True, "intervention": service}

    def record_case_plan(self, case_id: str, *, date: str, goal: str | None = None,
                         goal_due: str | None = None, review_date: str | None = None,
                         interventions: list[dict] | None = None) -> dict:
        """Set the case-plan workflow trigger, then append any interventions."""
        data = {"date_case_plan": date, "workflow": "case_plan"}
        if goal: data["case_plan_goal"] = goal
        if goal_due: data["case_plan_goal_due_date"] = goal_due
        if review_date: data["case_plan_target_review_date"] = review_date
        d = self._ok(self._patch(case_id, data), "record_case_plan")
        added = [self.add_intervention(case_id, **iv) for iv in (interventions or [])]
        return {"ok": True, "workflow": d.get("workflow"), "interventions": added}

    def add_service_referral(self, case_id: str, *, service_type: str, timeframe: str,
                             appointment: str | None = None, response_type: str = "service_provision",
                             notes: str | None = None, provider: str | None = None) -> dict:
        """Append a pending service and advance to service provision."""
        from datetime import timedelta
        now = datetime.now(timezone.utc)
        tf = {"1_hour": timedelta(hours=1), "3_hours": timedelta(hours=3),
              "1_day": timedelta(days=1), "3_days": timedelta(days=3)}.get(timeframe, timedelta(days=1))
        entry = {"service_type": service_type, "service_implemented": "not_implemented",
                 "service_response_type": response_type, "service_response_day_time": now.isoformat(),
                 "service_response_timeframe": timeframe,
                 "service_appointment_date": appointment or (now + tf).date().isoformat()}
        if notes: entry["service_referral_notes"] = notes
        if provider: entry["service_provider"] = provider
        current = self.get_case(case_id).get("services_section") or []
        keys = [k for k in entry if entry[k] not in (None, "")]
        if any(all(self._norm(it.get(k)) == self._norm(entry[k]) for k in keys) for it in current):
            return {"ok": True, "skipped": True, "service": service_type}
        d = self._ok(self._patch(case_id, {"workflow": "service_provision", "services_section": [entry]}), "add_service_referral")
        return {"ok": True, "workflow": d.get("workflow"), "service": service_type}

    def mark_service_delivered(self, case_id: str, *, date: str, service_id: str | None = None,
                              service_type: str | None = None) -> dict:
        """Mark a service delivered and advance when every service is implemented."""
        services = self.get_case(case_id).get("services_section") or []
        impl = lambda s: self._norm(s.get("service_implemented")) == "implemented"
        if service_id:
            target = next((s for s in services if s.get("unique_id") == service_id), None)
        elif service_type:
            target = (next((s for s in services if s.get("service_type") == service_type and not impl(s)), None)
                      or next((s for s in services if s.get("service_type") == service_type), None))
        else:
            raise RuntimeError("mark_service_delivered needs service_id or service_type")
        if not target:
            raise RuntimeError("SERVICE_NOT_FOUND")
        if impl(target):
            return {"ok": True, "already_implemented": True}
        updated = {**target, "service_implemented": "implemented",
                   "service_implemented_day_time": f"{date}T12:00:00.000Z"}
        last = not [s for s in services if not impl(s) and s.get("unique_id") != target.get("unique_id")]
        data = {"services_section": [updated]}
        if last:
            data["workflow"] = "services_implemented"
        d = self._ok(self._patch(case_id, data), "mark_service_delivered")
        after = d.get("services_section") or []
        return {"ok": True, "workflow": d.get("workflow"), "service": target.get("service_type"),
                "all_implemented": bool(after) and all(impl(s) for s in after)}

    def record_followup(self, case_id: str, *, needed_by: str | None = None, date: str | None = None,
                       followup_type: str | None = None, service_type: str | None = None,
                       comments: str | None = None) -> dict:
        """Append a deduplicated follow-up row."""
        entry = {}
        if followup_type: entry["followup_type"] = followup_type
        if service_type: entry["followup_service_type"] = service_type
        if needed_by: entry["followup_needed_by_date"] = needed_by
        if date: entry["followup_date"] = date
        if comments: entry["followup_comments"] = comments
        if not entry:
            raise RuntimeError("record_followup needs at least one field")
        current = self.get_case(case_id).get("followup_subform_section") or []
        keys = [k for k in entry if entry[k] not in (None, "")]
        if keys and any(all(self._norm(it.get(k)) == self._norm(entry[k]) for k in keys) for it in current):
            return {"ok": True, "skipped": True}
        d = self._ok(self._patch(case_id, {"followup_subform_section": [entry]}), "record_followup")
        return {"ok": True, "followup_count": len(d.get("followup_subform_section") or [])}

    def close_case(self, case_id: str, *, reason: str | None = None, notes: str | None = None) -> dict:
        """Try to close; on 403, fall back to requesting manager approval."""
        data = {"status": "closed"}
        if reason: data["closure_reason"] = reason
        r = self._patch(case_id, data, record_action="close")
        if r.status_code in (200, 201):
            d = r.json().get("data", {})
            return {"ok": True, "closed": True, "status": d.get("status", "closed"),
                    "date_closure": d.get("date_closure")}
        if r.status_code == 403:
            payload = {"approval_status": "requested"}
            if notes or reason:
                payload["notes"] = notes or reason
            ar = self.request("PATCH", f"/cases/{case_id}/approvals/closure", json={"data": payload})
            if ar.status_code not in (200, 201):
                raise RuntimeError(f"request_closure_approval failed (HTTP {ar.status_code}): {ar.text[:300]}")
            return {"ok": True, "closed": False, "approval_requested": True,
                    "message": "Closure requires manager approval; approval requested."}
        raise RuntimeError(f"close_case failed (HTTP {r.status_code}): {r.text[:300]}")


def anon_client() -> PrimeroClient:
    """A client logged in as the anonymous-reporter service account (from env)."""
    c = PrimeroClient()
    c.login(os.environ.get("PRIMERO_ANON_USERNAME", ""), os.environ.get("PRIMERO_ANON_PASSWORD", ""))
    return c


def _client_from_env(user_var: str, pass_var: str) -> PrimeroClient | None:
    """Log in with credentials from env vars (in the tenant: Orchestrator credential assets).
    Returns None if either var is unset, so callers can fall back to the anon account in dev."""
    u = os.environ.get(user_var, "").strip()
    p = os.environ.get(pass_var, "").strip()
    if not (u and p):
        return None
    c = PrimeroClient()
    c.login(u, p)
    return c


def worker_client() -> PrimeroClient:
    """A CP Worker session (PRIMERO_WORKER_USERNAME/PASSWORD), used for worker lifecycle
    actions. Falls back to the anon account when worker creds are unset (local dev)."""
    return _client_from_env("PRIMERO_WORKER_USERNAME", "PRIMERO_WORKER_PASSWORD") or anon_client()


def manager_client() -> PrimeroClient:
    """A CP Manager session (PRIMERO_MANAGER_USERNAME/PASSWORD), used to approve+close cases.
    Falls back to the anon account when manager creds are unset (local dev)."""
    return _client_from_env("PRIMERO_MANAGER_USERNAME", "PRIMERO_MANAGER_PASSWORD") or anon_client()


def client_from_session(cookie: str, csrf: str) -> PrimeroClient:
    """Build a client from an already-logged-in user's session (their `_app_session` cookie
    string + decoded CSRF token), skipping login. This is how the agent acts AS the logged-in
    WhatsApp user — their real Primero role is what governs the request. Sessions are minted by
    the worker login link (the .swimsbot session-store model), keyed per sender; the gateway
    passes the acting user's {cookie, csrf} into the agent invocation."""
    c = PrimeroClient()
    host = __import__("urllib.parse", fromlist=["urlparse"]).urlparse(c.base).hostname
    for part in (cookie or "").split(";"):
        name, _, value = part.strip().partition("=")
        if name and value:
            c.s.cookies.set(name, value, domain=host)
    if csrf:
        # Seed the tracked token directly (the gateway passes the decoded CSRF) so the first
        # write uses it without relying on jar order; later responses refresh it via _capture_csrf.
        c._csrf_token = csrf
        # Domain-scope it so a server-refreshed CSRF-TOKEN updates (not duplicates) this entry.
        c.s.cookies.set("CSRF-TOKEN", csrf, domain=host)
    return c
