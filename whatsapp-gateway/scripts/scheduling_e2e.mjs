// E2E: scheduled reports — create/list/cancel THROUGH the agent, plus a direct proof that the
// runner generates + delivers a due report (driving the agent, capturing the WhatsApp send).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UiPath } from "@uipath/uipath-typescript/core";
import { ConversationalAgent, MessageRole } from "@uipath/uipath-typescript/conversational-agent";
import { loadConfig } from "../src/config.js";
import { SessionManager } from "../src/primero-client.js";
import { SessionStore } from "../src/session-store.js";
import { mintBridgeToken } from "../src/bridge.js";
import { ReportScheduler } from "../src/scheduler.js";
import { UiPathConversationClient } from "../src/uipath-client.js";
import { SenderStateStore } from "../src/state-store.js";

const cfg = loadConfig();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const SENDER = "+15530652135456";

const sdk = new UiPath({ baseUrl: cfg.uipathBaseUrl, orgName: cfg.uipathOrg, tenantName: cfg.uipathTenant, secret: cfg.uipathToken });
await sdk.initialize();
const ca = new ConversationalAgent(sdk, { surfaceName: cfg.uipathSurfaceName, surfaceVersion: cfg.uipathSurfaceVersion, externalUserId: "swims-sched-e2e" });
const agent = await ca.getById(cfg.uipathAgentId || 2247291, cfg.uipathFolderId || 3141212);
log("agent version:", agent.processVersion || agent.version);

const sm = new SessionManager(cfg, new SessionStore(cfg.stateDir, cfg.credentialKey));
await sm.login(SENDER, process.env.PRIMERO_WORKER_USERNAME, process.env.PRIMERO_WORKER_PASSWORD);
log("worker logged in");

const conv = await agent.conversations.create({ label: "sched-e2e", agentInput: { inline: { swims_sender: SENDER, swims_channel: "whatsapp" } } });
const session = conv.startSession();
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("start timeout")), 30000); session.onSessionStarted(() => { clearTimeout(t); res(); }); session.onErrorStart(e => { clearTimeout(t); rej(new Error(e?.message || "sess")); }); });

function turn(text, ms = 150000) {
  return new Promise((resolve, reject) => {
    const parts = []; let tool = ""; const t = setTimeout(() => reject(new Error("turn timeout")), ms);
    const attach = (ex) => {
      ex.onMessageStart(m => { m.onContentPartCompleted(p => { if (m.isAssistant) { const d = typeof p.data === "string" ? p.data : (p.data?.inline || p.data?.value || ""); if (d) parts.push(d); } }); m.onToolCallCompleted(tc => { if (m.isAssistant) tool = tc?.name || ""; }); });
      ex.onErrorStart(e => { clearTimeout(t); reject(new Error(e?.message || "ex")); }); ex.onExchangeEnd(() => { clearTimeout(t); resolve({ reply: parts.join("").trim(), tool }); });
    };
    const ex = session.startExchange(); attach(ex);
    ex.sendMessageWithContentPart({ data: text, role: MessageRole.User, mimeType: "text/plain" }).catch(reject);
  });
}
const ask = async (text) => { const tok = mintBridgeToken(SENDER, cfg.bridgeSecret, cfg.bridgeTokenTtlMs); log("Q:", text); const r = await turn(`[SWIMS_CTX ${tok}]\n${text}`); log("A:", JSON.stringify(r.reply).slice(0, 400), "| tool:", r.tool); return r; };

const schedFile = path.join(cfg.stateDir, "schedules.json");
const readSched = () => { try { return JSON.parse(fs.readFileSync(schedFile, "utf8")).schedules.filter(s => s.sender === SENDER); } catch { return []; } };

await ask("Send me a daily report of referrals that haven't been delivered yet, every morning at 8am");
log("schedules.json now:", JSON.stringify(readSched().map(s => ({ type: s.type, freq: s.frequency, time: s.time, next: s.next_run_at }))));
await ask("Send me child-labour cases every Monday at 9am");
await ask("What reports am I getting?");

// ---- runner proof: a due schedule generates + delivers a report (separate temp store) ----
log("\n--- runner proof (forcing a due schedule) ---");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sched-"));
const client = new UiPathConversationClient(cfg, { info(){}, warn(){}, error(){}, debug(){} }, new SenderStateStore(tmp), sm);
let delivered = null;
const runner = new ReportScheduler({ ...cfg, stateDir: tmp }, {
  logger: { info(){}, warn(){}, error(){} },
  workerActive: async (s) => Boolean(await sm.worker(s)),
  generate: async (s, text) => (await client.turn({ sender: s, text, messageId: "t", channel: "whatsapp", messageType: "text" }))?.reply,
  send: async (s, text) => { delivered = text; },
});
runner.create(SENDER, { type: "pending-referrals", frequency: "daily", time: "08:00" });
// force it due
const store = JSON.parse(fs.readFileSync(path.join(tmp, "schedules.json"), "utf8"));
store.schedules[0].next_run_at = new Date(Date.now() - 60000).toISOString();
fs.writeFileSync(path.join(tmp, "schedules.json"), JSON.stringify(store));
await runner.tick();
log("RUNNER delivered report:\n" + (delivered || "(nothing)"));

await ask("Stop the daily referral report");
log("schedules.json after cancel:", JSON.stringify(readSched().map(s => s.type)));
try { conv.endSession(); } catch {}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(0);
