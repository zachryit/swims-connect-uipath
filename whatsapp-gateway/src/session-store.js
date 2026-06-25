import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function safeSender(sender) {
  return String(sender || "").replace(/^\+/, "").replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

export class SessionStore {
  constructor(stateDir, configuredKey = "") {
    this.dir = path.join(stateDir, "sessions");
    this.keyPath = path.join(this.dir, ".credential.key");
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.key = this.#loadKey(configuredKey);
  }

  #loadKey(configuredKey) {
    if (configuredKey) return crypto.createHash("sha256").update(configuredKey).digest();
    try { return Buffer.from(fs.readFileSync(this.keyPath, "utf8").trim(), "base64"); }
    catch {
      const key = crypto.randomBytes(32);
      fs.writeFileSync(this.keyPath, key.toString("base64"), { mode: 0o600 });
      return key;
    }
  }

  #path(sender) { return path.join(this.dir, `${safeSender(sender)}.json`); }

  #encrypt(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
    return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
  }

  #decrypt(value) {
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, Buffer.from(value.iv, "base64"));
    decipher.setAuthTag(Buffer.from(value.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8");
  }

  save(sender, { username, password, cookie, csrf, user }) {
    fs.writeFileSync(this.#path(sender), JSON.stringify({
      sender, username, password: this.#encrypt(password), cookie, csrf, user,
      savedAt: new Date().toISOString(), revoked: false
    }, null, 2), { mode: 0o600 });
  }

  get(sender) {
    try {
      const record = JSON.parse(fs.readFileSync(this.#path(sender), "utf8"));
      if (record.revoked) return null;
      return { ...record, password: this.#decrypt(record.password) };
    } catch { return null; }
  }

  updateSession(sender, session) {
    const current = this.get(sender);
    if (current) this.save(sender, { ...current, ...session });
  }

  logout(sender) {
    try { fs.unlinkSync(this.#path(sender)); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}
