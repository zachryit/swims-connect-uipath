import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractInbound, normalizeSender } from "../src/message.js";

test("normalizes a Baileys JID to E.164", () => {
  assert.equal(normalizeSender("233256590242@s.whatsapp.net"), "+233256590242");
});

test("resolves WhatsApp LID senders to the mapped phone number", () => {
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), "swims-lid-"));
  fs.writeFileSync(path.join(authDir, "lid-mapping-15530652135456_reverse.json"), JSON.stringify("233243270000"));
  try {
    assert.equal(normalizeSender("15530652135456@lid", authDir), "+233243270000");
    const turn = extractInbound({
      key: { remoteJid: "15530652135456@lid", id: "abc" },
      message: { conversation: "Hi" }
    }, authDir);
    assert.equal(turn.sender, "+233243270000");
  } finally {
    fs.rmSync(authDir, { recursive: true, force: true });
  }
});

test("extracts a text turn without leaking Baileys objects", () => {
  const turn = extractInbound({
    key: { remoteJid: "233200000000@s.whatsapp.net", id: "abc" },
    messageTimestamp: 1782172800,
    message: { conversation: "I need to report a child protection concern" }
  });
  assert.equal(turn.sender, "+233200000000");
  assert.equal(turn.messageId, "abc");
  assert.equal(turn.messageType, "text");
  assert.equal(turn.text, "I need to report a child protection concern");
});

test("identifies voice notes for the UiPath media path", () => {
  const turn = extractInbound({
    key: { remoteJid: "233200000000@s.whatsapp.net", id: "voice-1" },
    message: { audioMessage: { mimetype: "audio/ogg; codecs=opus" } }
  });
  assert.equal(turn.messageType, "audio");
  assert.equal(turn.mimeType, "audio/ogg; codecs=opus");
  assert.equal(turn.text, "");
});
