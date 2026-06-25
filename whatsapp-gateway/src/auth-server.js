import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const esc = (value) => String(value).replace(/[&<>\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
const safe = (sender) => String(sender).replace(/^\+/, "").replace(/[^a-zA-Z0-9_.:-]/g, "_");

export class LoginService {
  constructor(config, sessions, logger) {
    this.config = config; this.sessions = sessions; this.logger = logger;
    this.pendingDir = path.join(config.stateDir, "login");
    fs.mkdirSync(this.pendingDir, { recursive: true, mode: 0o700 });
  }

  createLink(sender, resumeText = "") {
    const token = crypto.randomBytes(18).toString("base64url");
    const record = { sender, resumeText, expiresAt: Date.now() + 10 * 60 * 1000 };
    fs.writeFileSync(path.join(this.pendingDir, `${token}.json`), JSON.stringify(record), { mode: 0o600 });
    const url = `${this.config.authServerUrl.replace(/\/$/, "")}/login/${token}`;
    return `Open this secure link to connect your SWIMS account: ${url}\n\nIt expires in 10 minutes.`;
  }

  #pending(token) {
    if (!/^[a-zA-Z0-9_-]{16,64}$/.test(token)) return null;
    try {
      const file = path.join(this.pendingDir, `${token}.json`);
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      return value.expiresAt > Date.now() ? { ...value, file } : null;
    } catch { return null; }
  }

  start() {
    const server = http.createServer(async (req, res) => {
      try { await this.#handle(req, res); }
      catch (error) { this.logger.error({ error }, "Login server request failed"); res.writeHead(500).end("Unable to complete login"); }
    });
    server.listen(this.config.authServerPort, this.config.authServerBind, () => this.logger.info({ port: this.config.authServerPort }, "Secure worker login server started"));
    return server;
  }

  async #handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/health") return res.writeHead(200, { "Content-Type": "application/json" }).end('{"ok":true}');
    if (req.method === "GET" && url.pathname.startsWith("/login/")) {
      const token = url.pathname.slice(7); const pending = this.#pending(token);
      if (!pending) return res.writeHead(410, { "Content-Type": "text/plain" }).end("This login link is invalid or expired.");
      return res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(this.#page(token));
    }
    if (req.method === "POST" && url.pathname === "/login") {
      let raw = ""; for await (const chunk of req) { raw += chunk; if (raw.length > 16_384) throw new Error("Form too large"); }
      const form = new URLSearchParams(raw); const token = form.get("token") || ""; const pending = this.#pending(token);
      if (!pending) return res.writeHead(410, { "Content-Type": "text/plain" }).end("This login link is invalid or expired.");
      try {
        const session = await this.sessions.login(pending.sender, String(form.get("username") || "").trim(), String(form.get("password") || ""));
        fs.rmSync(pending.file, { force: true });
        const user = session.user?.user_name || session.user?.data?.user_name || form.get("username");
        const back = this.config.whatsappBotNumber ? `https://wa.me/${this.config.whatsappBotNumber}?text=${encodeURIComponent("I've signed in to SWIMS — please continue.")}` : "";
        res.writeHead(back ? 302 : 200, back ? { Location: back } : { "Content-Type": "text/html" });
        return res.end(back ? "Signed in. Returning to WhatsApp…" : `<p>Signed in as ${esc(user)}. You may return to WhatsApp.</p>`);
      } catch (error) {
        return res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" }).end(this.#page(token, error.message));
      }
    }
    res.writeHead(404).end("Not found");
  }

  #page(token, error = "") {
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>SWIMS-Connect Login</title><style>body{font:16px system-ui;background:#eef5f0;display:grid;place-items:center;min-height:100vh}.card{background:white;padding:2rem;border-radius:12px;width:min(360px,85vw);box-shadow:0 4px 20px #1748}input,button{box-sizing:border-box;width:100%;padding:.75rem;margin:.4rem 0 1rem}button{background:#09623a;color:white;border:0;border-radius:6px}.error{color:#a21b1b}</style></head><body><main class="card"><h1>SWIMS-Connect</h1><p>Securely connect your SWIMS worker account.</p>${error ? `<p class="error">${esc(error)}</p>` : ""}<form method="post" action="/login"><input type="hidden" name="token" value="${esc(token)}"><label>Username<input name="username" autocomplete="username" required></label><label>Password<input type="password" name="password" autocomplete="current-password" required></label><button>Connect account</button></form><small>Your credentials are encrypted for silent session renewal. Explicit logout removes them.</small></main></body></html>`;
  }
}
