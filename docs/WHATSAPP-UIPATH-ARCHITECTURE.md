# WhatsApp to UiPath architecture

## Purpose

The WhatsApp number `+233256590242` is the public conversation channel for SWIMS Connect. A small Baileys adapter links the number through WhatsApp Linked Devices. The adapter forwards each inbound turn to an authenticated UiPath Orchestrator API trigger for the `WhatsAppConversation` Maestro Flow and sends the returned UiPath-agent reply back to WhatsApp.

Baileys is transport only. UiPath Automation Cloud owns conversation execution, agent tool calls, case creation decisions, Maestro orchestration, human tasks, SLAs, and auditability.

## Runtime flow

1. A person messages `+233256590242`.
2. `whatsapp-gateway` receives the message and normalizes the sender to E.164.
3. The gateway obtains a short-lived UiPath OAuth token using an External App stored only in environment variables.
4. The gateway POSTs the turn to the API trigger for the UiPath **WhatsAppConversation** Maestro Flow.
5. The Flow loads conversation state using the WhatsApp sender as the key and invokes `swims-connect-agent`.
6. The agent may ask intake questions, create an anonymous report, or return a secure worker-login link.
7. The workflow stores updated conversation state and returns the reply.
8. If the agent created a real SWIMS record, the workflow starts `SWIMSChildProtectionCase` with `swimsCaseId`, narrative, channel, reporter contact, follow-up consent, and risk.
9. The gateway sends the reply to WhatsApp.

## Why the case starts after conversation intake

Not every WhatsApp message is a child-protection case. Greetings, incomplete reports, case queries, authentication, and worker commands must remain conversational. Starting Maestro only after `swimsCaseId` exists prevents false and duplicate cases while preserving a real source-system identifier.

## UiPath request contract

```json
{
  "channel": "whatsapp",
  "sender": "+233000000000",
  "messageId": "WhatsApp message ID",
  "text": "message text",
  "messageType": "text",
  "receivedAt": "2026-06-23T00:00:00.000Z"
}
```

## UiPath response contract

```json
{
  "reply": "Agent response sent back to WhatsApp",
  "conversationId": "sender-scoped UiPath conversation ID",
  "swimsCaseId": null,
  "riskLevel": null,
  "caseStarted": false
}
```

## Authentication boundaries

- WhatsApp pairing credentials remain under `whatsapp-gateway/state/` and are gitignored.
- UiPath External App credentials remain in `.env` and are gitignored.
- SWIMS worker passwords are never sent to the WhatsApp agent. The agent returns a short-lived HTTPS login link.
- The login handler verifies credentials against SWIMS, encrypts the resulting session, and associates it with the WhatsApp sender.
- Anonymous reporting uses the restricted anonymous SWIMS service identity stored as UiPath Orchestrator assets.

## Hackathon alignment

The public channel adapter is an allowed external SDK integration. The working agent, tools, case orchestration, human decisions, and API workflow execute through UiPath Automation Cloud, keeping UiPath as the governance and orchestration layer required by AgentHack Track 1.
