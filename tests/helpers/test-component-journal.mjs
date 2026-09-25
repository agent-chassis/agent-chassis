

import { randomBytes } from "node:crypto";
import { writeFileSync, writeSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { openTimingJournal } from "./test-timing-journal.mjs";
import { TEST_RUN_COMPONENTS_DIR, readTestRunContext } from "./test-run-context.mjs";

export const COMPONENT_COVERAGE = Object.freeze({
  owners: Object.freeze([
    "git-test-fixture async repository Git",
    "sync owned Git runner (sync and async execution)",
    "git preparation measurement phases",
    "test-fixture allocation and disposal",
    "test-resource-scope disposal",
    "managed-test-process child lifetime",
    "measureComponentPhase explicit phases"
  ]),
  unmeasured: Object.freeze([
    "test body internals outside these owners",
    "production subprocesses and Git spawned by code under test",
    "native per-test time split into setup/body/cleanup (native duration is inclusive)"
  ])
});

export function createComponentJournal({ runId, runDir, kind = "process",
  entryFile = process.argv[1] ? path.resolve(process.argv[1]) : null,
  clock = () => performance.now() }) {
  const producerId = `${kind}-${process.pid}-${randomBytes(6).toString("hex")}`;
  const journalPath = path.join(runDir, TEST_RUN_COMPONENTS_DIR, `${producerId}.jsonl`);
  const journal = openTimingJournal(journalPath, { runId, producerId, clock });
  let spanSequence = 0;
  let failureReported = false;

  function reportFailure() {
    if (failureReported || journal.failure === null) return;
    failureReported = true;
    const failure = { code: journal.failure.code, message: journal.failure.message,
      producer_id: producerId, journal: journalPath };
    try {
      writeFileSync(`${journalPath}.failed.json`, `${JSON.stringify(failure)}\n`, { mode: 0o600, flag: "wx" });
    } catch {

    }
    try {
      writeSync(2, `[test-components] ${failure.code}: ${failure.message}\n`);
    } catch {

    }
  }

  function record(fields) {
    const failure = journal.append(fields);
    if (failure !== null) reportFailure();
    return failure === null;
  }

  record({ event: "producer_start", pid: process.pid, entry_file: entryFile,
    node_version: process.version, coverage: COMPONENT_COVERAGE });

  function startSpan({ owner, kind: spanKind, label, fixtureInstance = null, parentSpanId = null,
    test = null }) {
    spanSequence += 1;
    const spanId = `s${spanSequence}`;
    const startedAt = clock();
    const attribution = typeof test?.fullName === "string" ? { test: test.fullName }
      : typeof test?.name === "string" ? { test: test.name } : "unattributed";
    record({ event: "span_start", span_id: spanId, owner, kind: spanKind,
      label: String(label ?? "").slice(0, 512), fixture_instance: fixtureInstance,
      parent_span_id: parentSpanId, attribution });
    let ended = false;
    return Object.freeze({
      id: spanId,
      end(outcome, error = null) {
        if (ended) return;
        ended = true;
        const elapsed = clock() - startedAt;
        record({ event: "span_end", span_id: spanId, outcome: outcome === "ok" ? "ok" : "failed",
          elapsed_ms: Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null,
          error_code: error === null ? null
            : typeof error?.code === "string" ? error.code : error?.name ?? "Error" });
      }
    });
  }

  return Object.freeze({ producerId, path: journalPath, record, startSpan,
    get failure() { return journal.failure; } });
}

let processJournal;

export function componentJournal() {
  if (processJournal !== undefined) return processJournal;
  const found = readTestRunContext();
  processJournal = found?.context
    ? createComponentJournal({ runId: found.context.runId, runDir: found.context.runDir })
    : null;
  return processJournal;
}

const INERT_SPAN = Object.freeze({ id: null, end() {} });

export function startComponentSpan(options) {
  try {
    return componentJournal()?.startSpan(options) ?? INERT_SPAN;
  } catch {
    return INERT_SPAN;
  }
}

export function recordComponentEvent(fields) {
  try {
    componentJournal()?.record(fields);
  } catch {

  }
}

function isThenable(value) {
  return value !== null && (typeof value === "object" || typeof value === "function") &&
    typeof value.then === "function";
}

export function measureComponentPhase(label, operation, { owner = "phase", test = null,
  fixtureInstance = null, parentSpanId = null } = {}) {
  const span = startComponentSpan({ owner, kind: "phase", label, test, fixtureInstance, parentSpanId });
  let result;
  try {
    result = operation(span);
  } catch (error) {
    span.end("failed", error);
    throw error;
  }
  if (!isThenable(result)) {
    span.end("ok");
    return result;
  }
  return Promise.resolve(result).then((value) => {
    span.end("ok");
    return value;
  }, (error) => {
    span.end("failed", error);
    throw error;
  });
}
