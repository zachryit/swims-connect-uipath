import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Scheduled WhatsApp reports — port of .swimsbot's scheduled-reports runner. Each schedule is
// per-sender; a per-minute tick finds due ones, DRIVES THE AGENT to generate the report (reusing
// the agent's run_report tool, so no report logic is duplicated here), and sends it to WhatsApp.
// SWIMS Ghana time is UTC±0, so UTC date/time == Accra local.

const FREQUENCIES = new Set(["daily", "weekly", "every-n-days"]);
const DOW = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

function parseTime(t) {
  const [h, m] = String(t || "08:00").split(":").map((n) => Number(n));
  return { h: Number.isFinite(h) ? h : 8, m: Number.isFinite(m) ? m : 0 };
}

function nextRunFrom(schedule, after = new Date()) {
  const { h, m } = parseTime(schedule.time);
  const next = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate(), h, m, 0, 0));
  const dow = schedule.day_of_week != null ? DOW[String(schedule.day_of_week).toLowerCase()] : null;
  const step = () => {
    if (schedule.frequency === "weekly") next.setUTCDate(next.getUTCDate() + 7);
    else if (schedule.frequency === "every-n-days") next.setUTCDate(next.getUTCDate() + Number(schedule.every_days || 1));
    else next.setUTCDate(next.getUTCDate() + 1);
  };
  if (schedule.frequency === "weekly" && dow != null) {
    while (next <= after || next.getUTCDay() !== dow) next.setUTCDate(next.getUTCDate() + 1);
  } else {
    while (next <= after) step();
  }
  return next.toISOString();
}

const PROMPTS = {
  "pending-referrals": "Run my pending-referrals report",
  "overdue-tasks": "Run my overdue-tasks report",
  "tasks-due-today": "Run my tasks-due-today report",
  "high-risk": "Run my high-risk report",
  "overdue-followups": "Run my overdue-followups report",
  "upcoming-followups": "Run my upcoming-followups report",
  "workflow-summary": "Run my workflow-summary report",
  "concern-summary": "Run my concern-summary report",
  "caseload-summary": "Run my caseload-summary report",
  "new-cases": "Run my new-cases report",
  "stale-cases": "Run my stale-cases report",
  "supervisor-daily": "Run my supervisor-daily report",
  "manager-weekly": "Run my manager-weekly report",
};

export class ReportScheduler {
  // deps: { generate(sender, text)->reply, send(sender, text), workerActive(sender)->bool, logger }
  constructor(config, deps) {
    this.config = config;
    this.deps = deps;
    this.logger = deps.logger;
    this.file = path.join(config.stateDir, "schedules.json");
    this.timer = null;
  }

  #read() {
    try { return JSON.parse(fs.readFileSync(this.file, "utf8")).schedules || []; }
    catch { return []; }
  }
  #write(schedules) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.file, JSON.stringify({ schedules }, null, 2), { mode: 0o600 });
  }

  create(sender, spec = {}) {
    const type = String(spec.type || "").trim();
    if (!PROMPTS[type]) return { ok: false, error: `Unknown report type '${type}'.` };
    const frequency = FREQUENCIES.has(spec.frequency) ? spec.frequency : "daily";
    const schedule = {
      id: `sr_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`,
      sender, channel: "whatsapp", type, frequency,
      every_days: frequency === "every-n-days" ? Number(spec.every_days || 1) : null,
      day_of_week: frequency === "weekly" ? (spec.day_of_week || null) : null,
      time: parseTime(spec.time).h.toString().padStart(2, "0") + ":" + parseTime(spec.time).m.toString().padStart(2, "0"),
      timezone: "Africa/Accra",
      concern: spec.concern || null,
      status: spec.status || null,
      limit: Number(spec.limit || 10),
      created_at: new Date().toISOString(),
      last_run_at: null, last_result: null, run_count: 0,
    };
    schedule.next_run_at = nextRunFrom(schedule, new Date());
    const schedules = this.#read();
    // Dedupe: identical schedule (model may double-call the tool) -> return the existing one.
    const dup = schedules.find((s) => s.sender === sender && s.type === type && s.frequency === frequency
      && s.time === schedule.time && (s.concern || null) === (schedule.concern || null)
      && (s.day_of_week || null) === (schedule.day_of_week || null));
    if (dup) return { ok: true, schedule: this.describe(dup), already: true };
    schedules.push(schedule);
    this.#write(schedules);
    this.logger.info({ sender, id: schedule.id, type, frequency, time: schedule.time }, "Scheduled report created");
    return { ok: true, schedule: this.describe(schedule) };
  }

  list(sender) {
    return { ok: true, schedules: this.#read().filter((s) => s.sender === sender).map((s) => this.describe(s)) };
  }

  remove(sender, which) {
    const schedules = this.#read();
    const w = String(which || "").trim().toLowerCase();
    const mine = schedules.filter((s) => s.sender === sender);
    let targets = [];
    if (w) {
      targets = mine.filter((s) => s.id.toLowerCase() === w || s.type.toLowerCase() === w
        || s.type.toLowerCase().includes(w) || w.includes(s.type.toLowerCase()));
    }
    if (!targets.length && mine.length === 1) targets = mine;  // "stop the report" with exactly one
    if (!targets.length) {
      return { ok: false, error: "No matching schedule. Ask 'what reports am I getting?' to see them." };
    }
    const ids = new Set(targets.map((s) => s.id));
    this.#write(schedules.filter((s) => !ids.has(s.id)));
    this.logger.info({ sender, removed: targets.map((s) => s.id) }, "Scheduled report(s) removed");
    return { ok: true, removed: targets.map((s) => this.describe(s)) };
  }

  describe(s) {
    const cadence = s.frequency === "daily" ? "every day"
      : s.frequency === "weekly" ? (s.day_of_week ? `every ${s.day_of_week}` : "weekly")
      : `every ${s.every_days} days`;
    return { id: s.id, type: s.type, cadence, time: `${s.time} (${s.timezone})`,
      concern: s.concern || undefined, next_run_at: s.next_run_at };
  }

  start() {
    if (this.timer) return;
    // Tick shortly after start, then every minute. Date.now() is fine at runtime (not a workflow).
    this.timer = setInterval(() => this.tick().catch((e) => this.logger.error({ err: e?.message }, "Scheduler tick failed")), 60_000);
    this.tick().catch(() => {});
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async tick(now = new Date()) {
    const schedules = this.#read();
    const due = schedules.filter((s) => s.next_run_at && new Date(s.next_run_at) <= now);
    if (!due.length) return;
    for (const s of due) {
      try {
        if (!(await this.deps.workerActive(s.sender))) {
          this.logger.warn({ sender: s.sender, id: s.id }, "Scheduled report skipped — worker not signed in");
          s.last_result = "skipped: not signed in";
        } else {
          const requestText = PROMPTS[s.type] + (s.concern ? ` for ${s.concern}` : "");
          const reply = await this.deps.generate(s.sender, requestText);
          if (reply) await this.deps.send(s.sender, reply);
          s.last_result = "ok"; s.run_count = (s.run_count || 0) + 1;
          this.logger.info({ sender: s.sender, id: s.id, type: s.type }, "Scheduled report delivered");
        }
      } catch (error) {
        s.last_result = `error: ${String(error?.message || error).slice(0, 120)}`;
        this.logger.error({ err: error?.message, id: s.id }, "Scheduled report failed");
      }
      s.last_run_at = now.toISOString();
      s.next_run_at = nextRunFrom(s, now);
    }
    this.#write(schedules);
  }
}
