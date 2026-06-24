# Build issues and attachment checklist

## WhatsApp channel

- Status: revised to a repository-owned Baileys adapter feeding an authenticated UiPath Orchestrator API trigger.
- Linked number: `+233256590242` via WhatsApp Linked Devices QR pairing.
- Integration Service is not required for the hackathon path.
- The adapter is transport-only. Conversation execution, agent tool calls, and case orchestration run in UiPath Automation Cloud.
- Completed locally: Node.js adapter, turn-contract tests, `WhatsAppConversation` Maestro Flow scaffold, solution registration, and Flow schema validation.
- Remaining work: replace the Flow's three clearly labeled mock nodes with the deployed agent/state/case resources after registry read access is restored; publish the Flow; create its Orchestrator API trigger; configure OAuth; pair the number; run an end-to-end turn.

## Other placeholders

- Agent package `swims-connect-agent:0.1.2` is deployed, but its Maestro registry entity key is hidden by the same 401.
- Action Apps and the six API workflows still need deployment and resource IDs.
- Case Worker, CP Manager, and CP Administrator group UUIDs remain unresolved while directory/resource reads are unavailable.
