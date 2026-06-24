import fs from "node:fs/promises";
import path from "node:path";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState
} from "baileys";
import pino from "pino";
import QRCode from "qrcode";

import { loadConfig } from "./config.js";
import { extractInbound } from "./message.js";
import { UiPathConversationClient } from "./uipath-client.js";

const config = loadConfig();
const logger = pino({ level: config.logLevel });
const client = new UiPathConversationClient(config, logger);
const handled = new Set();

async function writeQr(qr) {
  await fs.mkdir(path.dirname(config.qrPath), { recursive: true, mode: 0o700 });
  await QRCode.toFile(config.qrPath, qr, { width: 512, margin: 2 });
  const ascii = await QRCode.toString(qr, { type: "terminal", small: true });
  process.stdout.write(
    `\n=== Pair WhatsApp +233256590242 ===\nWhatsApp → Settings → Linked Devices → Link a device → scan:\n${ascii}\n(QR also saved to ${config.qrPath})\n`
  );
}

async function start() {
  await fs.mkdir(config.authDir, { recursive: true, mode: 0o700 });
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  const socket = makeWASocket({
    auth: state,
    logger: logger.child({ component: "baileys" }),
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  socket.ev.on("creds.update", saveCreds);
  socket.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) await writeQr(qr);
    if (connection === "open") {
      logger.info("WhatsApp connected; UiPath is the conversation runtime");
      await fs.rm(config.qrPath, { force: true });
    }
    if (connection === "close") {
      const status = lastDisconnect?.error?.output?.statusCode;
      if (status === DisconnectReason.loggedOut) {
        logger.error("WhatsApp logged out; remove the auth directory and pair again");
        return;
      }
      logger.warn({ status }, "WhatsApp disconnected; reconnecting");
      setTimeout(() => start().catch((error) => logger.error({ error }, "Reconnect failed")), 1500);
    }
  });

  socket.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const message of messages) {
      if (message.key?.fromMe || !message.message) continue;
      const inbound = extractInbound(message);
      if (!inbound.sender || !inbound.messageId || handled.has(inbound.messageId)) continue;
      handled.add(inbound.messageId);
      if (handled.size > 1000) handled.delete(handled.values().next().value);

      const jid = message.key.remoteJid;
      let typing = null;
      try {
        // Show "typing…" while the agent runs; WhatsApp clears it after ~10s, so refresh it.
        await socket.sendPresenceUpdate("composing", jid);
        typing = setInterval(() => { socket.sendPresenceUpdate("composing", jid).catch(() => {}); }, 8000);

        const result = await client.turn(inbound);

        clearInterval(typing); typing = null;
        await socket.sendPresenceUpdate("paused", jid);
        await socket.sendMessage(jid, { text: result.reply });
        logger.info({ sender: inbound.sender, caseStarted: result.caseStarted === true }, "UiPath turn completed");
      } catch (error) {
        if (typing) clearInterval(typing);
        await socket.sendPresenceUpdate("paused", jid).catch(() => {});
        logger.error({ error, sender: inbound.sender }, "UiPath turn failed");
        await socket.sendMessage(jid, {
          text: "SWIMS Connect is temporarily unavailable. Please try again shortly."
        });
      }
    }
  });
}

start().catch((error) => {
  logger.fatal({ error }, "WhatsApp gateway failed to start");
  process.exitCode = 1;
});
