// End-to-end test of the DEPLOYED conversational agent (0.1.9) through the same UiPath
// TypeScript SDK the gateway uses. Drives a 2-turn anonymous report:
//   turn 1: describe a concern  -> expect the follow-up-consent question (no case yet)
//   turn 2: "yes"               -> expect create_case -> a REAL SWIMS Case ID
// Proves the cloud CSRF fix files a case (no 403 InvalidAuthenticityToken).
import { UiPath } from "@uipath/uipath-typescript/core";
import { ConversationalAgent, MessageRole } from "@uipath/uipath-typescript/conversational-agent";
import { loadConfig } from "../src/config.js";

const cfg = loadConfig();
const AGENT_ID = cfg.uipathAgentId || 2247291;
const FOLDER_ID = cfg.uipathFolderId || 3141212;

function log(...a) { console.log(new Date().toISOString().slice(11, 19), ...a); }

const sdk = new UiPath({ baseUrl: cfg.uipathBaseUrl, orgName: cfg.uipathOrg, tenantName: cfg.uipathTenant, secret: cfg.uipathToken });
await sdk.initialize();
const ca = new ConversationalAgent(sdk, { surfaceName: cfg.uipathSurfaceName, surfaceVersion: cfg.uipathSurfaceVersion, externalUserId: "swims-connect-e2e" });
const agent = await ca.getById(AGENT_ID, FOLDER_ID);
log("resolved agent:", agent.name || agent.title, "version:", agent.processVersion || agent.version, "key:", agent.key || agent.releaseKey);

const conversation = await agent.conversations.create({
  label: "SWIMS E2E test",
  agentInput: { inline: { swims_sender: "+10000000999", swims_channel: "whatsapp" } }
});
log("conversation:", conversation.id);
const session = conversation.startSession();
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("session did not start")), 30000);
  session.onSessionStarted(() => { clearTimeout(t); resolve(); });
  session.onErrorStart((e) => { clearTimeout(t); reject(new Error("session error: " + (e?.message || JSON.stringify(e)))); });
});
log("session started");

function runTurn(text, timeoutMs = 150000) {
  return new Promise((resolve, reject) => {
    const parts = [];
    const cases = [];
    let settled = false;
    const done = (v, err) => { if (settled) return; settled = true; clearTimeout(timer); err ? reject(err) : resolve(v); };
    const timer = setTimeout(() => done(null, new Error("turn timed out")), timeoutMs);
    const grabCase = (tc) => {
      let o = tc?.output;
      if (typeof o === "string") { try { o = JSON.parse(o); } catch {} }
      if (o && typeof o === "object") {
        const id = o.case_id_display || o.caseIdDisplay || o.swims_case_id || o.swimsCaseId;
        const err = o.error || o.detail;
        if (id || err) cases.push({ id, err, raw: o });
      }
    };
    const attach = (ex) => {
      ex.onMessageStart((m) => {
        m.onContentPartCompleted((p) => { if (m.isAssistant) { const d = typeof p.data === "string" ? p.data : (p.data?.inline || p.data?.value || ""); if (d) parts.push(d); } });
        m.onToolCallCompleted((tc) => { if (m.isAssistant) grabCase(tc); });
        m.onCompleted((c) => { for (const tc of c.toolCalls || []) grabCase(tc); });
      });
      ex.onErrorStart((e) => done(null, new Error("exchange error: " + (e?.message || JSON.stringify(e)))));
      ex.onExchangeEnd(() => done({ reply: parts.join("").trim(), cases }));
    };
    const ex = session.startExchange();
    attach(ex);
    ex.sendMessageWithContentPart({ data: text, role: MessageRole.User, mimeType: "text/plain" }).catch((e) => done(null, e));
  });
}

try {
  log("TURN 1 ->", "A girl about 10 is hawking alone at Circle, Accra late at night and hasn't been home in two days.");
  const r1 = await runTurn("A girl about 10 is hawking alone at Circle, Accra late at night and hasn't been home in two days.");
  log("TURN 1 reply:", JSON.stringify(r1.reply));
  log("TURN 1 cases:", JSON.stringify(r1.cases));

  log("TURN 2 -> yes");
  const r2 = await runTurn("yes");
  log("TURN 2 reply:", JSON.stringify(r2.reply));
  log("TURN 2 cases:", JSON.stringify(r2.cases));

  const made = [...r1.cases, ...r2.cases].find((c) => c.id);
  const errored = [...r1.cases, ...r2.cases].find((c) => c.err);
  if (made) { log("✅ CASE CREATED:", made.id); }
  else if (errored) { log("❌ TOOL ERROR:", JSON.stringify(errored)); }
  else { log("⚠️  no case id surfaced; inspect replies above"); }
} finally {
  try { conversation.endSession(); } catch {}
}
process.exit(0);
