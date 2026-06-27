import fs from "node:fs";
import path from "node:path";
import { MaestroClient } from "./maestro-client.js";

// Overdue-work monitor — the delivery half of the Maestro Case (SWIMSChildProtectionCase).
//
// Division of labour (see sdd.md): the Maestro CASE is the per-case SLA-clock engine (one instance
// per real SWIMS case, five recipient-free SLA clocks). This monitor is the precise JUDGE + MESSENGER:
//   - on case creation it starts ONE Maestro instance (process run) and remembers it;
//   - a periodic tick polls each instance's lifecycle (prunes terminal ones), and — gated by a live
//     Primero check DRIVEN THROUGH THE AGENT (reusing the worker's session + Primero tools) — sends the
//     case OWNER a WhatsApp heads-up when a step is genuinely overdue.
//
// This honours every constraint: no re-gating (Primero is authoritative; the agent confirms before we
// message), no hardcoded people (recipient is the owner who filed the case), no opt-in (started FOR them).
//
// Pre-deploy / unconfigured (no process+folder key) it is a graceful no-op: startForCase() does nothing,
// so the gateway runs unchanged until the case is deployed and the keys are set.

const NONE = /^\s*none\b/i; // agent replies exactly "NONE" when nothing is overdue

function checkPrompt(swimsCaseId) {
  return (
    `[Automated overdue check — not a user message] For SWIMS case ${swimsCaseId}, check Primero now: ` +
    `are any workflow steps overdue (assessment, case plan, service referral, follow-up, or closure ` +
    `review past their due date and not yet completed)? If yes, reply with a brief WhatsApp heads-up ` +
    `addressed to the case owner that names the case ID and ONLY the overdue step(s). If nothing is ` +
    `overdue, or the case is closed, reply with exactly: NONE`
  );
}

export class CaseMonitor {
  // deps: { logger, workerActive(sender)->bool, generate(sender,text)->reply, send(sender,text), maestro: MaestroClient }
  constructor(config, deps) {
    this.config = config;
    this.deps = deps;
    this.logger = deps.logger;
    this.maestro = deps.maestro;
    this.file = path.join(config.stateDir, "case-monitors.json");
    this.timer = null;
    this.enabled = Boolean(config.maestroMonitorEnabled);
    this.pollMs = config.maestroPollMs || 30 * 60 * 1000;
    this.checkIntervalMs = config.maestroCheckIntervalMs || 12 * 60 * 60 * 1000;
    this.nudgeCooldownMs = config.maestroNudgeCooldownMs || 24 * 60 * 60 * 1000;
  }

  #read() {
    try { return JSON.parse(fs.readFileSync(this.file, "utf8")).monitors || []; }
    catch { return []; }
  }
  #write(monitors) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.file, JSON.stringify({ monitors }, null, 2), { mode: 0o600 });
  }

  // Called when the agent reports a real SWIMS case was created by a signed-in worker.
  // caseOwner is the WhatsApp sender to notify (and the case's owner in Primero).
  async startForCase(swimsCaseId, caseOwner) {
    if (!this.enabled) return { ok: false, skipped: "monitor disabled" };
    if (!swimsCaseId || !caseOwner) return { ok: false, skipped: "missing case id or owner" };
    const monitors = this.#read();
    if (monitors.some((m) => m.swimsCaseId === swimsCaseId)) {
      return { ok: true, already: true };
    }
    const started = await this.maestro.startInstance(this.config.maestroReleaseKey, this.config.maestroFolderKey, {
      swimsCaseId,
      caseOwner,
    });
    if (!started) {
      // No deployed process yet (or runtime refused) — don't record a phantom monitor.
      this.logger.warn({ swimsCaseId, caseOwner }, "Could not start Maestro case instance (process not deployed/configured?)");
      return { ok: false, error: "instance start failed" };
    }
    monitors.push({
      instanceId: started.instanceId,
      swimsCaseId,
      caseOwner,
      startedAt: new Date().toISOString(),
      status: "running",
      lastCheckAt: null,
      lastNudgeText: null,
      lastNudgeAt: null,
      nudgeCount: 0,
    });
    this.#write(monitors);
    this.logger.info({ swimsCaseId, caseOwner, instanceId: started.instanceId }, "Started Maestro case monitor instance");
    return { ok: true, instanceId: started.instanceId };
  }

  // Cancel + forget a case's monitor (e.g. the case was closed in Primero).
  async cancelForCase(swimsCaseId) {
    const monitors = this.#read();
    const m = monitors.find((x) => x.swimsCaseId === swimsCaseId);
    if (!m) return { ok: false, error: "no monitor for case" };
    if (m.instanceId) await this.maestro.cancelInstance(m.instanceId, this.config.maestroFolderKey);
    this.#write(monitors.filter((x) => x.swimsCaseId !== swimsCaseId));
    this.logger.info({ swimsCaseId, instanceId: m.instanceId }, "Cancelled + removed Maestro case monitor");
    return { ok: true };
  }

  start() {
    if (!this.enabled || this.timer) return;
    this.timer = setInterval(() => this.tick().catch((e) => this.logger.error({ err: e?.message }, "Case-monitor tick failed")), this.pollMs);
    this.tick().catch(() => {});
    this.logger.info({ pollMs: this.pollMs }, "Case monitor started");
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async tick(now = new Date()) {
    const monitors = this.#read();
    if (!monitors.length) return;
    const survivors = [];
    for (const m of monitors) {
      try {
        // 1. Prune instances that have reached a terminal lifecycle state (via the Orchestrator job).
        if (m.instanceId) {
          const job = await this.maestro.jobState(m.instanceId);
          const life = MaestroClient.lifecycle(job);
          if (life === "completed" || life === "canceled" || life === "faulted") {
            this.logger.info({ swimsCaseId: m.swimsCaseId, instanceId: m.instanceId, life }, "Maestro instance terminal — dropping monitor");
            continue; // not pushed to survivors
          }
          if (life !== "unknown") m.status = life;
        }

        // 2. Only the owner's live session can read Primero — skip if they're not signed in.
        if (!(await this.deps.workerActive(m.caseOwner))) { survivors.push(m); continue; }

        // 3. Rate-limit the (relatively expensive) Primero check per case.
        if (m.lastCheckAt && now - new Date(m.lastCheckAt) < this.checkIntervalMs) { survivors.push(m); continue; }
        m.lastCheckAt = now.toISOString();

        // 4. Drive the agent to confirm against live Primero, then nudge the owner if overdue.
        const reply = await this.deps.generate(m.caseOwner, checkPrompt(m.swimsCaseId));
        if (reply && !NONE.test(reply)) {
          const dupRecent = reply === m.lastNudgeText && m.lastNudgeAt && now - new Date(m.lastNudgeAt) < this.nudgeCooldownMs;
          const cooling = m.lastNudgeAt && now - new Date(m.lastNudgeAt) < this.nudgeCooldownMs;
          if (!dupRecent && !cooling) {
            await this.deps.send(m.caseOwner, reply);
            m.lastNudgeText = reply;
            m.lastNudgeAt = now.toISOString();
            m.nudgeCount = (m.nudgeCount || 0) + 1;
            this.logger.info({ swimsCaseId: m.swimsCaseId, owner: m.caseOwner }, "Overdue nudge sent to case owner");
          }
        }
      } catch (error) {
        this.logger.error({ err: error?.message, swimsCaseId: m.swimsCaseId }, "Case-monitor check failed");
      }
      survivors.push(m);
    }
    this.#write(survivors);
  }
}
