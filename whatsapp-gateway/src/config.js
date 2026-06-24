import path from "node:path";

export function loadConfig() {
  // Repo root holds the .venv (with the uipath SDK) and .env.uipath (PAT). The gateway
  // runs from whatsapp-gateway/, so default to its parent.
  const repoRoot = path.resolve(process.env.SWIMS_REPO_ROOT || "..");
  return {
    // How we reach the deployed UiPath agent: a Python helper that invokes the job and
    // returns the reply (StartJobs -> poll -> extract_output). The agent is the brain;
    // this gateway is transport only.
    python: process.env.PYTHON_BIN || path.join(repoRoot, ".venv/bin/python"),
    invokeScript: path.resolve(process.env.AGENT_INVOKE_SCRIPT || "./scripts/invoke_agent.py"),
    turnTimeoutMs: Number(process.env.AGENT_TURN_TIMEOUT_MS || 180000),
    historyTurns: Number(process.env.HISTORY_TURNS || 20),

    authDir: path.resolve(process.env.WHATSAPP_AUTH_DIR || "./state/auth"),
    qrPath: path.resolve(process.env.WHATSAPP_QR_PATH || "./state/wa-qr.png"),
    logLevel: process.env.LOG_LEVEL || "info"
  };
}
