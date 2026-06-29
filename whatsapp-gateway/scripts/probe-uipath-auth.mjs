// One-shot health probe: confirms the configured PAT can reach the UiPath
// conversational-agent runtime and that an agent release is visible.
// Run from whatsapp-gateway/:  node scripts/probe-uipath-auth.mjs
import { UiPath } from "@uipath/uipath-typescript/core";
import { ConversationalAgent } from "@uipath/uipath-typescript/conversational-agent";
import { loadConfig } from "../src/config.js";

const cfg = loadConfig();
console.log("base:", cfg.uipathBaseUrl, "org:", cfg.uipathOrg, "tenant:", cfg.uipathTenant, "folderId:", cfg.uipathFolderId);
try {
  const sdk = new UiPath({
    baseUrl: cfg.uipathBaseUrl,
    orgName: cfg.uipathOrg,
    tenantName: cfg.uipathTenant,
    secret: cfg.uipathToken
  });
  await sdk.initialize();
  console.log("SDK initialize(): OK — token accepted for token exchange");
  const ca = new ConversationalAgent(sdk, {
    surfaceName: cfg.uipathSurfaceName,
    surfaceVersion: cfg.uipathSurfaceVersion,
    externalUserId: "swims-connect-healthprobe"
  });
  const agents = await ca.getAll(cfg.uipathFolderId || undefined);
  console.log(`getAll(): OK — ${agents.length} conversational-agent release(s) visible`);
  for (const a of agents.slice(0, 5)) {
    console.log("  -", a.name || a.title || a.displayName, "| id:", a.id, "| folder:", a.folderId);
  }
  console.log("RESULT: UiPath agent path HEALTHY ✅");
  process.exit(0);
} catch (e) {
  console.log("RESULT: UiPath agent path FAILED ❌");
  console.log("error:", e?.status || "", e?.message || e);
  process.exit(1);
}
