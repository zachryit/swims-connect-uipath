"""SWIMS reporting and client-side task derivation.

Primero's /api/v2/tasks endpoint is permission-gated: the CP case-worker (self-scope) role CAN
read it (200), while admin/superuser and supervisor (group) roles get 403. So worker task reports
use the NATIVE /tasks engine (authoritative), and fall back to client-side derivation from date
fields (used for supervisor/manager scope, where /tasks is 403)
(docs/swims-workflow-and-reporting-implementation.md §1.2). Every report consumes derive_tasks().

generate_report(client, kind, *, concern, status, limit, now) -> formatted text. `client` is an
authenticated PrimeroClient acting as the worker, so Primero scopes visibility to their role.
"""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta

from concerns import CONCERN_LABELS, resolve_concern

# ── report catalogue ──────────────────────────────────────────────────────────
REPORT_TYPES: dict[str, str] = {
    "high-risk": "High-risk open cases",
    "overdue-followups": "Overdue follow-ups",
    "upcoming-followups": "Upcoming follow-ups",
    "stale-cases": "Cases not updated recently",
    "new-cases": "New cases",
    "caseload-summary": "Caseload summary",
    "tasks-due-today": "Tasks due today",
    "overdue-tasks": "Overdue tasks",
    "pending-referrals": "Pending referrals",
    "workflow-summary": "Workflow summary",
    "concern-summary": "Protection-concern summary",
    "supervisor-daily": "Supervisor daily report",
    "manager-weekly": "Manager weekly report",
}
# Reports that need full case records (subforms) to derive tasks.
DETAILED_TYPES = {"tasks-due-today", "overdue-tasks", "pending-referrals",
                  "overdue-followups", "upcoming-followups", "supervisor-daily", "manager-weekly"}

LABELS = {"assessment": "Assessment", "case_plan": "Case plan", "service": "Service",
          "followup": "Follow-up", "closure": "Closure review"}
STAGE_RANK = {"new": 0, "assessment": 1, "case_plan": 2, "service_provision": 3,
              "care_plan": 3, "action_plan": 3, "services_implemented": 4, "closed": 5}
_URGENCY = {"overdue": 0, "due_today": 1, "upcoming": 2}


# ── date helpers ────────────────────────────────────────────────────────────
def _parse(value):
    if not value:
        return None
    s = str(value)
    for fmt in (None,):  # try ISO first
        try:
            v = s.replace("Z", "+00:00")
            d = datetime.fromisoformat(v)
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except Exception:
            pass
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _day_key(d: datetime) -> int:
    return int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp())


def _date_only(value):
    d = _parse(value)
    return d.date().isoformat() if d else None


def _earliest(*candidates):
    dates = []
    for c in candidates:
        items = c if isinstance(c, list) else [c]
        for v in items:
            d = _parse(v)
            if d:
                dates.append(d)
    return min(dates) if dates else None


def _add_timeframe(date, timeframe):
    if not date or not timeframe:
        return None
    parts = str(timeframe).split("_")
    if len(parts) < 2:
        return None
    try:
        amount = float(parts[0])
    except ValueError:
        return None
    unit = parts[1]
    if unit.startswith("hour"):
        return date + timedelta(hours=amount)
    if unit.startswith("day"):
        return date + timedelta(days=amount)
    return None


def _service_due(service: dict):
    return _add_timeframe(_parse(service.get("service_response_day_time")),
                          service.get("service_response_timeframe")) \
        or _parse(service.get("service_appointment_date"))


def _status_for(due, now):
    if not due:
        return ("upcoming", 0)
    diff = round((_day_key(now) - _day_key(due)) / 86400)
    if diff > 0:
        return ("overdue", diff)
    if diff == 0:
        return ("due_today", 0)
    return ("upcoming", 0)


# ── task derivation ───────────────────────────────────────────────────────────
def derive_tasks(case_obj: dict, now: datetime, include_superseded: bool = False) -> list[dict]:
    d = (case_obj or {}).get("data") or case_obj or {}
    tasks: list[dict] = []
    wf_rank = STAGE_RANK.get(d.get("workflow"), 0)
    superseded = lambda rank: (not include_superseded) and wf_rank > rank

    base = {
        "case_id_display": d.get("case_id_display") or d.get("short_id"),
        "case_uuid": d.get("id") or (case_obj or {}).get("id"),
        "owned_by": d.get("owned_by"),
        "risk_level": d.get("risk_level"),
        "workflow": d.get("workflow"),
    }

    def push(ttype, due, **extra):
        status, days_overdue = _status_for(due, now)
        tasks.append({"type": ttype, "label": LABELS[ttype],
                      "due_date": due.date().isoformat() if due else None,
                      "status": status, "days_overdue": days_overdue, **base, **extra})

    if str(d.get("status") or "").lower() == "closed":
        return tasks

    if not d.get("assessment_requested_on") and not superseded(STAGE_RANK["assessment"]):
        due = _earliest(d.get("assessment_due_date"), d.get("assessment_due_dates"))
        if due:
            push("assessment", due, action="record the assessment outcome")

    if not d.get("date_case_plan") and not superseded(STAGE_RANK["case_plan"]):
        due = _earliest(d.get("case_plan_due_date"), d.get("case_plan_due_dates"),
                        d.get("case_plan_goal_due_date"), d.get("case_plan_target_review_date"))
        if due:
            push("case_plan", due, action="complete the case plan")

    for s in (d.get("services_section") or []):
        if str(s.get("service_implemented") or "").lower() == "implemented":
            continue
        due = _service_due(s)
        if not due:
            continue
        push("service", due, action=f"deliver/record service: {s.get('service_type') or 'referral'}",
             detail=s.get("service_type"),
             referred_on=_date_only(s.get("service_response_day_time") or s.get("service_appointment_date")),
             service_unique_id=s.get("unique_id"))

    for f in (d.get("followup_subform_section") or []):
        if _parse(f.get("followup_date") or f.get("date_completed")):
            continue
        due = _earliest(f.get("followup_needed_by_date"), f.get("followup_date_due"),
                        f.get("service_appointment_date"))
        if not due:
            continue
        push("followup", due, action="complete the follow-up and record the outcome",
             detail=f.get("followup_type") or f.get("followup_service_type"))

    if d.get("workflow") == "services_implemented" and d.get("closure_approved") is not True:
        push("closure", None, action="review for closure (supervisor approval)")

    return tasks


# ── case fetching ─────────────────────────────────────────────────────────────
def _normalise(raw: dict) -> dict:
    d = raw.get("data") or raw
    return {
        "id": raw.get("id") or d.get("id"),
        "case_id_display": d.get("case_id_display") or d.get("short_id") or raw.get("short_id"),
        "name": "(Hidden)" if d.get("hidden_name") else (d.get("name") or "(No name)"),
        "status": d.get("status") or "unknown",
        "risk_level": d.get("risk_level"),
        "workflow": d.get("workflow"),
        "owned_by": d.get("owned_by"),
        "location_current": d.get("location_current"),
        "registration_date": d.get("registration_date") or d.get("created_at"),
        "updated_at": d.get("last_updated_at") or d.get("updated_at") or raw.get("updated_at") or d.get("srch_updated_at"),
        "protection_concerns": d.get("protection_concerns") or [],
        "tasks": [],
    }


def _fetch_list(client, status=None, per=200) -> list[dict]:
    rows: list[dict] = []
    for page in range(1, 11):
        params = {"per": per, "page": page}
        if status:
            params["status"] = status
        r = client.request("GET", "/cases", params=params)
        r.raise_for_status()
        body = r.json()
        batch = body.get("data", [])
        rows.extend(batch)
        total = int((body.get("metadata") or {}).get("total") or len(rows))
        if len(rows) >= total or not batch:
            break
    return rows


def _signals_tasks(raw: dict) -> bool:
    d = raw.get("data") or raw
    if str(d.get("status") or "").lower() != "open":
        return False
    if d.get("workflow") == "closed":
        return False
    has = lambda k: isinstance(d.get(k), list) and len(d[k]) > 0
    return has("assessment_due_dates") or has("case_plan_due_dates") or has("service_due_dates") \
        or has("followup_due_dates") \
        or d.get("workflow") in ("assessment", "case_plan", "service_provision", "services_implemented")


def _fetch_detailed(client, now, cap=200, status=None) -> dict:
    raw_list = _fetch_list(client, status=status)
    candidates = [r for r in raw_list if _signals_tasks(r)]
    truncated = len(candidates) > cap
    candidates = candidates[:cap]

    cases: list[dict] = []

    def fetch_one(item):
        cid = item.get("id") or (item.get("data") or {}).get("id")
        rr = client.request("GET", f"/cases/{cid}")
        if rr.status_code != 200:
            return None
        norm = _normalise(rr.json())
        norm["tasks"] = derive_tasks(rr.json(), now)
        return norm

    if candidates:
        with ThreadPoolExecutor(max_workers=6) as ex:
            for norm in ex.map(fetch_one, candidates):
                if norm:
                    cases.append(norm)

    open_raw = [r for r in raw_list if str((r.get("data") or r).get("status") or "").lower() == "open"]
    stage_counts = _count_by(open_raw, lambda r: (r.get("data") or r).get("workflow") or "unknown")
    return {"cases": cases, "total_open": len(open_raw), "stage_counts": stage_counts, "truncated": truncated}


# ── filtering + formatting ─────────────────────────────────────────────────────
def _count_by(items, fn) -> dict:
    out: dict = {}
    for it in items:
        k = fn(it) or "unknown"
        out[k] = out.get(k, 0) + 1
    return out


def _days_between(a, b):
    return abs(round((_day_key(a) - _day_key(b)) / 86400))


def _filter_cases(kind, cases, now, days=7):
    open_cases = [c for c in cases if str(c["status"]).lower() == "open"]
    today = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    tasks_of = lambda c: c.get("tasks") or []
    if kind == "high-risk":
        return [c for c in open_cases if str(c.get("risk_level") or "").lower() in ("high", "critical")]
    if kind == "tasks-due-today":
        return [c for c in open_cases if any(t["status"] == "due_today" for t in tasks_of(c))]
    if kind == "overdue-tasks":
        return [c for c in open_cases if any(t["status"] == "overdue" for t in tasks_of(c))]
    if kind == "pending-referrals":
        return [c for c in open_cases if any(t["type"] == "service" for t in tasks_of(c))]
    if kind == "overdue-followups":
        return [c for c in open_cases if any(t["type"] == "followup" and t["status"] == "overdue" for t in tasks_of(c))]
    if kind == "upcoming-followups":
        def up(c):
            for t in tasks_of(c):
                if t["type"] != "followup" or t["status"] == "overdue" or not t["due_date"]:
                    continue
                due = _parse(t["due_date"])
                if today <= due <= today + timedelta(days=days):
                    return True
            return False
        return [c for c in open_cases if up(c)]
    if kind == "stale-cases":
        return [c for c in open_cases if (_parse(c.get("updated_at") or c.get("registration_date")) and
                                          _days_between(today, _parse(c.get("updated_at") or c.get("registration_date"))) >= days)]
    if kind == "new-cases":
        def isnew(c):
            reg = _parse(c.get("registration_date"))
            return reg is not None and 0 <= _days_between(today, reg) < days
        return [c for c in cases if isnew(c)]
    return cases


def _date_key_str(now):
    return now.date().isoformat()


def _case_line(c):
    bits = [c.get("case_id_display") or c.get("id"), c.get("name")]
    if c.get("risk_level"):
        bits.append(f"risk: {c['risk_level']}")
    if c.get("location_current"):
        bits.append(f"loc: {c['location_current']}")
    return "- " + " | ".join(str(b) for b in bits if b)


def _task_line(c, t):
    when = (f"overdue {t['days_overdue']}d" if t["status"] == "overdue"
            else "due today" if t["status"] == "due_today"
            else f"due {t['due_date']}" if t["due_date"] else "pending")
    extra = f", referred {t['referred_on']}" if t["type"] == "service" and t.get("referred_on") else ""
    detail = f" ({t['detail']})" if t.get("detail") else ""
    return f"- {c.get('case_id_display') or c.get('id')} | {c.get('name')} | {t['label']}{detail} {when}{extra}"


def _entries_line(obj, sep=" · "):
    return sep.join(f"{k} {v}" for k, v in obj.items()) or "none"


def _format_task_report(kind, cases, now, limit):
    relevant = {"tasks-due-today": lambda t: t["status"] == "due_today",
                "overdue-tasks": lambda t: t["status"] == "overdue",
                "pending-referrals": lambda t: t["type"] == "service"}[kind]
    rows = [(c, t) for c in cases for t in (c.get("tasks") or []) if relevant(t)]
    rows.sort(key=lambda ct: (_URGENCY[ct[1]["status"]], -ct[1]["days_overdue"]))
    header = f"{REPORT_TYPES[kind]} ({_date_key_str(now)})"
    if not rows:
        return f"{header}\nNothing outstanding. 🎉"
    lines = [header, f"{len(rows)} item{'' if len(rows) == 1 else 's'}."]
    lines += [_task_line(c, t) for c, t in rows[:limit]]
    if len(rows) > limit:
        lines.append(f"...and {len(rows) - limit} more.")
    return "\n".join(lines)


def _format_supervisor(cases, now, meta, limit=5):
    header = f"{REPORT_TYPES['supervisor-daily']} ({_date_key_str(now)})"
    tasks = [{**t, "name": c["name"], "owned_by": c["owned_by"]} for c in cases for t in (c.get("tasks") or [])]
    overdue = [t for t in tasks if t["status"] == "overdue"]
    due_today = [t for t in tasks if t["status"] == "due_today"]
    referrals = [t for t in tasks if t["type"] == "service"]
    by_type = _count_by(overdue, lambda t: t["label"])
    by_worker = dict(sorted(_count_by(overdue, lambda t: t["owned_by"] or "unassigned").items(),
                            key=lambda kv: -kv[1])[:8])
    oldest = max((t["days_overdue"] for t in referrals), default=0)
    lines = [header,
             f"Active cases {meta.get('total_open', '?')} · tasks due today {len(due_today)} · overdue {len(overdue)}",
             f"OVERDUE BY TYPE   {_entries_line(by_type)}",
             f"OVERDUE BY WORKER {_entries_line(by_worker)}",
             f"PENDING REFERRALS {len(referrals)}" + (f" (oldest {oldest}d)" if oldest else "")]
    top = sorted(overdue, key=lambda t: -t["days_overdue"])[:limit]
    if top:
        lines.append("TOP OVERDUE")
        lines += [f"- {t['case_id_display']} | {t['owned_by'] or '—'} | {t['label']} {t['days_overdue']}d" for t in top]
    if meta.get("truncated"):
        lines.append("(Note: scan capped — counts cover the first batch.)")
    return "\n".join(lines)


def _format_manager(cases, now, meta):
    header = f"{REPORT_TYPES['manager-weekly']} ({_date_key_str(now)})"
    sc = meta.get("stage_counts") or {}
    stage = lambda k: int(sc.get(k, 0))
    reached = stage("service_provision") + stage("services_implemented")
    delivered = round(stage("services_implemented") / reached * 100) if reached else None
    tasks = [t for c in cases for t in (c.get("tasks") or [])]
    overdue = [t for t in tasks if t["status"] == "overdue"]
    referrals = [t for t in tasks if t["type"] == "service"]
    funnel = " · ".join(f"{k} {stage(k)}" for k in
                        ["new", "assessment", "case_plan", "service_provision", "services_implemented"])
    lines = [header, f"Active cases: {meta.get('total_open', '?')}", f"BY STAGE   {funnel}",
             f"SERVICE DELIVERY   {'n/a' if delivered is None else str(delivered) + '%'} of cases that reached "
             f"the service stage have all services delivered ({stage('services_implemented')}/{reached})",
             f"OVERDUE TASKS   {len(overdue)} ({_entries_line(_count_by(overdue, lambda t: t['label']))})",
             f"PENDING REFERRALS   {len(referrals)} services awaiting delivery"]
    if meta.get("truncated"):
        lines.append("(Note: scan capped — task counts cover the first batch; stage counts are complete.)")
    return "\n".join(lines)


def _format(kind, all_cases, now, meta, concern=None, limit=10):
    label = REPORT_TYPES.get(kind, kind)
    header = f"{label} ({_date_key_str(now)})"
    cases = all_cases
    if concern:
        cases = [c for c in all_cases if concern in (c.get("protection_concerns") or [])]
        header += f" — {CONCERN_LABELS.get(concern, concern)}"

    if kind == "concern-summary":
        open_cases = [c for c in cases if str(c["status"]).lower() == "open"]
        counts: dict = {}
        for c in open_cases:
            for pc in (c.get("protection_concerns") or []):
                counts[pc] = counts.get(pc, 0) + 1
        rows = sorted(counts.items(), key=lambda kv: -kv[1])[:max(limit, 15)]
        lines = [header, f"Open cases by protection concern ({len(open_cases)} open):"]
        lines += ([f"- {CONCERN_LABELS.get(k, k)}: {v}" for k, v in rows]
                  if rows else ["No protection concerns recorded."])
        return "\n".join(lines)
    if kind == "supervisor-daily":
        return _format_supervisor(cases, now, meta)
    if kind == "manager-weekly":
        return _format_manager(cases, now, meta)
    if kind == "caseload-summary":
        by_status = _count_by(cases, lambda c: c["status"])
        by_risk = _count_by(cases, lambda c: c.get("risk_level") or "none")
        return "\n".join([header, f"Total visible cases: {len(cases)}",
                          f"By status: {', '.join(f'{k} {v}' for k, v in by_status.items()) or 'none'}",
                          f"By risk: {', '.join(f'{k} {v}' for k, v in by_risk.items()) or 'none'}"])
    if kind == "workflow-summary":
        order = ["new", "assessment", "case_plan", "service_provision", "services_implemented", "unknown"]
        by_stage = _count_by([c for c in cases if str(c["status"]).lower() == "open"],
                             lambda c: c.get("workflow") or "unknown")
        entries = sorted(by_stage.items(), key=lambda kv: order.index(kv[0]) if kv[0] in order else 99)
        return "\n".join([header, "Open cases by stage:"] + [f"- {k}: {v}" for k, v in entries])
    if kind in ("tasks-due-today", "overdue-tasks", "pending-referrals"):
        return _format_task_report(kind, _filter_cases(kind, cases, now), now, limit)

    filtered = _filter_cases(kind, cases, now)
    lines = [header, f"{len(filtered)} case{'' if len(filtered) == 1 else 's'} found."]
    if filtered:
        lines += [_case_line(c) for c in filtered[:limit]]
        if len(filtered) > limit:
            lines.append(f"...and {len(filtered) - limit} more.")
    return "\n".join(lines)


# ── native Primero /tasks (worker scope) ─────────────────────────────────────
# Report types that are a flat task list — these can be served from the native /tasks engine
# (authoritative) when the account is permitted; else client-side derivation.
_TASK_LIST_TYPES = {"tasks-due-today", "overdue-tasks", "pending-referrals",
                    "overdue-followups", "upcoming-followups"}
_NATIVE_TYPE = {"follow_up": "followup"}  # native uses follow_up; we use followup


def _fetch_native_tasks(client) -> list[dict] | None:
    """Read Primero's own task list. Returns the raw task objects, or None if the account lacks
    the /tasks permission (403 for admin/superuser/supervisor here)."""
    rows: list[dict] = []
    for page in range(1, 11):
        r = client.request("GET", "/tasks", params={"per": 100, "page": page})
        if r.status_code == 403:
            return None
        if r.status_code != 200:
            return None
        body = r.json()
        batch = body.get("data", [])
        rows.extend(batch)
        total = int((body.get("metadata") or {}).get("total") or len(rows))
        if len(rows) >= total or not batch:
            break
    return rows


def _native_cases(client, now) -> list[dict] | None:
    """Group native /tasks into pseudo-cases (case_id_display, name, tasks[]) so the existing
    task-report formatter can render them. Returns None if /tasks is not permitted."""
    raw = _fetch_native_tasks(client)
    if raw is None:
        return None
    by_case: dict = {}
    for t in raw:
        ttype = _NATIVE_TYPE.get(t.get("type"), t.get("type"))
        due = None
        raw_due = t.get("due_date")
        if raw_due:
            try:
                due = datetime.strptime(raw_due, "%d-%b-%Y").replace(tzinfo=timezone.utc)
            except Exception:
                due = _parse(raw_due)
        if t.get("overdue"):
            status = "overdue"
            days = round((_day_key(now) - _day_key(due)) / 86400) if due else 1
        elif due and _day_key(due) == _day_key(now):
            status, days = "due_today", 0
        else:
            status, days = "upcoming", 0
        task = {"type": ttype, "label": LABELS.get(ttype, t.get("type_display") or ttype),
                "due_date": due.date().isoformat() if due else None, "status": status,
                "days_overdue": days, "detail": t.get("detail"), "priority": t.get("priority"),
                "case_id_display": t.get("record_id_display"), "case_uuid": t.get("id"),
                "referred_on": None}
        cid = task["case_uuid"] or task["case_id_display"]
        c = by_case.setdefault(cid, {"id": task["case_uuid"], "case_id_display": task["case_id_display"],
                                     "name": t.get("name") or "(No name)", "status": "open",
                                     "risk_level": (t.get("priority") if t.get("priority") in ("high", "critical") else None),
                                     "protection_concerns": [], "tasks": []})
        c["tasks"].append(task)
    return list(by_case.values())


# ── public entrypoint ───────────────────────────────────────────────────────
def available_reports() -> list[dict]:
    return [{"kind": k, "label": v} for k, v in REPORT_TYPES.items()]


def generate_report(client, kind: str, *, concern: str | None = None, status: str | None = None,
                    limit: int = 10, now: datetime | None = None) -> str:
    """Run a report as the authenticated worker. Returns formatted WhatsApp-ready text."""
    now = now or datetime.now(timezone.utc)
    if kind not in REPORT_TYPES:
        return (f"I don't have a '{kind}' report. Available: "
                + ", ".join(REPORT_TYPES.keys()) + ".")
    concern_code = resolve_concern(concern) if concern else None
    # Worker flat-task reports: prefer Primero's NATIVE /tasks engine (authoritative). The native
    # task list carries no protection_concerns, so a concern-scoped request falls back to
    # client-side derivation (which fetches full records). /tasks 403 (admin/supervisor) -> fallback.
    if kind in _TASK_LIST_TYPES and not concern_code:
        native = _native_cases(client, now)
        if native is not None:
            return _format(kind, native, now, {}, concern=None, limit=limit)
    cap = 2000 if kind in ("supervisor-daily", "manager-weekly") else 200
    if kind in DETAILED_TYPES:
        res = _fetch_detailed(client, now, cap=cap, status=status)
        cases, meta = res["cases"], res
    else:
        rows = _fetch_list(client, status=status)
        cases, meta = [_normalise(r) for r in rows], {}
    return _format(kind, cases, now, meta, concern=concern_code, limit=limit)
