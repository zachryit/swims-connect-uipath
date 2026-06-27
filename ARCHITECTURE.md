# SWIMS-Connect on UiPath — Architecture

SWIMS-Connect is a child-protection reporting and casework system built with UiPath and integrated
with Primero. The design has two entry paths: anonymous community intake and authenticated worker
casework. Both use the same UiPath conversational agent, while Primero remains the system of record.

## Live architecture

```text
 Community reporter                         Social worker
 (no SWIMS login)                           (secure SWIMS login)
          │                                         │
          └──────── text / voice / image ───────────┘
                            │
                            ▼
                 WhatsApp channel adapter
                  ├─ deterministic consent/auth gates
                  ├─ media download and attachment
                  └─ sender-bound worker context
                            │
                 UiPath TypeScript SDK
                            │
                            ▼
              UiPath Automation Cloud
        ┌───────────────────────────────────┐
        │ Conversational coded agent        │
        │ Python · LangGraph · Gemini       │
        │                                   │
        │ • intake and field extraction     │
        │ • case lookup and summaries       │
        │ • assessment/case-plan drafts     │
        │ • referrals and follow-up         │
        │ • caseload reports                │
        └───────────────┬───────────────────┘
                        │ authenticated REST
                        ▼
              Primero / SWIMS API v2
              • case system of record
              • roles and permissions
              • workflow and audit data

        ┌───────────────────────────────────┐
        │ UiPath Maestro Case               │
        │ per-case deadline monitor         │
        │ assessment · plan · referral ·    │
        │ follow-up · closure review        │
        └───────────────┬───────────────────┘
                        │ verified reminder
                        ▼
                  Case owner on WhatsApp
```

## UiPath responsibilities

| Component | Responsibility |
|---|---|
| **Conversational coded agent** | Understands intake, calls typed case tools, prepares worker drafts, and generates reports |
| **UiPath TypeScript SDK** | Maintains conversational sessions between WhatsApp and the deployed agent |
| **UiPath Orchestrator** | Stores runtime assets and secrets and manages packages, releases, jobs, and traces |
| **UiPath Maestro Case** | Maintains one deadline-monitoring instance per eligible SWIMS case |

The WhatsApp service is a channel adapter. It handles channel-specific concerns—message parsing,
login links, consent routing, and media transport—but does not become a second case-management
system.

## Identity and trust boundaries

### Anonymous community intake

An anonymous reporter can submit a concern after answering the follow-up-consent question. Case
creation uses a restricted intake account. Anonymous users cannot list cases, read case details,
generate reports, or perform lifecycle updates.

### Authenticated worker casework

1. The worker requests a login link in WhatsApp.
2. The gateway creates a one-time, sender-bound HTTPS link.
3. The worker signs in directly against Primero.
4. For each later message, the gateway adds a short-lived HMAC-signed context token.
5. The agent exchanges the token for the worker session and removes it before model processing.
6. Case tools act as that worker, allowing Primero to enforce the worker's actual role.

No Primero password or session cookie is placed in the model context.

## Controlled writes

The language model does not invent identifiers or write arbitrary payloads. It calls typed tools
which validate inputs and return the Case ID supplied by Primero. Community intake has a mandatory
consent gate. Worker assessment, case-plan, and referral actions use a **read → draft → review →
accept** pattern; the tool writes only after explicit worker approval.


## Maestro deadline monitoring

`SWIMSChildProtectionCase/` is a deployed UiPath Maestro Case used as a durable deadline monitor.
One instance represents one eligible SWIMS case and tracks five clocks:

- assessment;
- case plan;
- service referral;
- follow-up; and
- closure review.

Before notifying the owner, the gateway checks live Primero data to confirm that the step remains
outstanding and its exact due date has passed. Notifications are rate-limited to avoid repeated
alerts.

## Data and deployment

- Primero is authoritative for cases, workflow state, role-based permissions, and audit data.
- Orchestrator assets hold the Gemini key, Primero connection settings, and bridge configuration.
- Gitignored local environment files are used only for development and administration.
- Relevant source media can be attached to the resulting Primero case by an authorised account.
- Agent traces and gateway logs must be protected according to the deployment's retention policy.

For runtime details, see
[docs/WHATSAPP-UIPATH-ARCHITECTURE.md](docs/WHATSAPP-UIPATH-ARCHITECTURE.md). For deployment and
testing, see [README.md](README.md) and [IMPLEMENTATION-GUIDE.md](IMPLEMENTATION-GUIDE.md).
