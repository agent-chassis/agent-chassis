

import { closeSync } from "node:fs";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { allocateTestRunArtifacts, openRunLogFile, TEST_RUN_METADATA_SCHEMA, writeRunMetadata } from "./test-run-artifacts.mjs";
import { encodeTestRunContext, TEST_RUN_CONTEXT_ENV } from "./test-run-context.mjs";
import { readSourceProvenance } from "./test-run-provenance.mjs";
import { describeTimingFailure, TEST_TIMING_CODES, timingFailure } from "./test-timing-diagnostics.mjs";
import { summarizeTestRun } from "./test-timing-summary.mjs";

const MAX_RECORDED_FAILURES = 64;

export async function beginTestRunRecording({ repoRoot, mode, options, selectedFiles, callerTempDir,
  currentRoots, output }) {
  const artifacts = await allocateTestRunArtifacts({ explicitBase: options.artifactsDir,
    defaultBase: callerTempDir, currentRoots });
  const failures = [];
  let failuresDropped = 0;
  const source = await readSourceProvenance(repoRoot);
  const metadata = {
    schema_version: TEST_RUN_METADATA_SCHEMA,
    run_id: artifacts.runId,
    status: "incomplete",
    started_at: new Date().toISOString(),
    parent: artifacts.parent,
    artifact_base: { path: artifacts.base, source: artifacts.baseSource },
    node_version: process.version,
    mode,
    diagnostic_kind: options.diagnosticKind,
    selected_files: selectedFiles.map((file) => path.relative(repoRoot, file) || file),
    runner_flags: options.flags,
    reporter_destinations: "user reporter destination files are not copied; see runner_flags",
    source,
    logs: { captured: ["stdout.log", "stderr.log"],
      note: "captured from the artifact notice onward; earlier runner lines reach stderr only" }
  };
  writeRunMetadata(artifacts.runDir, metadata);
  const logFds = [openRunLogFile(artifacts.runDir, "stdout.log"),
    openRunLogFile(artifacts.runDir, "stderr.log")];
  output.attachLogs({ stdoutLogFd: logFds[0], stderrLogFd: logFds[1] });

  function recordFailure(failure) {
    if (failures.length >= MAX_RECORDED_FAILURES) {
      failuresDropped += 1;
      return;
    }
    failures.push(describeTimingFailure(failure));
  }

  function recordingFailures() {
    return failuresDropped === 0 ? [...failures]
      : [...failures, { code: TEST_TIMING_CODES.TIMING_INCOMPLETE,
        message: `${failuresDropped} further recording failures were not itemized` }];
  }

  function finalize({ status, native }) {
    const summary = summarizeTestRun({ runDir: artifacts.runDir, runId: artifacts.runId,
      recordingFailures: recordingFailures() });
    try {
      writeFileSync(path.join(artifacts.runDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`,
        { mode: 0o600, flag: "wx" });
    } catch (error) {
      recordFailure(timingFailure(TEST_TIMING_CODES.ARTIFACT_WRITE_FAILED,
        `summary.json could not be written: ${error.message}`, { path: artifacts.runDir }));
    }
    writeFinal({ status, native, summary });
    return summary;
  }

  let final = null;

  function writeFinal({ status, native, summary }) {
    final = { status, native, summary };
    writeRunMetadata(artifacts.runDir, { ...metadata, status, native,
      finished_at: new Date().toISOString(),
      recording: { status: summary.recording.status === "complete" && failures.length === 0
        ? "complete" : "incomplete", failures: recordingFailures() },
      output: output.stats() });
  }

  function markOutputDrainExhausted(budgetMs) {
    recordFailure(timingFailure(TEST_TIMING_CODES.ARTIFACT_WRITE_FAILED,
      `final output did not drain within ${budgetMs}ms`, { output: output.stats() }));
    writeFinal({ status: final?.status ?? "incomplete", native: final?.native ?? null,
      summary: { recording: { status: "incomplete" } } });
  }

  function closeLogs() {
    for (const fd of logFds.splice(0)) {
      try { closeSync(fd); } catch (error) { recordFailure(error); }
    }
  }

  return Object.freeze({
    runId: artifacts.runId,
    runDir: artifacts.runDir,
    contextEnv: Object.freeze({ [TEST_RUN_CONTEXT_ENV]:
      encodeTestRunContext({ runId: artifacts.runId, runDir: artifacts.runDir }) }),
    recordFailure,
    recordingFailures,
    finalize,
    writeFinal,
    markOutputDrainExhausted,
    closeLogs
  });
}
