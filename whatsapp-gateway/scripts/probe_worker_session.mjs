// Does the conversational agent actually ACT AS the injected worker session?
// Create a conversation WITH swims_session in agentInput (as the gateway does) and ask to
// list cases. If it lists -> injection works; if it asks to sign in -> injection is broken.
import { UiPath } from "@uipath/uipath-typescript/core";
import { ConversationalAgent, MessageRole } from "@uipath/uipath-typescript/conversational-agent";
import { loadConfig } from "../src/config.js";
import { SessionManager } from "../src/primero-client.js";
import { SessionStore } from "../src/session-store.js";

const cfg = loadConfig();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sm = new SessionManager(cfg, new SessionStore(cfg.stateDir, cfg.credentialKey));
const worker = await sm.worker("+15530652135456");
if (!worker) { console.log("no worker session available"); process.exit(1); }
log("using worker session for user:", worker.user?.user_name || worker.username);

const sdk = new UiPath({ baseUrl: cfg.uipathBaseUrl, orgName: cfg.uipathOrg, tenantName: cfg.uipathTenant, secret: cfg.uipathToken });
await sdk.initialize();
const ca = new ConversationalAgent(sdk, { surfaceName: cfg.uipathSurfaceName, surfaceVersion: cfg.uipathSurfaceVersion, externalUserId: "swims-connect-worker-probe" });
const agent = await ca.getById(cfg.uipathAgentId || 2247291, cfg.uipathFolderId || 3141212);
log("agent version:", agent.processVersion || agent.version);

const conversation = await agent.conversations.create({
  label: "SWIMS worker-session probe",
  agentInput: { inline: { swims_sender: "+15530652135456", swims_channel: "whatsapp", swims_session: { cookie: worker.cookie, csrf: worker.csrf } } }
});
log("conversation:", conversation.id, "(created WITH swims_session)");
const session = conversation.startSession();
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("session start timeout")), 30000); session.onSessionStarted(() => { clearTimeout(t); res(); }); session.onErrorStart((e) => { clearTimeout(t); rej(new Error("sess err " + (e?.message || ""))); }); });

const parts = []; let toolNote = "";
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("turn timeout")), 150000);
  const attach = (ex) => {
    ex.onMessageStart((m) => {
      m.onContentPartCompleted((p) => { if (m.isAssistant) { const d = typeof p.data === "string" ? p.data : (p.data?.inline || p.data?.value || ""); if (d) parts.push(d); } });
      m.onToolCallCompleted((tc) => { if (m.isAssistant) { let o = tc?.output; if (typeof o === "string") { try { o = JSON.parse(o); } catch {} } toolNote = JSON.stringify(o).slice(0, 300); } });
    });
    ex.onErrorStart((e) => { clearTimeout(t); reject(new Error("exchange err " + (e?.message || JSON.stringify(e)))); });
    ex.onExchangeEnd(() => { clearTimeout(t); resolve(); });
  };
  const ex = session.startExchange(); attach(ex);
  ex.sendMessageWithContentPart({ data: "Please list the most recent SWIMS cases.", role: MessageRole.User, mimeType: "text/plain" }).catch(reject);
});
try { conversation.endSession(); } catch {}
log("reply:", JSON.stringify(parts.join("").trim()));
log("tool output:", toolNote || "(none)");
const asksLogin = /sign[- ]?in|signed-in|log[- ]?in|worker authentication/i.test(parts.join(" "));
log(asksLogin ? "❌ agent asked to SIGN IN -> worker session NOT injected" : "✅ agent acted as worker (no sign-in prompt)");
process.exit(0);
