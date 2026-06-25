// End-to-end test: file a case FROM AN IMAGE by CHATTING with the deployed agent
// (no direct tool calls), then attach the original image exactly as the gateway does.
//   1. analyzeMedia(image)        -> Gemini vision description + concern flag (gateway step)
//   2. converse with the agent     -> turn1 image text => consent question; turn2 "yes" => case
//   3. attachMedia(...)            -> upload original bytes to /cases/{id}/attachments (gateway step)
//   4. verify                      -> read the case as the owner worker, confirm a photo is attached
import { UiPath } from "@uipath/uipath-typescript/core";
import { ConversationalAgent, MessageRole } from "@uipath/uipath-typescript/conversational-agent";
import { loadConfig } from "../src/config.js";
import { analyzeMedia, attachMedia } from "../src/media.js";
import { SessionManager } from "../src/primero-client.js";
import { SessionStore } from "../src/session-store.js";

const IMAGE = process.argv[2] || "/tmp/claude-1000/-home-azureuser/bd9d6fd7-82e1-47bb-ba72-fd921819f79c/scratchpad/test_case_image.jpg";
const CAPTION = "Please help. I saw a girl about 10 selling sachet water alone at Kaneshie market in Accra late at night. She looks unwell and says she has nowhere to sleep tonight.";

const cfg = loadConfig();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---- 1. gateway media pipeline: vision analysis ----
const media = { path: IMAGE, mimeType: "image/jpeg", kind: "image", caption: CAPTION, messageId: "E2E-IMG-1" };
log("analyzing image with Gemini vision …");
const analysis = await analyzeMedia(cfg, media);
log("vision:", JSON.stringify(analysis));
// exactly how src/index.js prepareTurn() builds the text the agent sees for an image
const agentText = [
  media.caption,
  analysis.description ? `[Image description: ${analysis.description}]` : "",
  `[Image indicates a possible child-protection concern: ${analysis.concerning ? "yes" : "no"}.]`
].filter(Boolean).join("\n");
log("agent will receive:\n" + agentText);

// ---- 2. converse with the deployed agent ----
const sdk = new UiPath({ baseUrl: cfg.uipathBaseUrl, orgName: cfg.uipathOrg, tenantName: cfg.uipathTenant, secret: cfg.uipathToken });
await sdk.initialize();
const ca = new ConversationalAgent(sdk, { surfaceName: cfg.uipathSurfaceName, surfaceVersion: cfg.uipathSurfaceVersion, externalUserId: "swims-connect-e2e-img" });
const agent = await ca.getById(cfg.uipathAgentId || 2247291, cfg.uipathFolderId || 3141212);
log("agent version:", agent.processVersion || agent.version);
const conversation = await agent.conversations.create({ label: "SWIMS E2E image", agentInput: { inline: { swims_sender: "+10000000777", swims_channel: "whatsapp" } } });
const session = conversation.startSession();
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("session start timeout")), 30000); session.onSessionStarted(() => { clearTimeout(t); res(); }); session.onErrorStart((e) => { clearTimeout(t); rej(new Error("session err " + (e?.message || ""))); }); });

function turn(text, ms = 160000) {
  return new Promise((resolve, reject) => {
    const parts = [], cases = []; let done = false;
    const fin = (v, e) => { if (done) return; done = true; clearTimeout(t); e ? reject(e) : resolve(v); };
    const t = setTimeout(() => fin(null, new Error("turn timeout")), ms);
    const grab = (tc) => { let o = tc?.output; if (typeof o === "string") { try { o = JSON.parse(o); } catch {} } if (o && typeof o === "object" && (o.case_id_display || o.swims_case_id || o.error)) cases.push(o); };
    const attach = (ex) => {
      ex.onMessageStart((m) => {
        m.onContentPartCompleted((p) => { if (m.isAssistant) { const d = typeof p.data === "string" ? p.data : (p.data?.inline || p.data?.value || ""); if (d) parts.push(d); } });
        m.onToolCallCompleted((tc) => { if (m.isAssistant) grab(tc); });
        m.onCompleted((c) => { for (const tc of c.toolCalls || []) grab(tc); });
      });
      ex.onErrorStart((e) => fin(null, new Error("exchange err " + (e?.message || JSON.stringify(e)))));
      ex.onExchangeEnd(() => fin({ reply: parts.join("").trim(), cases }));
    };
    const ex = session.startExchange(); attach(ex);
    ex.sendMessageWithContentPart({ data: text, role: MessageRole.User, mimeType: "text/plain" }).catch((e) => fin(null, e));
  });
}

log("TURN 1 (image report) …");
const r1 = await turn(agentText);
log("reply:", JSON.stringify(r1.reply));
log("TURN 2 (yes) …");
const r2 = await turn("yes");
log("reply:", JSON.stringify(r2.reply));
try { conversation.endSession(); } catch {}

const made = [...r1.cases, ...r2.cases].find((c) => c.swims_case_id || c.case_id_display);
if (!made) { log("❌ no case created — replies above"); process.exit(1); }
const caseUuid = made.swims_case_id, caseDisplay = made.case_id_display;
log("✅ case filed by agent:", caseDisplay, "(", caseUuid, ")");

// ---- 3. gateway attaches the original image (anon session, real path) ----
const sm = new SessionManager(cfg, new SessionStore(cfg.stateDir, cfg.credentialKey));
// Same selection as the gateway's routeTurn: owner-worker for anonymous reports.
const attachSession = await sm.defaultOwner() || await sm.anonymous();
log("attaching image to case via gateway attachMedia() …");
await attachMedia({ media, caseId: caseUuid, session: attachSession, primero: sm.client });
log("attachMedia() returned OK (no rejection)");

// ---- 4. verify the photo is actually on the case (read as the owner worker) ----
const wuser = process.env.PRIMERO_WORKER_USERNAME, wpass = process.env.PRIMERO_WORKER_PASSWORD;
let verified = false, detail = "";
if (wuser && wpass) {
  const wsess = await sm.client.login(wuser, wpass);
  const resp = await sm.client.request(wsess, "GET", `/cases/${encodeURIComponent(caseUuid)}`);
  if (resp.ok) {
    const data = (await resp.json()).data || {};
    const photos = data.photos || data.photo_keys || [];
    detail = `photos field length=${Array.isArray(photos) ? photos.length : "n/a"}`;
    verified = Array.isArray(photos) && photos.length > 0;
    if (!verified) detail += "; keys=" + Object.keys(data).filter(k => /photo|attach|recorded/.test(k)).join(",");
  } else { detail = `owner GET HTTP ${resp.status}`; }
}
log(verified ? `✅ VERIFIED image attached to ${caseDisplay} (${detail})` : `⚠️ attachment POST ok but read-back inconclusive (${detail})`);
process.exit(0);
