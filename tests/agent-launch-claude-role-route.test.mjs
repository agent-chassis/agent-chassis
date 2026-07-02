import assert from "node:assert/strict";
import test from "node:test";

import { runReview } from "../packages/agent-launch-cli/src/commands/review.mjs";
import { runRedteam } from "../packages/agent-launch-cli/src/commands/redteam.mjs";

function createRecordingBackend(records) {
  return {
    async startLaunch(input) {
      records.startLaunch.push(input);
      return {
        accepted: true,
        caller_session_id: input.caller_session_id,
        monitor_handle: `wkmh_${records.startLaunch.length.toString().padStart(4, "0")}`
      };
    },
    async waitForRunStatus(input) {
      records.waitForRunStatus.push(input);
      return {
        accepted: true,
        caller_session_id: input.caller_session_id,
        monitor_handle: input.monitor_handle,
        terminal: true,
        timed_out: false,
        status: "succeeded",
        exit: { code: 0 }
      };
    }
  };
}

async function runWithResetExitCode(fn) {
  const savedExitCode = process.exitCode;
  try {
    process.exitCode = undefined;
    await fn();
  } finally {
    process.exitCode = savedExitCode;
  }
}

test("WK-0753 shared backend: Claude review live route uses the shared dispatch seam", async () => {
  const records = { startLaunch: [], waitForRunStatus: [] };
  const backend = createRecordingBackend(records);
  const io = { stdout: { write() {} }, stderr: { write() {} } };

  await runWithResetExitCode(async () => {
    await runReview(["WK-0001", "--app", "claude"], io, { backend });
  });

  assert.equal(records.startLaunch.length, 1);
  assert.equal(records.waitForRunStatus.length, 1);
  assert.deepEqual(records.startLaunch[0].app, "claude");
  assert.deepEqual(records.startLaunch[0].role, "reviewer");
  assert.deepEqual(records.startLaunch[0].subject, "WK-0001");
});

test("WK-0753 shared backend: Claude redteam live route uses the shared dispatch seam", async () => {
  const records = { startLaunch: [], waitForRunStatus: [] };
  const backend = createRecordingBackend(records);
  const io = { stdout: { write() {} }, stderr: { write() {} } };

  await runWithResetExitCode(async () => {
    await runRedteam(["WK-0001", "--app", "claude"], io, { backend });
  });

  assert.equal(records.startLaunch.length, 1);
  assert.equal(records.waitForRunStatus.length, 1);
  assert.deepEqual(records.startLaunch[0].app, "claude");
  assert.deepEqual(records.startLaunch[0].role, "redteam");
  assert.deepEqual(records.startLaunch[0].subject, "WK-0001");
});
