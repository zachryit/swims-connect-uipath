import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CaseMonitor } from "../src/case-monitor.js";
import { syncClosedCaseMonitor } from "../src/lifecycle-sync.js";
import { extractCaseFromToolOutput } from "../src/uipath-client.js";

const logger = {
  info() {},
  warn() {},
  error() {},
};

test("extracts confirmed closure metadata from a tool result", () => {
  assert.deepEqual(
    extractCaseFromToolOutput({
      ok: true,
      closed: true,
      status: "closed",
      case_id_display: "DEMO-104",
    }),
    {
      swimsCaseId: undefined,
      caseIdDisplay: "DEMO-104",
      closed: true,
      approvalRequested: false,
      status: "closed",
    },
  );
});

test("extracts both Primero UUID and display ID from a closure", () => {
  const result = extractCaseFromToolOutput({
    ok: true,
    closed: true,
    swims_case_id: "11111111-2222-3333-4444-555555555555",
    case_id_display: "DEMO-104",
  });
  assert.equal(result.swimsCaseId, "11111111-2222-3333-4444-555555555555");
  assert.equal(result.caseIdDisplay, "DEMO-104");
  assert.equal(result.closed, true);
});

test("does not treat a manager approval request as a closed case", () => {
  const result = extractCaseFromToolOutput({
    ok: true,
    closed: false,
    approval_requested: true,
    case_id_display: "DEMO-104",
  });
  assert.equal(result.closed, false);
  assert.equal(result.approvalRequested, true);
});

test("confirmed Primero closure cancels and removes its Maestro monitor", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "swims-monitor-"));
  const canceled = [];
  const maestro = {
    async startInstance() { return { instanceId: "instance-1" }; },
    async cancelInstance(instanceId, folderKey) {
      canceled.push({ instanceId, folderKey });
      return { ok: true };
    },
  };
  const monitor = new CaseMonitor(
    {
      stateDir,
      maestroMonitorEnabled: true,
      maestroReleaseKey: "release-1",
      maestroFolderKey: "folder-1",
      maestroPollMs: 60_000,
    },
    {
      logger,
      maestro,
      async workerActive() { return false; },
      async generate() { return "NONE"; },
      async send() {},
    },
  );

  await monitor.startForCase("DEMO-104", "+233000000000");
  const outcome = await syncClosedCaseMonitor(
    { caseClosed: true, closedCaseId: "DEMO-104" },
    monitor,
    logger,
  );

  assert.equal(outcome.ok, true);
  assert.deepEqual(canceled, [{ instanceId: "instance-1", folderKey: "folder-1" }]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(stateDir, "case-monitors.json"), "utf8")), {
    monitors: [],
  });
  fs.rmSync(stateDir, { recursive: true, force: true });
});

test("monitor startup materializes an empty durable state file", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "swims-monitor-start-"));
  const monitor = new CaseMonitor(
    {
      stateDir,
      maestroMonitorEnabled: true,
      maestroPollMs: 60_000,
    },
    {
      logger,
      maestro: {},
      async workerActive() { return false; },
      async generate() { return "NONE"; },
      async send() {},
    },
  );

  monitor.start();
  monitor.stop();
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(stateDir, "case-monitors.json"), "utf8")), {
    monitors: [],
  });
  fs.rmSync(stateDir, { recursive: true, force: true });
});

test("periodic reconciliation cancels a monitor when Primero reports CLOSED", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "swims-monitor-closed-"));
  const canceled = [];
  const maestro = {
    async startInstance() { return { instanceId: "instance-closed" }; },
    async jobState() { return { State: "Running" }; },
    async cancelInstance(instanceId, folderKey) {
      canceled.push({ instanceId, folderKey });
      return { ok: true };
    },
  };
  const monitor = new CaseMonitor(
    {
      stateDir,
      maestroMonitorEnabled: true,
      maestroReleaseKey: "release-1",
      maestroFolderKey: "folder-1",
      maestroPollMs: 60_000,
      maestroCheckIntervalMs: 1,
    },
    {
      logger,
      maestro,
      async workerActive() { return true; },
      async generate() { return "CLOSED"; },
      async send() { throw new Error("closed cases must not send an overdue message"); },
    },
  );

  await monitor.startForCase("DEMO-CLOSED", "+233000000000");
  await monitor.tick(new Date());

  assert.deepEqual(canceled, [{ instanceId: "instance-closed", folderKey: "folder-1" }]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(stateDir, "case-monitors.json"), "utf8")), {
    monitors: [],
  });
  fs.rmSync(stateDir, { recursive: true, force: true });
});
