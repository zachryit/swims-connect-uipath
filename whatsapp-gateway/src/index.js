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
import { ReportScheduler } from "./scheduler.js";
import { MaestroClient } from "./maestro-client.js";
import { CaseMonitor } from "./case-monitor.js";
import { syncClosedCaseMonitor } from "./lifecycle-sync.js";

const config = loadConfig();
const logger = pino({ level: config.logLevel });
const stateStore = new SenderStateStore(config.stateDir);
const sessionStore = new SessionStore(config.stateDir, config.credentialKey);
const sessionManager = new SessionManager(config, sessionStore);
const loginService = new LoginService(config, sessionManager, logger);
const client = new UiPathConversationClient(config, logger, stateStore, sessionManager);

// Scheduled reports: a per-minute runner generates due reports by DRIVING THE AGENT (so the same
// run_report tool serves on-demand and scheduled), then sends them to WhatsApp.
let currentSocket = null;
const jidFromSender = (sender) => `${String(sender).replace(/\D/g, "")}@s.whatsapp.net`;
// Shared deps for the agent-driven background runners (scheduled reports + overdue case monitor):
// both DRIVE THE AGENT to do Primero work and push results to WhatsApp.
const workerActive = async (sender) => Boolean(await sessionManager.worker(sender));
const generateTurn = async (sender, text) => {
  const result = await client.turn({ sender, text, messageId: `auto-${Date.now()}`, channel: "whatsapp", messageType: "text" });
  return result?.reply || null;
};
const sendText = async (sender, text) => {
  if (!currentSocket) throw new Error("WhatsApp socket not connected");
  await currentSocket.sendMessage(jidFromSender(sender), { text });
};
const scheduler = new ReportScheduler(config, {
  logger: logger.child({ component: "scheduler" }),
  workerActive, generate: generateTurn, send: sendText,
});
loginService.scheduler = scheduler;
// Maestro Case overdue monitor (disabled until the case is deployed + keys set in config).
const maestro = new MaestroClient(config, logger.child({ component: "maestro" }));
const caseMonitor = new CaseMonitor(config, {
  logger: logger.child({ component: "case-monitor" }),
  workerActive, generate: generateTurn, send: sendText, maestro,
});
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
  // If the reply tells the user to sign in, it MUST carry a login link — always. (We used to
  // skip this when sessionManager.worker(sender) looked truthy, but a stale/half-valid saved
  // session made the gateway think the user was logged in while the agent still asked them to
  // sign in → "please sign in" with no link and no way forward. The ask-to-sign-in text is the
  // signal that a link is needed, regardless of any saved session.)
  const asksForLogin = /\b(sign(?:ed)?[- ]?in|log(?:ged)?[- ]?in|worker authentication|swims worker|registered swims worker)\b/i.test(text);
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
    return "Sorry, that took longer than expected and didn't go through. Please send it again.";
  }
  // Never surface raw technical details (agent/folder keys, error codes, stack traces) to users.
  // The full error is logged server-side for debugging; users get a calm, friendly message.
  return "Sorry, something went wrong on my side and I couldn't process that just now. Please try again in a moment.";
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
    inbound.text = analysis.transientError
      ? "A WhatsApp voice note was received, but automatic transcription timed out. Apologize and ask the sender to type the report or send a shorter, clearer voice note."
      : analysis.language === "english" && analysis.transcript
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
    // Attach media as an account that can WRITE the case. A logged-in reporter-worker owns
    // their own cases; anonymous reports are owned_by the default-owner worker, so attach as
    // that worker (the anon service account loses access once ownership is routed away → 403).
    const worker = await sessionManager.worker(inbound.sender);
    const session = worker || await sessionManager.defaultOwner() || await sessionManager.anonymous();
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
    // A signed-in worker filed this case → start its Maestro overdue-monitor instance.
    // No-op until the case is deployed + process/folder keys are configured. Anonymous reports
    // have no WhatsApp owner to nudge, so they are intentionally skipped.
    if (worker) {
      caseMonitor.startForCase(result.swimsCaseId, inbound.sender)
        .catch((error) => logger.error({ err: error?.message, caseId: result.swimsCaseId }, "Failed to start Maestro case monitor"));
    }
  }
  // Only a tool result with closed=true reaches this path. A worker's closure-approval request
  // keeps its monitor alive until an authorised manager actually closes the Primero case.
  await syncClosedCaseMonitor(result, caseMonitor, logger.child({ component: "case-monitor" }));
  stateStore.save(inbound.sender, updated);
  return result;
}

async function writeQr(qr) {
  await fs.mkdir(path.dirname(config.qrPath), { recursive: true, mode: 0o700 });
  await QRCode.toFile(config.qrPath, qr, { width: 512, margin: 2 });
  const ascii = await QRCode.toString(qr, { type: "terminal", small: true });
  process.stdout.write(
    `\n=== Pair WhatsApp +${config.whatsappBotNumber} ===\nWhatsApp → Settings → Linked Devices → Link a device → scan:\n${ascii}\n(QR also saved to ${config.qrPath})\n`
  );
}

// Request + print a WhatsApp pairing CODE for the configured number (number-driven linking).
// Retries a few times because the socket may not be ready the instant we ask.
let pairingRequested = false;
let pairingAttempts = 0;
// Re-pair safety. A genuine logout wipes auth and re-pairs, and a lapsed pairing re-issues a code —
// but if nobody enters a code we must NOT spin forever: each cycle burns a pairing code, and
// hammering WhatsApp can get the number rate-limited (this loop once emitted 182 codes in ~10h).
// Bound the unattended cycles, back off between them, and reset on a successful "open".
// `activeSocket` lets retry timers left over from a closed socket no-op instead of firing blind.
let repairCycles = 0;
let activeSocket = null;
const MAX_REPAIR_CYCLES = 8;
async function requestPairing(socket) {
  if (pairingRequested || socket !== activeSocket) return;
  try {
    const code = await socket.requestPairingCode(config.whatsappBotNumber);
    pairingRequested = true;
    const pretty = code?.match(/.{1,4}/g)?.join("-") || code;
    process.stdout.write(
      `\n=== Link WhatsApp +${config.whatsappBotNumber} ===\n` +
      `On that phone: WhatsApp → Settings → Linked Devices → Link a device →\n` +
      `"Link with phone number instead" → enter this code:\n\n    ${pretty}\n\n` +
      `(Code expires in ~60s; the gateway will request a new one if it lapses.)\n`
    );
    logger.info({ number: config.whatsappBotNumber, code: pretty }, "WhatsApp pairing code issued");
  } catch (error) {
    pairingAttempts += 1;
    logger.warn({ err: error?.message, attempt: pairingAttempts }, "Pairing-code request not ready; retrying");
    if (pairingAttempts < 6) setTimeout(() => requestPairing(socket), 3000);
    else logger.error("Pairing-code retries exhausted; restart the gateway or set WHATSAPP_USE_PAIRING_CODE=false for QR");
  }
}

async function start() {
  await fs.mkdir(config.authDir, { recursive: true, mode: 0o700 });
  let { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  // Env-driven (re)linking: if the saved session belongs to a DIFFERENT number than
  // WHATSAPP_BOT_NUMBER, wipe it so we pair the configured number fresh. Change the env + restart
  // to switch numbers.
  const linkedDigits = String(state.creds?.me?.id || "").split(":")[0].replace(/\D/g, "");
  if (config.whatsappBotNumber && linkedDigits && linkedDigits !== config.whatsappBotNumber) {
    logger.warn({ linked: linkedDigits, configured: config.whatsappBotNumber }, "Configured WhatsApp number changed — clearing old session to re-link");
    await fs.rm(config.authDir, { recursive: true, force: true });
    await fs.mkdir(config.authDir, { recursive: true, mode: 0o700 });
    ({ state, saveCreds } = await useMultiFileAuthState(config.authDir));
    pairingRequested = false;
  }
  const socket = makeWASocket({
    auth: state,
    logger: logger.child({ component: "baileys" }),
    markOnlineOnConnect: false,
    syncFullHistory: false
  });
  runtime.sockets.add(socket);
  activeSocket = socket;
  pairingAttempts = 0;

  // Not linked yet → number-driven pairing code (unless QR mode is forced).
  if (config.whatsappUsePairingCode && config.whatsappBotNumber && !state.creds.registered) {
    setTimeout(() => requestPairing(socket), 3000);
  }

  socket.ev.on("creds.update", saveCreds);
  socket.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    // Show a QR only when pairing-code mode is off (or after a pairing-code failure).
    if (qr && (!config.whatsappUsePairingCode || !pairingRequested)) await writeQr(qr);
    if (connection === "open") {
      logger.info("WhatsApp connected; UiPath is the conversation runtime");
      repairCycles = 0;
      await fs.rm(config.qrPath, { force: true });
      currentSocket = socket;
      scheduler.start();
      caseMonitor.start();
    }
    if (connection === "close") {
      runtime.sockets.delete(socket);
      if (socket === activeSocket) activeSocket = null;
      const status = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = status === DisconnectReason.loggedOut;

      // A registered (working) session hit a transient drop — timeout/restart-required/conflict.
      // Reconnect promptly; this is not a pairing failure, so it doesn't count toward the cap.
      if (!loggedOut && state.creds.registered) {
        logger.warn({ status }, "WhatsApp disconnected; reconnecting");
        setTimeout(() => start().catch((error) => logger.error({ error }, "Reconnect failed")), 1500);
        return;
      }

      // Otherwise we must (re)pair: WhatsApp logged us out (dead session → wipe it), or a pairing
      // attempt lapsed before anyone entered the code (re-issue one). Bound the unattended cycles
      // with backoff so we never spam WhatsApp with codes nobody is entering.
      repairCycles += 1;
      if (repairCycles > MAX_REPAIR_CYCLES) {
        logger.error(
          { repairCycles, status },
          `WhatsApp pairing failed ${MAX_REPAIR_CYCLES}× with no code entered — stopping to avoid spamming WhatsApp. ` +
          `Link +${config.whatsappBotNumber} on the phone (Linked Devices → Link a device → "Link with phone number instead"), then restart the gateway.`
        );
        return;
      }
      const delay = Math.min(5000 * 2 ** (repairCycles - 1), 300000);
      logger.warn(
        { repairCycles, status, delayMs: delay },
        loggedOut
          ? "WhatsApp logged out (unlinked/device removed) — clearing session and re-pairing"
          : "WhatsApp pairing lapsed before the code was entered — re-issuing a code"
      );
      pairingRequested = false; // allow the next start() to issue a fresh code
      if (loggedOut) await fs.rm(config.authDir, { recursive: true, force: true }).catch(() => {});
      setTimeout(() => start().catch((error) => logger.error({ error }, "Re-pair restart failed")), delay);
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
