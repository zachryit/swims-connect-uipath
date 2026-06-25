// Worker report flow, end-to-end & honest:
//  1) ask the agent for a case report with NO session  -> expect "please sign in"
//  2) "log in" as a real worker (establish Primero session, as the login link would)
//  3) prove that worker sees cases directly in SWIMS (data + account are fine)
//  4) ask the agent for the report WITH the worker session passed the only available way
//     (agentInput) -> shows whether the agent can act as the worker (the bridge gap)
import { UiPath } from "@uipath/uipath-typescript/core";
import { ConversationalAgent, MessageRole } from "@uipath/uipath-typescript/conversational-agent";
import { loadConfig } from "../src/config.js";
import { SessionManager } from "../src/primero-client.js";
import { SessionStore } from "../src/session-store.js";

const cfg = loadConfig();
const log = (...a) => console.log(new Date().toISOString().slice(11,19), ...a);
const WORKER_USER = process.env.PRIMERO_WORKER_USERNAME, WORKER_PASS = process.env.PRIMERO_WORKER_PASSWORD;
const SENDER = "+15530652135456";

const sdk = new UiPath({ baseUrl: cfg.uipathBaseUrl, orgName: cfg.uipathOrg, tenantName: cfg.uipathTenant, secret: cfg.uipathToken });
await sdk.initialize();
const ca = new ConversationalAgent(sdk, { surfaceName: cfg.uipathSurfaceName, surfaceVersion: cfg.uipathSurfaceVersion, externalUserId: "swims-worker-flow" });
const agent = await ca.getById(cfg.uipathAgentId || 2247291, cfg.uipathFolderId || 3141212);

async function askAgent(agentInput, text) {
  const conv = await agent.conversations.create({ label: "worker-flow", agentInput: { inline: agentInput } });
  const session = conv.startSession();
  await new Promise((res, rej) => { const t=setTimeout(()=>rej(new Error("start timeout")),30000); session.onSessionStarted(()=>{clearTimeout(t);res();}); session.onErrorStart(e=>{clearTimeout(t);rej(new Error(e?.message||"sess err"));}); });
  const parts=[]; let tool="";
  await new Promise((resolve,reject)=>{ const t=setTimeout(()=>reject(new Error("turn timeout")),150000);
    const attach=(ex)=>{ ex.onMessageStart(m=>{ m.onContentPartCompleted(p=>{ if(m.isAssistant){const d=typeof p.data==="string"?p.data:(p.data?.inline||p.data?.value||"");if(d)parts.push(d);} }); m.onToolCallCompleted(tc=>{ if(m.isAssistant){let o=tc?.output; if(typeof o==="string"){try{o=JSON.parse(o);}catch{}} tool=JSON.stringify(o).slice(0,200);} }); });
      ex.onErrorStart(e=>{clearTimeout(t);reject(new Error(e?.message||"ex err"));}); ex.onExchangeEnd(()=>{clearTimeout(t);resolve();}); };
    const ex=session.startExchange(); attach(ex);
    ex.sendMessageWithContentPart({ data:text, role:MessageRole.User, mimeType:"text/plain" }).catch(reject);
  });
  try{conv.endSession();}catch{}
  return { reply: parts.join("").trim(), tool };
}

log("STEP 1 — ask agent for a report, NO session");
const r1 = await askAgent({ swims_sender: SENDER, swims_channel: "whatsapp" }, "How many cases are there so far? Give me a report.");
log("agent:", JSON.stringify(r1.reply), "| tool:", r1.tool || "(none)");

log("STEP 2 — log in as worker (establishes Primero session, as the login link would)");
const sm = new SessionManager(cfg, new SessionStore(cfg.stateDir, cfg.credentialKey));
const w = await sm.login(SENDER, WORKER_USER, WORKER_PASS);
log("logged in as:", w.user?.user_name || w.user?.data?.user_name || WORKER_USER);

log("STEP 3 — that worker's cases, read DIRECTLY from SWIMS (proves data + account)");
const direct = await sm.client.request(w, "GET", "/cases", undefined, { per: 5 });
const rows = direct.ok ? ((await direct.json()).data || []) : [];
log("direct SWIMS GET /cases ->", direct.status, "| visible cases:", rows.length,
    rows.slice(0,5).map(c=>c.case_id_display||c.short_id).join(", "));

log("STEP 4 — ask agent for the report WITH the worker session (only channel available: agentInput)");
const r2 = await askAgent({ swims_sender: SENDER, swims_channel: "whatsapp", swims_session: { cookie: w.cookie, csrf: w.csrf } },
                          "How many cases are there so far? Give me a report.");
log("agent:", JSON.stringify(r2.reply), "| tool:", r2.tool || "(none)");
const stillBlocked = /sign[- ]?in|signed-in|registered swims worker|please sign/i.test(r2.reply);
log(stillBlocked ? "❌ agent STILL asks to sign in -> worker session never reached it (bridge needed)"
                 : "✅ agent reported as the worker (session reached it)");
process.exit(0);
