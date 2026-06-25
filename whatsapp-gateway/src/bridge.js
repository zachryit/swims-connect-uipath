import crypto from "node:crypto";

// Worker auth-context bridge token: an opaque, HMAC-signed, sender-bound, short-TTL handle.
// It is NOT the SWIMS session — it's a reference the agent exchanges (over a secret-protected
// endpoint) for the worker's Primero session. The token is stripped before the LLM sees it.

const CTX_RE = /\[SWIMS_CTX[^\]]*\]/gi;

export function stripContextLines(text) {
  // Remove any SWIMS_CTX markers a user might TYPE (anti-spoofing) before we add our own.
  return String(text || "").replace(CTX_RE, "").replace(/^\s*\n/, "").trim();
}

export function mintBridgeToken(sender, secret, ttlMs) {
  const exp = Date.now() + ttlMs;
  const payload = `${sender}|${exp}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

export function verifyBridgeToken(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  const [p64, sig] = parts;
  let payload;
  try { payload = Buffer.from(p64, "base64url").toString(); } catch { return null; }
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(sig); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const [sender, expStr] = payload.split("|");
  const exp = Number(expStr);
  if (!sender || !exp || Date.now() > exp) return null;
  return { sender, exp };
}
