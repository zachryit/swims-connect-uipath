import fs from "node:fs";
import path from "node:path";

function safeSender(sender) {
  return String(sender || "").replace(/^\+/, "").replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

export class SenderStateStore {
  constructor(rootDir) {
    this.rootDir = path.join(rootDir, "senders");
    fs.mkdirSync(this.rootDir, { recursive: true, mode: 0o700 });
  }

  pathFor(sender) { return path.join(this.rootDir, `${safeSender(sender)}.json`); }

  get(sender) {
    try { return JSON.parse(fs.readFileSync(this.pathFor(sender), "utf8")); }
    catch { return { sender, history: [], pendingMedia: [], pendingConsent: false }; }
  }

  save(sender, state) {
    const target = this.pathFor(sender);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ ...state, sender, updatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, target);
  }

  clear(sender) {
    try { fs.unlinkSync(this.pathFor(sender)); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}
