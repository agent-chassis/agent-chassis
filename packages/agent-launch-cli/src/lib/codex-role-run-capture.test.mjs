import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { writeDirectLaunchProvenance } from "./codex-role-run-capture.mjs";

test("direct capture supplies runDir and preserves epoch fields and signal", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "agent-run-"));
  const finalPath = path.join(runDir, "response.md");
  const logPath = path.join(runDir, "stderr.log");
  const heartbeatPath = path.join(runDir, "heartbeat.log");
  await writeFile(finalPath, "done\n");
  await writeFile(logPath, "child\n");
  await writeDirectLaunchProvenance({
    runDir,
    repo: runDir,
    logPrefix: "codex-worker",
    role: "worker",
    subject: "WK-1",
    env: { AGENT_ROLE: "worker", AGENT_SUBJECT: "WK-1" },
    args: [],
    finalPath,
    logPath,
    provenanceInputs: { promptArgs: [] }
  }, {
    startedAt: "2026-08-24T00:00:00.000Z",
    startedAtEpoch: Date.parse("2026-08-24T00:00:00.000Z") / 1000,
    completedAt: "2026-08-24T00:00:01.000Z",
    completedAtEpoch: Date.parse("2026-08-24T00:00:01.000Z") / 1000,
    status: null,
    signal: "SIGTERM",
    childPid: 42,
    heartbeatPath,
    heartbeatTimeline: [],
    moduleDir: path.dirname(new URL(import.meta.url).pathname)
  });
  const envelope = JSON.parse(await readFile(path.join(runDir, "metadata/provenance.json"), "utf8"));
  assert.equal(envelope.cleanup.run_dir, runDir);
  assert.equal(envelope.runtime.started_at_epoch, 1787529600);
  assert.equal(envelope.runtime.completed_at_epoch, 1787529601);
  assert.equal(envelope.runtime.exit_status, null);
  assert.equal(envelope.runtime.signal, "SIGTERM");
});

test("direct capture preserves supplied epoch seconds for nonzero-millisecond ISO timestamps", async () => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "agent-run-"));
  const finalPath = path.join(runDir, "response.md");
  const logPath = path.join(runDir, "stderr.log");
  const heartbeatPath = path.join(runDir, "heartbeat.log");
  await writeFile(finalPath, "done\n");
  await writeFile(logPath, "child\n");
  const startedAtEpoch = 1787529600;
  const completedAtEpoch = 1787529601;
  await writeDirectLaunchProvenance({
    runDir,
    repo: runDir,
    logPrefix: "codex-worker",
    role: "worker",
    subject: "WK-1",
    env: { AGENT_ROLE: "worker", AGENT_SUBJECT: "WK-1" },
    args: [],
    finalPath,
    logPath,
    provenanceInputs: { promptArgs: [] }
  }, {
    startedAt: "2026-08-24T00:00:00.123Z",
    startedAtEpoch,
    completedAt: "2026-08-24T00:00:01.987Z",
    completedAtEpoch,
    status: 0,
    signal: null,
    childPid: 42,
    heartbeatPath,
    heartbeatTimeline: [],
    moduleDir: path.dirname(new URL(import.meta.url).pathname)
  });
  const envelope = JSON.parse(await readFile(path.join(runDir, "metadata/provenance.json"), "utf8"));
  assert.equal(envelope.runtime.started_at_epoch, startedAtEpoch);
  assert.equal(envelope.runtime.completed_at_epoch, completedAtEpoch);
});
