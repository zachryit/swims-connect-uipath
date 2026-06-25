// E2E: worker report suite, driven THROUGH the deployed agent (bridge token per turn).
import { UiPath } from "@uipath/uipath-typescript/core";
import { ConversationalAgent, MessageRole } from "@uipath/uipath-typescript/conversational-agent";
import { loadConfig } from "../src/config.js";
import { SessionManager } from "../src/primero-client.js";
import { SessionStore } from "../src/session-store.js";
import { mintBridgeToken } from "../src/bridge.js";

const cfg = loadConfig();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const SENDER = "+15530652135456";

const sdk = new UiPath({ baseUrl: cfg.uipathBaseUrl, orgName: cfg.uipathOrg, tenantName: cfg.uipathTenant, secret: cfg.uipathToken });
await sdk.initialize();
const ca = new ConversationalAgent(sdk, { surfaceName: cfg.uipathSurfaceName, surfaceVersion: cfg.uipathSurfaceVersion, externalUserId: "swims-reports-e2e" });
const agent = await ca.getById(cfg.uipathAgentId || 2247291, cfg.uipathFolderId || 3141212);
log("agent version:", agent.processVersion || agent.version);

const sm = new SessionManager(cfg, new SessionStore(cfg.stateDir, cfg.credentialKey));
await sm.login(SENDER, process.env.PRIMERO_WORKER_USERNAME, process.env.PRIMERO_WORKER_PASSWORD);
log("worker logged in");

const conv = await agent.conversations.create({ label: "reports-e2e", agentInput: { inline: { swims_sender: SENDER, swims_channel: "whatsapp" } } });
const session = conv.startSession();
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("start timeout")), 30000); session.onSessionStarted(() => { clearTimeout(t); res(); }); session.onErrorStart(e => { clearTimeout(t); rej(new Error(e?.message || "sess")); }); });

function turn(text, ms = 150000) {
  return new Promise((resolve, reject) => {
    const parts = []; let tool = ""; const t = setTimeout(() => reject(new Error("turn timeout")), ms);
    const attach = (ex) => {
      ex.onMessageStart(m => { m.onContentPartCompleted(p => { if (m.isAssistant) { const d = typeof p.data === "string" ? p.data : (p.data?.inline || p.data?.value || ""); if (d) parts.push(d); } }); m.onToolCallCompleted(tc => { if (m.isAssistant) tool = (tc?.name || ""); }); });
      ex.onErrorStart(e => { clearTimeout(t); reject(new Error(e?.message || "ex")); }); ex.onExchangeEnd(() => { clearTimeout(t); resolve({ reply: parts.join("").trim(), tool }); });
    };
    const ex = session.startExchange(); attach(ex);
    ex.sendMessageWithContentPart({ data: text, role: MessageRole.User, mimeType: "text/plain" }).catch(reject);
  });
}

const asks = [
  "What reports can you generate for me?",
  "Show me referrals that haven't been delivered yet",
  "Give me a workflow summary of my cases",
  "Give me a breakdown of my cases by protection concern",
  "Show me my high-risk cases",
];
for (const ask of asks) {
  const tok = mintBridgeToken(SENDER, cfg.bridgeSecret, cfg.bridgeTokenTtlMs);
  log("Q:", ask);
  const r = await turn(`[SWIMS_CTX ${tok}]\n${ask}`);
  log("A:", JSON.stringify(r.reply).slice(0, 600));
  console.log("");
}
try { conv.endSession(); } catch {}
process.exit(0);
