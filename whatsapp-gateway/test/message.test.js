import test from "node:test";
import assert from "node:assert/strict";
import { extractInbound, normalizeSender } from "../src/message.js";

test("normalizes a Baileys JID to E.164", () => {
  assert.equal(normalizeSender("233256590242@s.whatsapp.net"), "+233256590242");
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
  assert.equal(turn.text, "");
});
