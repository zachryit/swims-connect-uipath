import fs from "node:fs";
import path from "node:path";

function unwrap(message) {
  return message?.ephemeralMessage?.message
    || message?.viewOnceMessage?.message
    || message?.viewOnceMessageV2?.message
    || message;
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function resolveLidToPhone(lidUser, authDir) {
  if (!lidUser || !authDir) return "";
  const file = path.join(authDir, `lid-mapping-${lidUser}_reverse.json`);
  try {
    return digits(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return "";
  }
}

export function normalizeSender(jid, authDir = "") {
  const value = String(jid || "");
  const [user, server = ""] = value.split("@");
  if (server === "lid") {
    const mapped = resolveLidToPhone(digits(user), authDir);
    if (mapped) return `+${mapped}`;
  }
  const phone = digits(String(jid || "").split("@")[0]);
  return phone ? `+${phone}` : "";
}

export function extractInbound(message, authDir = "") {
  const body = unwrap(message?.message);
  const text = body?.conversation
    || body?.extendedTextMessage?.text
    || body?.imageMessage?.caption
    || body?.videoMessage?.caption
    || "";

  let messageType = "text";
  if (body?.audioMessage) messageType = "audio";
  else if (body?.imageMessage) messageType = "image";
  else if (body?.videoMessage) messageType = "video";
  else if (body?.documentMessage) messageType = "document";

  const media = body?.audioMessage || body?.imageMessage || body?.videoMessage || body?.documentMessage;

  return {
    channel: "whatsapp",
    sender: normalizeSender(message?.key?.remoteJid, authDir),
    messageId: String(message?.key?.id || ""),
    text: String(text).trim(),
    messageType,
    mimeType: String(media?.mimetype || ""),
    fileName: String(media?.fileName || ""),
    receivedAt: new Date(Number(message?.messageTimestamp || Date.now() / 1000) * 1000).toISOString()
  };
}
