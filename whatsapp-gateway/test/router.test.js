import test from "node:test";
import assert from "node:assert/strict";
import { deterministicIntent, GREETING, isConsentReply } from "../src/router.js";

test("greetings use the exact menu without invoking an agent", () => {
  assert.equal(deterministicIntent("hi"), "greeting");
  assert.match(GREETING, /Report a case/);
});

test("case reads and scheduled reports are classified as worker-only", () => {
  assert.equal(deterministicIntent("check case status ABC123"), "worker_only");
  assert.equal(deterministicIntent("How many cases so far?"), "worker_only");
  assert.equal(deterministicIntent("schedule a high risk report"), "worker_only");
});

test("consent accepts clear yes/no and rejects unrelated responses", () => {
  assert.equal(isConsentReply("yes, you can"), true);
  assert.equal(isConsentReply("no"), false);
  assert.equal(isConsentReply("what do you mean?"), null);
});
