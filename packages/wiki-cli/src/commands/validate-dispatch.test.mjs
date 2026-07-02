import assert from "node:assert/strict";
import test from "node:test";

import { runValidateDispatch } from "./validate-dispatch.mjs";

function createNonDispatchableStrictResult() {
  return {
    unit: {
      address: "WK-0001"
    },
    dispatchable: false,
    decision_code: "blocked_dependency",
    reasons: ["blocked_dependency"],
    validation_hints: ["repair the dependency chain before retrying"],
    clusters: [],
    blast_radius: {
      level: "none"
    }
  };
}

async function captureCommandRun(fn) {
  const previousExitCode = process.exitCode;
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => {
    lines.push(
      args
        .map((value) => (typeof value === "string" ? value : String(value)))
        .join(" ")
    );
  };

  let caughtError = null;
  let exitCode;
  try {
    exitCode = await fn();
  } catch (error) {
    caughtError = error;
  } finally {
    console.log = originalLog;
    process.exitCode = previousExitCode;
  }

  if (caughtError) {
    throw caughtError;
  }

  const output = lines.join("\n");
  return { exitCode, output };
}

test("validate-dispatch strict JSON keeps machine-readable output and exits nonzero for non-dispatchable units", async () => {
  const strictResult = createNonDispatchableStrictResult();
  const { exitCode, output } = await captureCommandRun(() =>
    runValidateDispatch(
      ["strict", "--unit", "WK-0001", "--json"],
      {
        validateWorkRecordDispatch: async () => strictResult
      }
    )
  );

  assert.equal(exitCode, 1);
  assert.deepEqual(JSON.parse(output), strictResult);
});

test("validate-dispatch report JSON stays non-launching for non-dispatchable units", async () => {
  const strictResult = createNonDispatchableStrictResult();
  const reportResult = {
    report_mode: true,
    readiness: strictResult
  };
  const { exitCode, output } = await captureCommandRun(() =>
    runValidateDispatch(
      ["report", "--unit", "WK-0001", "--json"],
      {
        validateWorkRecordDispatchReport: async () => reportResult
      }
    )
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(JSON.parse(output), reportResult);
});
