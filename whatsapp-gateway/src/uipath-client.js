import { spawn } from "node:child_process";

// Drives one WhatsApp conversation turn through the deployed UiPath agent.
// Keeps a short per-sender history (sent to the agent each turn — the agent is invoked
// statelessly per job). SWIMS session injection (worker login) is added later; for now
// turns run anonymously (community reporting), which is the core demo path.
export class UiPathConversationClient {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.history = new Map(); // sender -> [{ role, content }]
    this.sessions = new Map(); // sender -> { cookie, csrf }  (populated by the login flow, later)
  }

  async turn(inbound) {
    if (!inbound.text) {
      return { reply: "Please send a text message describing your concern or request.", caseStarted: false };
    }
    const sender = inbound.sender;
    const hist = this.history.get(sender) || [];
    hist.push({ role: "user", content: inbound.text });

    const payload = JSON.stringify({ messages: hist, session: this.sessions.get(sender) || null });
    const result = await this.#invoke(payload);
    if (result.error) throw new Error(result.error);

    const reply = (result.reply || "").trim() || "Sorry, I couldn't process that. Please try again.";
    hist.push({ role: "assistant", content: reply });
    this.history.set(sender, hist.slice(-this.config.historyTurns));
    return { reply, caseStarted: false };
  }

  #invoke(payload) {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.config.python, [this.config.invokeScript], { stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      const timer = setTimeout(() => proc.kill("SIGKILL"), this.config.turnTimeoutMs);

      proc.stdout.on("data", (d) => { out += d; });
      proc.stderr.on("data", (d) => { err += d; });
      proc.on("error", (e) => { clearTimeout(timer); reject(e); });
      proc.on("close", () => {
        clearTimeout(timer);
        const line = out.split("\n").find((l) => l.startsWith("<<<AGENT_RESULT>>>"));
        if (!line) return reject(new Error(`agent invoke produced no result: ${err.slice(-400) || out.slice(-400)}`));
        try {
          resolve(JSON.parse(line.replace("<<<AGENT_RESULT>>>", "")));
        } catch (e) {
          reject(new Error(`bad agent result JSON: ${line.slice(0, 200)}`));
        }
      });

      proc.stdin.write(payload);
      proc.stdin.end();
    });
  }
}
