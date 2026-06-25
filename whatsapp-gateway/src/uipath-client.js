import { UiPath } from "@uipath/uipath-typescript/core";
import { ConversationalAgent, MessageRole } from "@uipath/uipath-typescript/conversational-agent";
import { mintBridgeToken, stripContextLines } from "./bridge.js";

function shortHash(value) {
  let hash = 0;
  for (const ch of String(value || "")) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  return Math.abs(hash).toString(36);
}

function normalizeTextPartData(data) {
  if (typeof data === "string") return data;
  if (data && typeof data === "object" && typeof data.inline === "string") return data.inline;
  if (data && typeof data === "object" && typeof data.value === "string") return data.value;
  return "";
}

function extractCaseFromToolOutput(output) {
  if (!output) return {};
  const candidates = [];
  if (typeof output === "string") {
    candidates.push(output);
    try { candidates.push(JSON.parse(output)); } catch {}
  } else {
    candidates.push(output);
  }
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const swimsCaseId = candidate.swims_case_id || candidate.swimsCaseId || candidate.id;
    const caseIdDisplay = candidate.case_id_display || candidate.caseIdDisplay || candidate.short_id;
    if (swimsCaseId || caseIdDisplay) return { swimsCaseId, caseIdDisplay };
  }
  return {};
}

function errorText(error) {
  if (!error) return "";
  return [
    error.message,
    error.errorId,
    error.details,
    error.stack,
    typeof error === "string" ? error : ""
  ].filter(Boolean).map(String).join("\n");
}

function needsLoginText() {
  return "To check case information, you need to be a signed-in SWIMS worker. Please sign in to continue.";
}

function releaseMarker(agent) {
  return {
    agentId: agent.id,
    folderId: agent.folderId,
    processVersion: agent.processVersion || agent.version || null,
    releaseKey: agent.key || agent.releaseKey || null
  };
}

function sameRelease(existing, agent) {
  if (!existing) return false;
  const marker = releaseMarker(agent);
  return existing.agentId === marker.agentId
    && existing.folderId === marker.folderId
    && existing.processVersion === marker.processVersion
    && existing.releaseKey === marker.releaseKey;
}

function agentError(text) {
  const value = String(text || "").trim();
  if (/needs_login|worker authentication/i.test(value)) {
    const error = new Error(needsLoginText());
    error.code = "NEEDS_LOGIN";
    return error;
  }
  const firstLine = value.split(/\r?\n/).find(Boolean) || "UiPath conversational agent error";
  return new Error(firstLine);
}

// Drives one WhatsApp conversation through UiPath's conversational-agent socket runtime.
export class UiPathConversationClient {
  constructor(config, logger, stateStore, sessionManager) {
    this.config = config;
    this.logger = logger;
    this.stateStore = stateStore;
    this.sessionManager = sessionManager;
    this.sdk = null;
    this.conversationalAgent = null;
    this.agentRelease = null;
    this.agentReleaseResolvedAt = 0;
    this.sessions = new Map();
    this.connectionCreatedAt = 0;
  }

  // A stale shared CAS connection surfaces as these. Safe to reset + retry: they fail BEFORE the
  // agent processes the turn (retrieve/dispatch stage), so retrying cannot double-create anything.
  #isConnectionError(error) {
    const m = String(error?.message || error || "");
    return /CLIENT_MESSAGE_DISPATCH_FAILED|retrieving Conversational Agent|did not become ready|socket|ECONNRESET|ETIMEDOUT|disconnect|not connected|connection (closed|lost|reset)/i.test(m);
  }

  // Tear down the cached SDK/agent/sessions so the next call builds a fresh connection.
  #resetConnection() {
    for (const runtime of this.sessions.values()) {
      try { runtime.conversation?.endSession?.(); } catch {}
    }
    this.sessions.clear();
    this.conversationalAgent = null;
    this.sdk = null;
    this.agentRelease = null;
    this.agentReleaseResolvedAt = 0;
    this.connectionCreatedAt = 0;
  }

  async turn(inbound) {
    if (!inbound.text) {
      return { reply: "Please send a text message describing your concern or request.", caseStarted: false };
    }
    const sender = inbound.sender;
    const state = this.stateStore.get(sender);
    const hist = state.history || [];
    // Strip any SWIMS_CTX marker a user might have TYPED (anti-spoofing) before we add our own.
    const cleanText = stripContextLines(inbound.text);
    hist.push({ role: "user", content: cleanText });

    const worker = await this.sessionManager.worker(sender);
    // Worker auth-context bridge: when this sender is a signed-in worker, prepend an opaque,
    // sender-bound, short-TTL token to the message. The agent's auth node exchanges it for the
    // worker's Primero session (the only channel that reaches a conversational agent is the
    // message text). Anonymous senders get no token -> agent stays anonymous.
    const token = (worker && this.config.bridgeSecret)
      ? mintBridgeToken(sender, this.config.bridgeSecret, this.config.bridgeTokenTtlMs)
      : null;
    inbound.agentText = token ? `[SWIMS_CTX ${token}]\n${cleanText}` : cleanText;
    const payload = {
      messages: hist,
      swims_session: worker ? { cookie: worker.cookie, csrf: worker.csrf } : null,
      swims_sender: sender,
      swims_message_id: inbound.messageId,
      swims_channel: inbound.channel || "whatsapp"
    };

    let result;
    try {
      result = await this.#invokeConversational(inbound, payload, worker);
    } catch (error) {
      // Self-heal a stale shared CAS connection: reset and retry once with a fresh connection.
      if (this.#isConnectionError(error)) {
        this.logger.warn({ err: error?.message, sender }, "UiPath conversational connection stale; resetting and retrying once");
        this.#resetConnection();
        result = await this.#invokeConversational(inbound, payload, worker);
      } else {
        throw error;
      }
    }

    if (result.error) throw new Error(result.error);
    // An empty turn is not an error — the agent occasionally completes an exchange without
    // emitting text. Don't show an alarming "couldn't process" message: confirm the case if one
    // was filed, otherwise ask the user to resend.
    let reply = (result.reply || "").trim();
    if (!reply) {
      reply = result.swimsCaseId
        ? `Thank you. Your report has been filed. The SWIMS Case ID is ${result.caseIdDisplay || result.swimsCaseId}. A caseworker will review it and follow up.`
        : "Sorry, I didn't quite catch that — please send it again.";
    }
    hist.push({ role: "assistant", content: reply });
    state.history = hist.slice(-this.config.historyTurns);
    this.stateStore.save(sender, state);
    return { ...result, reply, caseStarted: Boolean(result.swimsCaseId) };
  }

  async #ensureConversationalAgent() {
    // Proactively recycle a long-lived connection before its CAS socket/auth goes stale.
    if (this.conversationalAgent && this.connectionCreatedAt
        && (Date.now() - this.connectionCreatedAt) > this.config.connectionMaxAgeMs) {
      this.#resetConnection();
    }
    if (this.conversationalAgent) return this.conversationalAgent;
    if (!this.config.uipathBaseUrl || !this.config.uipathOrg || !this.config.uipathTenant || !this.config.uipathToken) {
      throw new Error("UiPath conversational SDK is not configured: set UIPATH_URL/UIPATH_ORG/UIPATH_TENANT and UIPATH_ACCESS_TOKEN");
    }
    this.sdk = new UiPath({
      baseUrl: this.config.uipathBaseUrl,
      orgName: this.config.uipathOrg,
      tenantName: this.config.uipathTenant,
      secret: this.config.uipathToken
    });
    await this.sdk.initialize();
    this.conversationalAgent = new ConversationalAgent(this.sdk, {
      surfaceName: this.config.uipathSurfaceName,
      surfaceVersion: this.config.uipathSurfaceVersion,
      externalUserId: "swims-connect-whatsapp"
    });
    this.conversationalAgent.onConnectionStatusChanged((status, error) => {
      this.logger.debug({ status, error: error?.message }, "UiPath conversational socket status changed");
    });
    this.connectionCreatedAt = Date.now();
    return this.conversationalAgent;
  }

  async #resolveAgentRelease() {
    if (this.agentRelease && (Date.now() - this.agentReleaseResolvedAt) < this.config.agentReleaseTtlMs) return this.agentRelease;
    const ca = await this.#ensureConversationalAgent();
    if (this.config.uipathAgentId && this.config.uipathFolderId) {
      this.agentRelease = await ca.getById(this.config.uipathAgentId, this.config.uipathFolderId);
      this.agentReleaseResolvedAt = Date.now();
      return this.agentRelease;
    }
    const agents = await ca.getAll(this.config.uipathFolderId || undefined);
    this.agentRelease = agents.find((agent) => {
      const haystack = [agent.name, agent.title, agent.displayName, agent.key].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(String(this.config.uipathAgentName || "").toLowerCase());
    }) || agents[0];
    if (!this.agentRelease) {
      throw new Error(`No UiPath conversational agent release is visible${this.config.uipathFolderId ? ` in folder ${this.config.uipathFolderId}` : ""}`);
    }
    this.logger.info({
      agentId: this.agentRelease.id,
      folderId: this.agentRelease.folderId,
      name: this.agentRelease.name || this.agentRelease.title || this.agentRelease.displayName,
      processVersion: this.agentRelease.processVersion || this.agentRelease.version,
      releaseKey: this.agentRelease.key || this.agentRelease.releaseKey
    }, "Resolved UiPath conversational agent release");
    this.agentReleaseResolvedAt = Date.now();
    return this.agentRelease;
  }

  #sessionKey(sender, worker) {
    return `${sender}:${worker ? shortHash(`${worker.cookie}:${worker.csrf}`) : "anonymous"}`;
  }

  async #getConversation(sender, payload, worker) {
    const key = this.#sessionKey(sender, worker);
    const state = this.stateStore.get(sender);
    const existing = state.uipathConversation;
    const freshEnough = existing?.updatedAt && (Date.now() - Date.parse(existing.updatedAt)) < this.config.conversationIdleTtlMs;
    const sameAuth = existing?.sessionKey === key;
    const ca = await this.#ensureConversationalAgent();
    const agent = await this.#resolveAgentRelease();

    if (existing?.id && sameAuth && freshEnough && sameRelease(existing, agent)) {
      try {
        const conversation = await ca.conversations.getById(existing.id);
        state.uipathConversation = { ...existing, updatedAt: new Date().toISOString() };
        this.stateStore.save(sender, state);
        return conversation;
      } catch (error) {
        this.logger.warn({ error: error.message, sender, conversationId: existing.id }, "Stored UiPath conversation is not resumable; creating a new one");
      }
    } else if (existing?.id && sameAuth && freshEnough) {
      this.logger.info({
        sender,
        conversationId: existing.id,
        existingAgentId: existing.agentId,
        existingFolderId: existing.folderId,
        existingProcessVersion: existing.processVersion,
        existingReleaseKey: existing.releaseKey,
        currentAgentId: agent.id,
        currentFolderId: agent.folderId,
        currentProcessVersion: agent.processVersion || agent.version,
        currentReleaseKey: agent.key || agent.releaseKey
      }, "Stored UiPath conversation was created for a different agent release; creating a new one");
    }

    const agentInput = {
      swims_sender: payload.swims_sender,
      swims_channel: payload.swims_channel
    };
    if (payload.swims_session) agentInput.swims_session = payload.swims_session;
    const conversation = await agent.conversations.create({
      label: `SWIMS WhatsApp ${sender}`,
      agentInput: {
        inline: agentInput
      }
    });
    state.uipathConversation = {
      id: conversation.id,
      ...releaseMarker(agent),
      sessionKey: key,
      updatedAt: new Date().toISOString()
    };
    this.stateStore.save(sender, state);
    return conversation;
  }

  async #getLiveSession(sender, payload, worker) {
    const key = this.#sessionKey(sender, worker);
    const agent = await this.#resolveAgentRelease();
    const cached = this.sessions.get(key);
    if (cached && !cached.session.ended && (Date.now() - cached.lastUsedAt) < this.config.conversationIdleTtlMs && sameRelease(cached.agentMarker, agent)) {
      cached.lastUsedAt = Date.now();
      await cached.ready;
      return cached;
    } else if (cached) {
      this.sessions.delete(key);
      try { cached.conversation.endSession(); } catch {}
    }

    const conversation = await this.#getConversation(sender, payload, worker);
    const session = conversation.startSession();
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("UiPath conversational session did not become ready")), 30000);
      session.onSessionStarted(() => {
        clearTimeout(timer);
        resolve();
      });
      session.onErrorStart((error) => {
        clearTimeout(timer);
        reject(agentError(errorText(error) || "UiPath conversational session error"));
      });
    });
    const runtime = { key, conversation, session, ready, agentMarker: releaseMarker(agent), lastUsedAt: Date.now() };
    this.sessions.set(key, runtime);
    return runtime;
  }

  async #invokeConversational(inbound, payload, worker) {
    const sender = inbound.sender;
    const runtime = await this.#getLiveSession(sender, payload, worker);
    await runtime.ready;
    runtime.lastUsedAt = Date.now();
    const { conversation, session } = runtime;
    const assistantParts = [];
    const toolCaseResults = [];
    const errors = [];

    return await new Promise((resolve, reject) => {
      let settled = false;
      const cleanupFns = [];
      const finish = (value, isError = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        for (const cleanup of cleanupFns) {
          try { cleanup(); } catch {}
        }
        if (isError) {
          this.sessions.delete(runtime.key);
          try { conversation.endSession(); } catch {}
        }
        if (isError) reject(value);
        else resolve(value);
      };
      const timer = setTimeout(() => {
        const error = new Error(`UiPath conversational turn timed out after ${this.config.turnTimeoutMs}ms`);
        error.code = "UIPATH_TURN_TIMEOUT";
        finish(error, true);
      }, this.config.turnTimeoutMs);

      const attachExchangeHandlers = (exchange) => {
        exchange.onMessageStart((message) => {
          message.onContentPartCompleted((part) => {
            if (!message.isAssistant) return;
            const text = normalizeTextPartData(part.data);
            if (text) assistantParts.push(text);
          });
          message.onToolCallCompleted((toolCall) => {
            if (!message.isAssistant) return;
            toolCaseResults.push(extractCaseFromToolOutput(toolCall.output));
          });
          message.onCompleted((completed) => {
            if (completed.role !== MessageRole.Assistant) return;
            for (const part of completed.contentParts || []) {
              const text = normalizeTextPartData(part.data);
              if (text && !assistantParts.includes(text)) assistantParts.push(text);
            }
            for (const toolCall of completed.toolCalls || []) {
              toolCaseResults.push(extractCaseFromToolOutput(toolCall.output));
            }
          });
        });
        exchange.onMessageCompleted((completed) => {
          if (completed.role !== MessageRole.Assistant) return;
          for (const part of completed.contentParts || []) {
            const text = normalizeTextPartData(part.data);
            if (text && !assistantParts.includes(text)) assistantParts.push(text);
          }
          for (const toolCall of completed.toolCalls || []) {
            toolCaseResults.push(extractCaseFromToolOutput(toolCall.output));
          }
        });
        exchange.onExchangeEnd(() => {
          const state = this.stateStore.get(sender);
          state.uipathConversation = {
            ...(state.uipathConversation || {}),
            id: conversation.id,
            ...(this.agentRelease ? releaseMarker(this.agentRelease) : {}),
            updatedAt: new Date().toISOString()
          };
          this.stateStore.save(sender, state);
          const caseResult = toolCaseResults.find((candidate) => candidate.swimsCaseId || candidate.caseIdDisplay) || {};
          finish({
            reply: assistantParts.join("").trim(),
            swimsCaseId: caseResult.swimsCaseId,
            caseIdDisplay: caseResult.caseIdDisplay,
            errors
          });
        });
      };

      cleanupFns.push(session.onErrorStart((error) => {
        const text = errorText(error) || "session error";
        errors.push(text);
        if (/needs_login|worker authentication/i.test(text)) {
          finish({ reply: needsLoginText(), needsLogin: true, errors });
        } else {
          finish(agentError(text), true);
        }
      }));
      cleanupFns.push(session.onExchangeStart((exchange) => {
        attachExchangeHandlers(exchange);
      }));
      (async () => {
        try {
          const exchange = session.startExchange();
          attachExchangeHandlers(exchange);
          exchange.onErrorStart((error) => {
            const text = errorText(error) || "exchange error";
            errors.push(text);
            if (/needs_login|worker authentication/i.test(text)) {
              finish({ reply: needsLoginText(), needsLogin: true, errors });
            } else {
              finish(agentError(text), true);
            }
          });
          await exchange.sendMessageWithContentPart({
            data: inbound.agentText || inbound.text,
            role: MessageRole.User,
            mimeType: "text/plain"
          });
        } catch (error) {
          finish(error, true);
        }
      })();
    });
  }
}
