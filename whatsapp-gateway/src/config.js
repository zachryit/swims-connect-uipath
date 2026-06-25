import path from "node:path";

function loadEnvFile(file) {
  try { process.loadEnvFile(file); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export function loadConfig() {
  // Repo root holds the .venv (with the uipath SDK) and .env.uipath (PAT). The gateway
  // runs from whatsapp-gateway/, so default to its parent.
  const repoRoot = path.resolve(process.env.SWIMS_REPO_ROOT || "..");
  loadEnvFile(path.join(repoRoot, ".env"));
  loadEnvFile(path.join(repoRoot, ".env.uipath"));
  loadEnvFile(path.resolve(".env"));
  const uipathUrl = process.env.UIPATH_URL || "";
  const uipathUrlParts = uipathUrl ? new URL(uipathUrl) : null;
  const uipathPathParts = (uipathUrlParts?.pathname || "").split("/").filter(Boolean);
  return {
    // How we reach the deployed UiPath agent: UiPath TypeScript conversational SDK only.
    uipathBaseUrl: process.env.UIPATH_BASE_URL || (uipathUrlParts ? uipathUrlParts.origin : "https://cloud.uipath.com"),
    uipathOrg: process.env.UIPATH_ORG || uipathPathParts[0] || "",
    uipathTenant: process.env.UIPATH_TENANT || uipathPathParts[1] || "",
    uipathToken: process.env.UIPATH_ACCESS_TOKEN || process.env.UIPATH_PAT || "",
    uipathFolderId: Number(process.env.UIPATH_FOLDER_ID || process.env.SWIMS_SHARED_FOLDER_ID || 0) || null,
    uipathAgentId: Number(process.env.UIPATH_AGENT_ID || process.env.SWIMS_UIPATH_AGENT_ID || 0) || null,
    uipathAgentName: process.env.UIPATH_AGENT_NAME || process.env.SWIMS_UIPATH_AGENT_NAME || "swims-connect-agent",
    uipathSurfaceName: process.env.UIPATH_SURFACE_NAME || "swims-connect-whatsapp-gateway",
    uipathSurfaceVersion: process.env.UIPATH_SURFACE_VERSION || "0.1.0",
    agentReleaseTtlMs: Number(process.env.UIPATH_AGENT_RELEASE_TTL_MS || 60 * 1000),
    conversationIdleTtlMs: Number(process.env.UIPATH_CONVERSATION_IDLE_TTL_MS || 25 * 60 * 1000),
    turnTimeoutMs: Number(process.env.AGENT_TURN_TIMEOUT_MS || 75000),
    historyTurns: Number(process.env.HISTORY_TURNS || 20),

    stateDir: path.resolve(process.env.SWIMS_GATEWAY_STATE_DIR || "./state"),
    mediaDir: path.resolve(process.env.SWIMS_MEDIA_DIR || "./state/media/inbound"),
    maxMediaBytes: Number(process.env.SWIMS_MAX_MEDIA_BYTES || 20 * 1024 * 1024),
    credentialKey: process.env.SWIMS_CRED_KEY || "",

    primeroBaseUrl: (process.env.PRIMERO_API_BASE_URL || process.env.SWIMS_API_BASE_URL || "http://127.0.0.1:3000/api/v2").replace(/\/$/, ""),
    primeroAnonUsername: process.env.PRIMERO_ANON_USERNAME || process.env.SWIMS_ANONYMOUS_USERNAME || "",
    primeroAnonPassword: process.env.PRIMERO_ANON_PASSWORD || process.env.SWIMS_ANONYMOUS_PASSWORD || "",
    primeroTimeoutMs: Number(process.env.PRIMERO_TIMEOUT_MS || 60000),

    googleApiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "",
    transcribeModel: process.env.GEMINI_TRANSCRIBE_MODEL || process.env.GEMINI_MODEL || "gemini-3.1-pro-preview",
    mediaAnalysisTimeoutMs: Number(process.env.MEDIA_ANALYSIS_TIMEOUT_MS || 90000),

    authServerUrl: process.env.AUTH_SERVER_URL || "https://swims.ownaradio.com",
    authServerBind: process.env.AUTH_SERVER_BIND || "127.0.0.1",
    authServerPort: Number(process.env.AUTH_SERVER_PORT || 18794),
    whatsappBotNumber: String(process.env.WHATSAPP_BOT_NUMBER || "233256590242").replace(/\D/g, ""),

    authDir: path.resolve(process.env.WHATSAPP_AUTH_DIR || "./state/auth"),
    qrPath: path.resolve(process.env.WHATSAPP_QR_PATH || "./state/wa-qr.png"),
    logLevel: process.env.LOG_LEVEL || "info"
  };
}
