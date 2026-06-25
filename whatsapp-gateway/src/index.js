import fs from "node:fs/promises";
import path from "node:path";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState
} from "baileys";
import pino from "pino";
import QRCode from "qrcode";

import { loadConfig } from "./config.js";
import { LoginService } from "./auth-server.js";
import { attachMedia, analyzeMedia, downloadInboundMedia } from "./media.js";
import { extractInbound } from "./message.js";
import { SessionManager } from "./primero-client.js";
import { deterministicIntent, GREETING, isConsentReply } from "./router.js";
import { SessionStore } from "./session-store.js";
import { SenderStateStore } from "./state-store.js";
import { UiPathConversationClient } from "./uipath-client.js";

const config = loadConfig();
const logger = pino({ level: config.logLevel });
const stateStore = new SenderStateStore(config.stateDir);
const sessionStore = new SessionStore(config.stateDir, config.credentialKey);
const sessionManager = new SessionManager(config, sessionStore);
const loginService = new LoginService(config, sessionManager, logger);
const client = new UiPathConversationClient(config, logger, stateStore, sessionManager);
const handled = new Set();
const runtime = {
  loginServer: null,
  sockets: new Set(),
  keepAlive: null
};

process.on("beforeExit", (code) => logger.warn({ code }, "WhatsApp gateway event loop became empty"));
process.on("exit", (code) => logger.warn({ code }, "WhatsApp gateway process exiting"));
process.on("uncaughtException", (error) => {
  logger.fatal({ err: error, errorMessage: error?.message }, "Uncaught exception in WhatsApp gateway");
  process.exitCode = 1;
});
process.on("unhandledRejection", (error) => {
  logger.fatal({ err: error, errorMessage: error?.message }, "Unhandled rejection in WhatsApp gateway");
  process.exitCode = 1;
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    logger.warn({ signal }, "WhatsApp gateway received shutdown signal");
    process.exit(0);
  });
}

runtime.loginServer = loginService.start();
runtime.keepAlive = setInterval(() => {
  logger.debug({ sockets: runtime.sockets.size }, "WhatsApp gateway keepalive");
}, 60_000);

function shouldAttachMediaToNextCase(media, analysis, inbound) {
  if (media.kind === "audio") return analysis.concerning === true;
  if (media.kind === "image") return analysis.concerning === true || Boolean(inbound.text || media.caption);
  return Boolean(inbound.text || media.caption);
}

async function ensureLoginLinkForWorkerPrompt(sender, reply) {
  const text = String(reply || "");
  if (await sessionManager.worker(sender)) return text;
  const asksForLogin = /\b(sign(?:ed)?[- ]?in|log(?:ged)?[- ]?in|worker authentication|swims worker)\b/i.test(text);
  const alreadyHasLink = /\bhttps?:\/\/|wa\.me\//i.test(text);
  if (!asksForLogin || alreadyHasLink) return text;
  return `${text.trim()}\n\n${loginService.createLink(sender, "login")}`;
}

async function userFacingTurnError(sender, error) {
  const message = String(error?.message || error || "");
  if (/needs_login|worker authentication|signed-in SWIMS worker|NEEDS_LOGIN/i.test(message)) {
    return ensureLoginLinkForWorkerPrompt(sender, "To check case information, you need to be a signed-in SWIMS worker. Please sign in to continue.");
  }
  if (/timed out|timeout|UIPATH_TURN_TIMEOUT/i.test(message)) {
    return "SWIMS Connect did not receive a response from UiPath in time. Please try again. If this is about case information or reports, send “login” first.";
  }
  const safe = message
    .replace(/\s+/g, " ")
    .replace(/\/tmp\/\S+/g, "[agent path]")
    .slice(0, 180)
    .trim();
  return `SWIMS Connect hit an agent error while processing that message${safe ? `: ${safe}` : "."}\n\nPlease try again. If this is about case information or reports, send “login” first.`;
}

async function prepareTurn(socket, message, inbound) {
  const state = stateStore.get(inbound.sender);
  if (inbound.messageType === "text") return { inbound, state };

  const media = await downloadInboundMedia(message, inbound, socket, config, logger.child({ component: "media" }));
  const analysis = await analyzeMedia(config, media);
  const pending = state.pendingMedia || [];
  if (shouldAttachMediaToNextCase(media, analysis, inbound)) {
    state.pendingMedia = [...pending, { ...media, analysis, attachReason: "case-relevant-media" }].slice(-5);
  } else {
    state.pendingMedia = pending;
  }
  stateStore.save(inbound.sender, state);

  if (media.kind === "audio") {
    inbound.text = analysis.language === "english" && analysis.transcript
      ? `[WhatsApp voice note transcript]\n${analysis.transcript}`
      : `[Non-English or unclear WhatsApp voice note; transcript intentionally withheld. Child-protection concern detected: ${analysis.concerning ? "yes" : "no"}.]`;
    inbound.voiceLanguage = analysis.language;
    inbound.mediaConcerning = analysis.concerning;
    inbound.mediaUrgent = analysis.urgent;
  } else if (media.kind === "image") {
    inbound.text = [inbound.text, analysis.description ? `[Image description: ${analysis.description}]` : "", `[Image indicates a possible child-protection concern: ${analysis.concerning ? "yes" : "no"}.]`].filter(Boolean).join("\n");
    inbound.mediaConcerning = analysis.concerning;
    inbound.mediaUrgent = analysis.urgent;
  } else if (!inbound.text) {
    inbound.text = "A document was sent. Ask the sender how it relates to a child-protection concern.";
  }
  return { inbound, state };
}

async function routeTurn(socket, message, rawInbound) {
  const { inbound, state } = await prepareTurn(socket, message, rawInbound);
  const intent = deterministicIntent(inbound.text);
  if (intent === "greeting") return { reply: GREETING, caseStarted: false };
  if (intent === "logout") {
    sessionManager.logout(inbound.sender); stateStore.clear(inbound.sender);
    return { reply: "Your SWIMS account has been signed out and its saved login removed.", caseStarted: false };
  }
  if (intent === "login") return { reply: loginService.createLink(inbound.sender, inbound.text), caseStarted: false };
  if (intent === "worker_only" && !(await sessionManager.worker(inbound.sender))) {
    return { reply: `Case information and reports are available only to signed-in SWIMS workers.\n\n${loginService.createLink(inbound.sender, inbound.text)}`, caseStarted: false };
  }

  const consent = state.pendingConsent ? isConsentReply(inbound.text) : null;
  if (state.pendingConsent && consent === null) {
    return { reply: "Please answer yes or no: if we need more details about this report, may we contact you for follow-up?", caseStarted: false };
  }

  const result = await client.turn(inbound);
  result.reply = await ensureLoginLinkForWorkerPrompt(inbound.sender, result.reply);
  const updated = stateStore.get(inbound.sender);
  updated.pendingConsent = /is it OK to contact you for follow-up\?/i.test(result.reply);

  if (result.swimsCaseId) {
    const worker = await sessionManager.worker(inbound.sender);
    const session = worker || await sessionManager.anonymous();
    const failures = [];
    for (const media of updated.pendingMedia || []) {
      try { await attachMedia({ media, caseId: result.swimsCaseId, session, primero: sessionManager.client }); }
      catch (error) {
        failures.push(error.message);
        logger.error({ err: error, errorMessage: error.message, sender: inbound.sender, caseId: result.caseIdDisplay, mediaPath: media.path, mimeType: media.mimeType }, "Case media attachment failed");
      }
    }
    updated.pendingMedia = [];
    updated.pendingConsent = false;
    if (failures.length) result.reply += "\n\nThe case was saved, but I couldn't attach the media. Please resend it and quote the Case ID.";
  }
  stateStore.save(inbound.sender, updated);
  return result;
}

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
  runtime.sockets.add(socket);

  socket.ev.on("creds.update", saveCreds);
  socket.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) await writeQr(qr);
    if (connection === "open") {
      logger.info("WhatsApp connected; UiPath is the conversation runtime");
      await fs.rm(config.qrPath, { force: true });
    }
    if (connection === "close") {
      runtime.sockets.delete(socket);
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
    logger.info({ type, count: messages.length }, "WhatsApp messages upsert received");
    if (type !== "notify") return;
    for (const message of messages) {
      if (message.key?.fromMe || !message.message) continue;
      const inbound = extractInbound(message);
      if (!inbound.sender || !inbound.messageId || handled.has(inbound.messageId)) continue;
      logger.info({ sender: inbound.sender, messageId: inbound.messageId, messageType: inbound.messageType }, "WhatsApp inbound message accepted");
      handled.add(inbound.messageId);
      if (handled.size > 1000) handled.delete(handled.values().next().value);

      const jid = message.key.remoteJid;
      let typing = null;
      try {
        // Show "typing…" while the agent runs; WhatsApp clears it after ~10s, so refresh it.
        await socket.sendPresenceUpdate("composing", jid);
        typing = setInterval(() => { socket.sendPresenceUpdate("composing", jid).catch(() => {}); }, 8000);

        const result = await routeTurn(socket, message, inbound);

        clearInterval(typing); typing = null;
        await socket.sendPresenceUpdate("paused", jid);
        await socket.sendMessage(jid, { text: result.reply });
        logger.info({ sender: inbound.sender, caseStarted: result.caseStarted === true }, "UiPath turn completed");
      } catch (error) {
        if (typing) clearInterval(typing);
        await socket.sendPresenceUpdate("paused", jid).catch(() => {});
        logger.error({ err: error, errorMessage: error?.message, sender: inbound.sender }, "UiPath turn failed");
        await socket.sendMessage(jid, {
          text: await userFacingTurnError(inbound.sender, error)
        });
      }
    }
  });
}

start().catch((error) => {
  logger.fatal({ error }, "WhatsApp gateway failed to start");
  process.exitCode = 1;
});
