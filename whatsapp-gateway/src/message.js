function unwrap(message) {
  return message?.ephemeralMessage?.message
    || message?.viewOnceMessage?.message
    || message?.viewOnceMessageV2?.message
    || message;
}

export function normalizeSender(jid) {
  const digits = String(jid || "").split("@")[0].replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

export function extractInbound(message) {
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
    sender: normalizeSender(message?.key?.remoteJid),
    messageId: String(message?.key?.id || ""),
    text: String(text).trim(),
    messageType,
    mimeType: String(media?.mimetype || ""),
    fileName: String(media?.fileName || ""),
    receivedAt: new Date(Number(message?.messageTimestamp || Date.now() / 1000) * 1000).toISOString()
  };
}
