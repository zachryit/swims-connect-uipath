// Lean E2E: schedule -> list -> cancel -> verify empty, through the agent (dedupe + cancel fix).
import fs from "node:fs"; import path from "node:path";
import { UiPath } from "@uipath/uipath-typescript/core";
import { ConversationalAgent, MessageRole } from "@uipath/uipath-typescript/conversational-agent";
import { loadConfig } from "../src/config.js";
import { SessionManager } from "../src/primero-client.js";
import { SessionStore } from "../src/session-store.js";
import { mintBridgeToken } from "../src/bridge.js";

const cfg = loadConfig(); const log = (...a) => console.log(new Date().toISOString().slice(11,19), ...a);
const SENDER = "+15530652135456";
const sdk = new UiPath({ baseUrl: cfg.uipathBaseUrl, orgName: cfg.uipathOrg, tenantName: cfg.uipathTenant, secret: cfg.uipathToken });
await sdk.initialize();
const ca = new ConversationalAgent(sdk, { surfaceName: cfg.uipathSurfaceName, surfaceVersion: cfg.uipathSurfaceVersion, externalUserId: "swims-cancel-e2e" });
const agent = await ca.getById(cfg.uipathAgentId || 2247291, cfg.uipathFolderId || 3141212);
const sm = new SessionManager(cfg, new SessionStore(cfg.stateDir, cfg.credentialKey));
await sm.login(SENDER, process.env.PRIMERO_WORKER_USERNAME, process.env.PRIMERO_WORKER_PASSWORD);
const conv = await agent.conversations.create({ label: "cancel-e2e", agentInput: { inline: { swims_sender: SENDER, swims_channel: "whatsapp" } } });
const session = conv.startSession();
await new Promise((res, rej) => { const t=setTimeout(()=>rej(new Error("start")),30000); session.onSessionStarted(()=>{clearTimeout(t);res();}); session.onErrorStart(e=>{clearTimeout(t);rej(e);}); });
function turn(text){return new Promise((resolve,reject)=>{const parts=[];const t=setTimeout(()=>reject(new Error("timeout")),150000);
  const attach=ex=>{ex.onMessageStart(m=>m.onContentPartCompleted(p=>{if(m.isAssistant){const d=typeof p.data==="string"?p.data:(p.data?.inline||"");if(d)parts.push(d);}}));ex.onErrorStart(e=>{clearTimeout(t);reject(e);});ex.onExchangeEnd(()=>{clearTimeout(t);resolve(parts.join("").trim());});};
  const ex=session.startExchange();attach(ex);ex.sendMessageWithContentPart({data:text,role:MessageRole.User,mimeType:"text/plain"}).catch(reject);});}
const ask=async text=>{const tok=mintBridgeToken(SENDER,cfg.bridgeSecret,cfg.bridgeTokenTtlMs);log("Q:",text);const r=await turn(`[SWIMS_CTX ${tok}]\n${text}`);log("A:",JSON.stringify(r).slice(0,300));return r;};
const sched=()=>{try{return JSON.parse(fs.readFileSync(path.join(cfg.stateDir,"schedules.json"),"utf8")).schedules.filter(s=>s.sender===SENDER).map(s=>s.type);}catch{return[];}};

await ask("Send me pending referrals every morning at 8");
log("schedules:", JSON.stringify(sched()), "(expect 1 pending-referrals)");
await ask("What reports am I getting?");
await ask("Stop the daily referral report");
log("schedules after cancel:", JSON.stringify(sched()), "(expect [])");
console.log(sched().length === 0 ? "✅ SCHEDULE CANCELLED" : "❌ still present");
try { conv.endSession(); } catch {}
process.exit(0);
