

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { readTimingJournal } from "./test-timing-journal.mjs";
import { TEST_RUN_COMPONENTS_DIR, TEST_RUN_EVENTS_FILE } from "./test-run-context.mjs";

export const TEST_RUN_SUMMARY_SCHEMA = "test-run-summary.v1";
export const SLOWEST_LIMIT = 20;
const UNFINISHED_LIMIT = 50;

function createTopK(limit) {
  const rows = [];
  return Object.freeze({
    offer(row) {
      if (!Number.isFinite(row.duration_ms)) return;
      if (rows.length === limit && row.duration_ms <= rows[rows.length - 1].duration_ms) return;
      rows.push(row);
      rows.sort((left, right) => right.duration_ms - left.duration_ms);
      if (rows.length > limit) rows.pop();
    },
    rows: () => rows.map((row) => ({ ...row }))
  });
}

function boundedList(limit) {
  const items = [];
  let count = 0;
  return Object.freeze({
    push(item) { count += 1; if (items.length < limit) items.push(item); },
    toJSON: () => ({ count, items })
  });
}

function identityKey(identity) {
  return JSON.stringify(identity);
}

function journalProblem(result) {
  if (!result.readable) return { journal: path.basename(result.path), error: result.error };
  if (result.errors.length === 0 && result.trailing === null) return null;
  return { journal: path.basename(result.path), errors: result.errors.slice(0, 20),
    error_count: result.errors.length, trailing: result.trailing };
}

function summarizeNative(runDir, runId) {
  const active = new Map();
  const counts = { files: 0, suites: 0, tests: 0, pass: 0, fail: 0, skip: 0, todo: 0,
    identity_incomplete: 0 };
  const slowest = { tests: createTopK(SLOWEST_LIMIT), suites: createTopK(SLOWEST_LIMIT),
    files: createTopK(SLOWEST_LIMIT) };
  let streamStart = false;
  let streamEnd = false;
  const eventsPath = path.join(runDir, TEST_RUN_EVENTS_FILE);
  if (!existsSync(eventsPath)) {
    return { present: false, complete: false, counts, unfinished: boundedList(0).toJSON(),
      slowest: { tests: [], suites: [], files: [] }, problem: null };
  }
  const result = readTimingJournal(eventsPath, {
    expectedRunId: runId,
    onRecord: (record) => {
      if (record.event === "stream_start") streamStart = true;
      else if (record.event === "stream_end") streamEnd = true;
      else if (record.event === "start") {
        active.set(identityKey(record.identity), { name: record.name, kind: record.kind,
          identity: record.identity, source: record.source });
      } else if (record.event === "complete") {
        active.delete(identityKey(record.identity));
        if (!record.identity_complete) counts.identity_incomplete += 1;
        const bucket = record.kind === "file" ? "files" : record.kind === "suite" ? "suites" : "tests";
        counts[bucket] += 1;
        if (bucket === "tests") {
          if (record.skip) counts.skip += 1;
          else if (record.todo) counts.todo += 1;
          else counts[record.outcome === "pass" ? "pass" : "fail"] += 1;
        }
        slowest[bucket].offer({ name: record.name, duration_ms: record.duration_ms,
          outcome: record.outcome, file: record.identity.entry_file ?? record.identity.file ?? null,
          source: record.source });
      }
    }
  });
  const unfinished = boundedList(UNFINISHED_LIMIT);
  for (const item of active.values()) unfinished.push(item);
  const problem = journalProblem(result);
  return {
    present: true,
    complete: problem === null && streamStart && streamEnd && active.size === 0 &&
      counts.identity_incomplete === 0,
    stream_start: streamStart,
    stream_end: streamEnd,
    counts,
    unfinished: unfinished.toJSON(),
    slowest: { tests: slowest.tests.rows(), suites: slowest.suites.rows(), files: slowest.files.rows() },
    problem
  };
}

function summarizeComponents(runDir, runId) {
  const directory = path.join(runDir, TEST_RUN_COMPONENTS_DIR);
  const names = existsSync(directory) ? readdirSync(directory).sort() : [];
  const slowestSpans = createTopK(SLOWEST_LIMIT);
  const problems = [];
  const failureMarkers = names.filter((name) => name.endsWith(".failed.json"));
  const unfinished = boundedList(UNFINISHED_LIMIT);
  const git = { commands: 0, ok: 0, nonzero: 0, fault: 0, elapsed_ms: 0, unreconciled_producers: [] };
  let producers = 0;
  let spans = 0;
  let unattributed = 0;
  let coverage = null;
  for (const name of names.filter((entry) => entry.endsWith(".jsonl"))) {
    producers += 1;
    const open = new Map();
    const producerGit = { commands: 0, elapsed_ms: 0, last_totals: null };
    let entryFile = null;
    const result = readTimingJournal(path.join(directory, name), {
      expectedRunId: runId,
      onRecord: (record) => {
        if (record.event === "producer_start") {
          entryFile = record.entry_file;
          coverage ??= record.coverage;
        } else if (record.event === "span_start") {
          open.set(record.span_id, record);
          if (record.attribution === "unattributed") unattributed += 1;
        } else if (record.event === "span_end") {
          const started = open.get(record.span_id);
          open.delete(record.span_id);
          spans += 1;
          slowestSpans.offer({ owner: started?.owner ?? null, kind: started?.kind ?? null,
            label: started?.label ?? null, outcome: record.outcome, duration_ms: record.elapsed_ms,
            producer: record.producer_id, entry_file: entryFile, attribution: started?.attribution ?? null });
        } else if (record.event === "git_command") {
          git.commands += 1;
          git[record.outcome] = (git[record.outcome] ?? 0) + 1;
          if (Number.isFinite(record.elapsed_ms)) git.elapsed_ms += record.elapsed_ms;
          producerGit.commands += 1;
          producerGit.last_totals = record.process_totals;
        }
      }
    });
    for (const span of open.values()) {
      unfinished.push({ producer: span.producer_id, entry_file: entryFile, owner: span.owner,
        kind: span.kind, label: span.label });
    }

    if (producerGit.last_totals !== null && producerGit.last_totals.commands !== producerGit.commands) {
      git.unreconciled_producers.push({ journal: name, events: producerGit.commands,
        aggregate: producerGit.last_totals.commands });
    }
    const problem = journalProblem(result);
    if (problem !== null) problems.push(problem);
  }
  return {
    producers,
    spans,
    unattributed_spans: unattributed,
    unfinished_spans: unfinished.toJSON(),
    git,
    slowest_spans: slowestSpans.rows(),
    coverage,
    failure_markers: failureMarkers,
    problems,

    complete: problems.length === 0 && failureMarkers.length === 0 &&
      git.unreconciled_producers.length === 0,
    spans_complete: unfinished.toJSON().count === 0
  };
}

export function summarizeTestRun({ runDir, runId, recordingFailures = [] }) {
  const native = summarizeNative(runDir, runId);
  const components = summarizeComponents(runDir, runId);
  return {
    schema_version: TEST_RUN_SUMMARY_SCHEMA,
    run_id: runId,
    recording: {
      status: native.complete && components.complete && recordingFailures.length === 0
        ? "complete" : "incomplete",
      failures: recordingFailures
    },
    native,
    components,
    measurement_labels: {
      native_duration: "Node details.duration_ms per test; suites and files are inclusive of " +
        "children and are never summed with them",
      component_span: "local monotonic elapsed time inside the producing process; cross-process " +
        "timestamps are not a shared clock",
      unmeasured: components.coverage?.unmeasured ?? null
    }
  };
}

export function renderSlowest(summary) {
  const lines = [];
  const section = (title, rows, label) => {
    if (rows.length === 0) return;
    lines.push(`[run-tests] slowest ${title}:`);
    for (const row of rows) lines.push(`[run-tests]   ${row.duration_ms.toFixed(1)}ms ${label(row)}`);
  };
  section("files", summary.native.slowest.files, (row) => row.name);
  section("tests", summary.native.slowest.tests, (row) => `${row.name} (${row.file ?? "unknown file"})`);
  section("component spans", summary.components.slowest_spans,
    (row) => `${row.owner}/${row.kind} ${row.label}`);
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}
