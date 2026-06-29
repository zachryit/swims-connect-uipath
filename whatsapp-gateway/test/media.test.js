import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeMedia } from "../src/media.js";

function tempAudio() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swims-audio-"));
  const file = path.join(dir, "voice.mp3");
  fs.writeFileSync(file, Buffer.from("fake mp3 bytes"));
  return { dir, file };
}

function config(overrides = {}) {
  return {
    googleApiKey: "test-key",
    transcribeModel: "gemini-test",
    mediaAnalysisTimeoutMs: 50,
    audioAnalysisTimeoutMs: 50,
    mediaAnalysisRetries: 1,
    ...overrides
  };
}

test("voice analysis retries a transient abort and returns transcript", async () => {
  const { dir, file } = tempAudio();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new DOMException("This operation was aborted", "AbortError");
    return {
      ok: true,
      async json() {
        return {
          candidates: [{ content: { parts: [{ text: JSON.stringify({
            language: "english",
            transcript: "There is a child at risk.",
            childProtectionConcern: true,
            urgent: true
          }) }] } }]
        };
      }
    };
  };

  try {
    const result = await analyzeMedia(config(), { kind: "audio", path: file, mimeType: "audio/mpeg" });
    assert.equal(calls, 2);
    assert.equal(result.transcript, "There is a child at risk.");
    assert.equal(result.concerning, true);
    assert.equal(result.urgent, true);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("voice analysis accepts JSON with trailing model text", async () => {
  const { dir, file } = tempAudio();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        candidates: [{ content: { parts: [{ text: [
          "{",
          "\"language\":\"english\",",
          "\"transcript\":\"A child needs help near the market.\",",
          "\"childProtectionConcern\":true,",
          "\"urgent\":false",
          "}",
          "Note: transcript completed."
        ].join("\n") }] } }]
      };
    }
  });

  try {
    const result = await analyzeMedia(config(), { kind: "audio", path: file, mimeType: "audio/mpeg" });
    assert.equal(result.transcript, "A child needs help near the market.");
    assert.equal(result.concerning, true);
    assert.equal(result.urgent, false);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("voice analysis falls back gracefully after repeated transient aborts", async () => {
  const { dir, file } = tempAudio();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new DOMException("This operation was aborted", "AbortError");
  };

  try {
    const result = await analyzeMedia(config(), { kind: "audio", path: file, mimeType: "audio/mpeg" });
    assert.equal(calls, 2);
    assert.deepEqual(result, {
      language: "unknown",
      transcript: "",
      concerning: false,
      urgent: false,
      transientError: true
    });
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
