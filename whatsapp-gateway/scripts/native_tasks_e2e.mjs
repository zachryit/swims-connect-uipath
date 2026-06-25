import { UiPath } from "@uipath/uipath-typescript/core";
import { ConversationalAgent, MessageRole } from "@uipath/uipath-typescript/conversational-agent";
import { loadConfig } from "../src/config.js";
import { SessionManager } from "../src/primero-client.js";
import { SessionStore } from "../src/session-store.js";
import { mintBridgeToken } from "../src/bridge.js";
const cfg = loadConfig(); const log = (...a)=>console.log(new Date().toISOString().slice(11,19),...a);
const SENDER="+15530652135456";
const sdk=new UiPath({baseUrl:cfg.uipathBaseUrl,orgName:cfg.uipathOrg,tenantName:cfg.uipathTenant,secret:cfg.uipathToken});
await sdk.initialize();
const ca=new ConversationalAgent(sdk,{surfaceName:cfg.uipathSurfaceName,surfaceVersion:cfg.uipathSurfaceVersion,externalUserId:"swims-native-e2e"});
const agent=await ca.getById(cfg.uipathAgentId||2247291,cfg.uipathFolderId||3141212);
log("agent version:",agent.processVersion||agent.version);
const sm=new SessionManager(cfg,new SessionStore(cfg.stateDir,cfg.credentialKey));
await sm.login(SENDER,process.env.PRIMERO_WORKER_USERNAME,process.env.PRIMERO_WORKER_PASSWORD);
const conv=await agent.conversations.create({label:"native-e2e",agentInput:{inline:{swims_sender:SENDER,swims_channel:"whatsapp"}}});
const session=conv.startSession();
await new Promise((res,rej)=>{const t=setTimeout(()=>rej(new Error("start")),30000);session.onSessionStarted(()=>{clearTimeout(t);res();});session.onErrorStart(e=>{clearTimeout(t);rej(e);});});
function turn(text){return new Promise((resolve,reject)=>{const parts=[];const t=setTimeout(()=>reject(new Error("timeout")),150000);
  const attach=ex=>{ex.onMessageStart(m=>m.onContentPartCompleted(p=>{if(m.isAssistant){const d=typeof p.data==="string"?p.data:(p.data?.inline||"");if(d)parts.push(d);}}));ex.onErrorStart(e=>{clearTimeout(t);reject(e);});ex.onExchangeEnd(()=>{clearTimeout(t);resolve(parts.join("").trim());});};
  const ex=session.startExchange();attach(ex);ex.sendMessageWithContentPart({data:text,role:MessageRole.User,mimeType:"text/plain"}).catch(reject);});}
for(const q of ["Show me referrals that haven't been delivered yet","What's on my plate today?"]){
  const tok=mintBridgeToken(SENDER,cfg.bridgeSecret,cfg.bridgeTokenTtlMs);
  log("Q:",q); log("A:",JSON.stringify(await turn(`[SWIMS_CTX ${tok}]\n${q}`)).slice(0,400)); console.log("");
}
try{conv.endSession();}catch{} process.exit(0);
