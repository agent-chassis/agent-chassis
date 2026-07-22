import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import {
  validateWorkRecordDispatch,
  validateWorkRecordDispatchReport
} from "@agent-chassis/wiki-core";

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

test("strict wrapper accepts suppress_live_graph_resolution", async () => {
  const emptyRepo = await mkdtemp(path.join(tmpdir(), "slice017-strict-"));
  try {

    const readiness = await validateWorkRecordDispatch({
      dir: emptyRepo,
      unitAddress: "WK-0001",
      mode: "strict",
      suppress_live_graph_resolution: true
    });
    assert.equal(readiness.decision_code, "missing_json_record");
    assert.equal(readiness.dispatchable, false);
  } finally {
    await rm(emptyRepo, { recursive: true, force: true });
  }
});

test("strict wrapper rejects retired allow_graph_index_write as unknown", async () => {
  await assert.rejects(
    () =>
      validateWorkRecordDispatch({
        unitAddress: "WK-0001",
        allow_graph_index_write: false
      }),
    /validateWorkRecordDispatch does not accept option\(s\): allow_graph_index_write/
  );
});

test("SLICE-017 strict wrapper rejects suppress_live_graph_resolution in report-only mode", async () => {
  await assert.rejects(
    () =>
      validateWorkRecordDispatch({
        unitAddress: "WK-0001",
        mode: "report-only",
        suppress_live_graph_resolution: true
      }),
    /does not accept suppress_live_graph_resolution in report-only mode/
  );
});

test("SLICE-017 strict wrapper rejects an unknown option", async () => {
  await assert.rejects(
    () => validateWorkRecordDispatch({ unitAddress: "WK-0001", future_unknown_option: true }),
    /validateWorkRecordDispatch does not accept option\(s\): future_unknown_option/
  );
});

test("SLICE-017 report wrapper rejects the strict-only graph options", async () => {
  await assert.rejects(
    () => validateWorkRecordDispatchReport({ unitAddress: "WK-0001", suppress_live_graph_resolution: true }),
    /validateWorkRecordDispatchReport does not accept option\(s\): suppress_live_graph_resolution/
  );
  await assert.rejects(
    () => validateWorkRecordDispatchReport({ unitAddress: "WK-0001", allow_graph_index_write: false }),
    /validateWorkRecordDispatchReport does not accept option\(s\): allow_graph_index_write/
  );
});
