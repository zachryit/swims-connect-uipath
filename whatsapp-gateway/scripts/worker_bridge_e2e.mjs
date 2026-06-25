// CLOUD end-to-end test of the worker auth-context bridge.
//  - no token  -> agent asks to sign in
//  - log in worker (saved in gateway store, what the login link does)
//  - with a minted [SWIMS_CTX token] (what the gateway now prepends) -> agent acts as the
//    worker, reports real cases, and never leaks the token. Multi-turn to confirm it persists.
import { UiPath } from "@uipath/uipath-typescript/core";
import { ConversationalAgent, MessageRole } from "@uipath/uipath-typescript/conversational-agent";
import { loadConfig } from "../src/config.js";
import { SessionManager } from "../src/primero-client.js";
import { SessionStore } from "../src/session-store.js";
import { mintBridgeToken } from "../src/bridge.js";

const cfg = loadConfig();
const log = (...a) => console.log(new Date().toISOString().slice(11,19), ...a);
const SENDER = "+15530652135456";

const sdk = new UiPath({ baseUrl: cfg.uipathBaseUrl, orgName: cfg.uipathOrg, tenantName: cfg.uipathTenant, secret: cfg.uipathToken });
await sdk.initialize();
const ca = new ConversationalAgent(sdk, { surfaceName: cfg.uipathSurfaceName, surfaceVersion: cfg.uipathSurfaceVersion, externalUserId: "swims-bridge-e2e" });
const agent = await ca.getById(cfg.uipathAgentId || 2247291, cfg.uipathFolderId || 3141212);
log("agent version:", agent.processVersion || agent.version);

const conv = await agent.conversations.create({ label: "bridge-e2e", agentInput: { inline: { swims_sender: SENDER, swims_channel: "whatsapp" } } });
const session = conv.startSession();
await new Promise((res, rej) => { const t=setTimeout(()=>rej(new Error("start timeout")),30000); session.onSessionStarted(()=>{clearTimeout(t);res();}); session.onErrorStart(e=>{clearTimeout(t);rej(new Error(e?.message||"sess"));}); });

function turn(text, ms=150000){return new Promise((resolve,reject)=>{const parts=[];let tool="";const t=setTimeout(()=>reject(new Error("turn timeout")),ms);
  const attach=(ex)=>{ex.onMessageStart(m=>{m.onContentPartCompleted(p=>{if(m.isAssistant){const d=typeof p.data==="string"?p.data:(p.data?.inline||p.data?.value||"");if(d)parts.push(d);}});m.onToolCallCompleted(tc=>{if(m.isAssistant){let o=tc?.output;if(typeof o==="string"){try{o=JSON.parse(o);}catch{}}tool=JSON.stringify(o).slice(0,200);}});});
    ex.onErrorStart(e=>{clearTimeout(t);reject(new Error(e?.message||"ex"));});ex.onExchangeEnd(()=>{clearTimeout(t);resolve({reply:parts.join("").trim(),tool});});};
  const ex=session.startExchange();attach(ex);ex.sendMessageWithContentPart({data:text,role:MessageRole.User,mimeType:"text/plain"}).catch(reject);});}

const sm = new SessionManager(cfg, new SessionStore(cfg.stateDir, cfg.credentialKey));

log("TURN A — no token (anonymous)");
const a = await turn("How many cases are there so far?");
log("agent:", JSON.stringify(a.reply));

log("login worker (saved in gateway store)…");
const w = await sm.login(SENDER, process.env.PRIMERO_WORKER_USERNAME, process.env.PRIMERO_WORKER_PASSWORD);
log("logged in:", w.user?.user_name);

const tok1 = mintBridgeToken(SENDER, cfg.bridgeSecret, cfg.bridgeTokenTtlMs);
log("TURN B — with [SWIMS_CTX] token (what the gateway prepends)");
const b = await turn(`[SWIMS_CTX ${tok1}]\nHow many cases are there so far? Give me a brief report.`);
log("agent:", JSON.stringify(b.reply), "| tool:", b.tool || "(none)");

const tok2 = mintBridgeToken(SENDER, cfg.bridgeSecret, cfg.bridgeTokenTtlMs);
log("TURN C — 'tell me about it' (get_case by short id — the path that faulted)");
const c = await turn(`[SWIMS_CTX ${tok2}]\nTell me more about case 43abe2a.`);
log("agent:", JSON.stringify(c.reply), "| tool:", c.tool || "(none)");
try { conv.endSession(); } catch {}

const blocked = (r) => /sign[- ]?in|signed-in|registered swims worker|please sign/i.test(r);
const leaked = [a,b,c].some(r => /SWIMS_CTX|[A-Za-z0-9_-]{40,}\./.test(r.reply));
console.log("\n=== verdict ===");
console.log("A no-token blocked (expect yes):", blocked(a.reply));
console.log("B with-token acted as worker (expect yes):", !blocked(b.reply));
console.log("C follow-up acted as worker (expect yes):", !blocked(c.reply));
console.log("token leaked in any reply (expect no):", leaked);
console.log((blocked(a.reply) && !blocked(b.reply) && !blocked(c.reply) && !leaked) ? "✅ BRIDGE WORKS END-TO-END" : "❌ needs attention");
process.exit(0);
