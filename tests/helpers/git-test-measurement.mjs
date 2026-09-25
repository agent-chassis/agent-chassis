

import { performance } from "node:perf_hooks";

import { recordComponentEvent, startComponentSpan } from "./test-component-journal.mjs";

export const GIT_TEST_MEASUREMENT_ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: "git_test_measurement.invalid_argument.v1"
});

export class GitTestMeasurementError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GitTestMeasurementError";
    this.code = code;
  }
}

export function measurementInvalid(message) {
  throw new GitTestMeasurementError(GIT_TEST_MEASUREMENT_ERROR_CODES.INVALID_ARGUMENT, message);
}

export const GIT_COMMAND_OUTCOMES = Object.freeze(["ok", "nonzero", "fault"]);
const OUTCOME_COUNTER = Object.freeze({ ok: "ok", nonzero: "nonzero", fault: "faults" });

const processTotals = {
  repositories_allocated: 0, commands: 0, ok: 0, nonzero: 0, faults: 0, elapsed_ms: 0
};

export function snapshotGitTestFixtureMetrics() {
  return Object.freeze({ ...processTotals });
}

export function noteGitRepositoryAllocated() {
  processTotals.repositories_allocated += 1;
}

export function createGitCommandAccount() {
  const metrics = { commands: 0, ok: 0, nonzero: 0, faults: 0, elapsed_ms: 0, by_command: {} };
  return Object.freeze({
    record({ name }, outcome, elapsedMs) {
      metrics.commands += 1;
      metrics[OUTCOME_COUNTER[outcome]] += 1;
      if (elapsedMs !== null) metrics.elapsed_ms += elapsedMs;
      const row = metrics.by_command[name] ??= { count: 0, elapsed_ms: 0 };
      row.count += 1;
      if (elapsedMs !== null) row.elapsed_ms += elapsedMs;
    },
    snapshot() {
      return Object.freeze({
        ...metrics,
        by_command: Object.freeze(Object.fromEntries(Object.entries(metrics.by_command)
          .map(([name, row]) => [name, Object.freeze({ ...row })])))
      });
    }
  });
}

export function startGitCommand(args, { source, account = null, measurement = null } = {}) {
  const identity = gitCommandIdentity(args);
  const startedAt = performance.now();
  const measuredStartedAt = measurement?.now();
  const fixtureInstance = measurement?.activeFixtureInstance ?? null;
  let finished = false;
  return function finish(outcome) {
    if (finished) return;
    finished = true;
    const resolved = GIT_COMMAND_OUTCOMES.includes(outcome) ? outcome : "fault";
    const elapsed = performance.now() - startedAt;
    const elapsedMs = Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
    processTotals.commands += 1;
    processTotals[OUTCOME_COUNTER[resolved]] += 1;
    if (elapsedMs !== null) processTotals.elapsed_ms += elapsedMs;
    account?.record(identity, resolved, elapsedMs);
    measurement?.recordGitCommand(args, resolved, measurement.now() - measuredStartedAt);
    recordComponentEvent({ event: "git_command", owner: "git", source,
      name: identity.name, subcommand: identity.subcommand, outcome: resolved,
      elapsed_ms: elapsedMs, fixture_instance: fixtureInstance,
      process_totals: { commands: processTotals.commands, elapsed_ms: processTotals.elapsed_ms } });
  };
}

export const GIT_PREPARATION_MEASUREMENT_SCHEMA = "git-preparation-measurement.v1";
export const OUTSIDE_FIXTURE_SETUP_PHASE = "outside_fixture_setup";
const OTHER_GIT_COMMANDS = "(other)";
const MAX_COLLECTION_FAILURE_MESSAGES = 8;
export const MAX_PROVENANCE_TEXT = 256;
const MAX_PROVENANCE_LIST = 16;
const gitPreparationMeasurements = new WeakSet();

export function isGitPreparationMeasurement(value) {
  return gitPreparationMeasurements.has(value);
}

function emptyPhaseTotals(fixturePhase) {
  return {
    ...(fixturePhase ? { elapsed_ms: 0 } : {}),
    git_commands: 0,
    git_nonzero: 0,
    git_faults: 0,
    git_elapsed_ms: 0,
    repositories_created: 0,
    worktrees_created: 0,
    by_command: {},
    commands_overflowed: 0
  };
}

export function gitCommandIdentity(args) {
  const positional = args.filter((entry) => !entry.startsWith("-"));
  return { name: positional[0] ?? "(none)", subcommand: positional[1] ?? null };
}

export const boundedText = (value) => typeof value === "string" && value.length > 0 &&
  value.length <= MAX_PROVENANCE_TEXT;
const boundedTextList = (value) => Array.isArray(value) && value.length > 0 &&
  value.length <= MAX_PROVENANCE_LIST && value.every(boundedText);

export function normalizeMeasurementProvenance(provenance) {
  const errors = [];
  const source = provenance !== null && typeof provenance === "object" ? provenance : {};
  if (source !== provenance) errors.push("provenance is missing");
  const runner = source.runner !== null && typeof source.runner === "object" ? source.runner : {};
  const normalized = {
    source_revision: /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(source.source_revision ?? "")
      ? source.source_revision : null,
    patch_identity: /^(?:clean|sha256:[0-9a-f]{64})$/u.test(source.patch_identity ?? "")
      ? source.patch_identity : null,
    sample_id: boundedText(source.sample_id) ? source.sample_id : null,
    diagnostic_kind: ["baseline", "focused"].includes(source.diagnostic_kind)
      ? source.diagnostic_kind : null,
    selectors: boundedTextList(source.selectors) ? [...source.selectors] : null,
    runner: {
      entrypoint: runner.entrypoint === "tests/run-tests.mjs" ? runner.entrypoint : null,
      mode: boundedText(runner.mode) ? runner.mode : null,
      flags: Array.isArray(runner.flags) && runner.flags.length <= MAX_PROVENANCE_LIST &&
        runner.flags.every(boundedText) ? [...runner.flags] : null
    }
  };
  for (const [key, value] of Object.entries(normalized)) {
    if (value === null) errors.push(`provenance.${key} is missing or invalid`);
  }
  for (const [key, value] of Object.entries(normalized.runner)) {
    if (value === null) errors.push(`provenance.runner.${key} is missing or invalid`);
  }
  return { provenance: normalized, errors };
}

export function createGitPreparationMeasurement({
  workload,
  phases,
  commonPhases = [],
  maxSamples = 64,
  maxCommandNames = 32,
  clock = () => performance.now(),
  observeProcess = true
} = {}) {
  if (!boundedText(workload)) measurementInvalid("measurement workload must be a bounded string");
  if (!Array.isArray(phases) || phases.length === 0 || new Set(phases).size !== phases.length ||
      !phases.every(boundedText) || phases.includes(OUTSIDE_FIXTURE_SETUP_PHASE)) {
    measurementInvalid("measurement phases must be unique bounded names");
  }
  if (!commonPhases.every((phase, index) => phases[index] === phase)) {
    measurementInvalid("measurement commonPhases must be a prefix of phases");
  }
  for (const [name, value] of [["maxSamples", maxSamples], ["maxCommandNames", maxCommandNames]]) {
    if (!Number.isInteger(value) || value <= 0) measurementInvalid(`${name} must be a positive integer`);
  }
  if (typeof clock !== "function") measurementInvalid("measurement clock must be a function");

  const failures = { count: 0, messages: [] };
  function collectionFailure(message) {
    failures.count += 1;
    if (failures.messages.length < MAX_COLLECTION_FAILURE_MESSAGES) {
      failures.messages.push(String(message).slice(0, MAX_PROVENANCE_TEXT));
    }
  }
  function now() {
    try {
      const value = clock();
      if (Number.isFinite(value)) return value;
      collectionFailure("clock returned a non-finite value");
    } catch (cause) {
      collectionFailure(`clock failed: ${cause?.message ?? cause}`);
    }
    return Number.NaN;
  }
  function duration(startedAt, what, at = now()) {
    const elapsed = at - startedAt;
    if (Number.isFinite(elapsed) && elapsed >= 0) return elapsed;
    collectionFailure(`impossible ${what} duration`);
    return null;
  }

  const startedAt = now();
  const processUptimeMs = observeProcess ? process.uptime() * 1000 : null;
  const counts = {
    fixture_invocations: 0,
    fixtures_completed: 0,
    fixtures_failed: 0,
    common_preparations: 0
  };
  const phaseTotals = Object.fromEntries([
    ...phases.map((phase) => [phase, emptyPhaseTotals(true)]),
    [OUTSIDE_FIXTURE_SETUP_PHASE, emptyPhaseTotals(false)]
  ]);
  const samples = [];
  let samplesDropped = 0;
  let active = null;

  function closePhase(sample, completed) {
    const at = now();
    const elapsed = duration(sample.phaseStartedAt, `phase ${sample.phase}`, at);
    if (elapsed !== null) {
      sample.phases[sample.phase].elapsed_ms += elapsed;
      phaseTotals[sample.phase].elapsed_ms += elapsed;
    }
    sample.entered.add(sample.phase);
    sample.phaseSpan.end(completed ? "ok" : "failed");
    if (completed && sample.phase === commonPhases.at(-1)) counts.common_preparations += 1;
    return at;
  }

  function finish(sample, outcome) {
    if (active !== sample) {
      collectionFailure("sample ended twice or out of order");
      return;
    }

    const endedAt = closePhase(sample, outcome === "completed");
    sample.span.end(outcome === "completed" ? "ok" : "failed");
    active = null;
    counts[outcome === "completed" ? "fixtures_completed" : "fixtures_failed"] += 1;
    const total = duration(sample.startedAt, "sample", endedAt);
    const attributed = Object.values(sample.phases).reduce((sum, row) => sum + row.elapsed_ms, 0);
    if (samples.length >= maxSamples) {
      samplesDropped += 1;
      return;
    }
    samples.push({
      index: sample.index,
      label: sample.label,
      outcome,
      total_ms: total,
      unattributed_ms: total === null ? null : total - attributed,
      git_commands: sample.gitCommands,
      phases: sample.phases
    });
  }

  function startPhaseSpan(sample) {
    sample.phaseSpan = startComponentSpan({ owner: "git-preparation-measurement", kind: "setup_phase",
      label: sample.phase, parentSpanId: sample.span.id, fixtureInstance: sample.instance,
      test: sample.test });
  }

  function beginSample(label, { test = null } = {}) {
    if (active !== null) {
      collectionFailure("sample began while another sample was active");
      finish(active, "abandoned");
    }
    counts.fixture_invocations += 1;
    const sample = {
      index: counts.fixture_invocations,
      label: boundedText(label) ? label : "(invalid label)",
      startedAt: now(),
      phase: phases[0],
      phaseStartedAt: Number.NaN,
      entered: new Set(),
      gitCommands: 0,
      phases: Object.fromEntries(phases.map((phase) => [phase, { elapsed_ms: 0, git_commands: 0 }]))
    };
    sample.phaseStartedAt = sample.startedAt;
    sample.instance = `${workload}#${sample.index}`;
    sample.test = test;
    sample.span = startComponentSpan({ owner: "git-preparation-measurement", kind: "fixture_sample",
      label: sample.label, fixtureInstance: sample.instance, test });
    startPhaseSpan(sample);
    active = sample;
    return Object.freeze({
      phase(name) {
        try {
          enterPhase(sample, name);
        } catch (cause) {
          collectionFailure(`phase ${name} failed: ${cause?.message ?? cause}`);
        }
      },
      end(outcome) {
        try {
          finish(sample, outcome === "completed" ? "completed" : "failed");
        } catch (cause) {
          collectionFailure(`sample end failed: ${cause?.message ?? cause}`);
        }
      }
    });
  }

  function enterPhase(sample, name) {
    if (active !== sample) return collectionFailure(`phase ${name} after sample end`);
    if (!phases.includes(name) || name === sample.phase || sample.entered.has(name)) {
      return collectionFailure(`phase ${name} is unknown or re-entered`);
    }
    sample.phaseStartedAt = closePhase(sample, true);
    sample.phase = name;
    startPhaseSpan(sample);
  }

  function recordGitCommand(args, outcome, elapsedMs) {
    try {
      recordGitCommandUnguarded(args, outcome, elapsedMs);
    } catch (cause) {
      collectionFailure(`git command record failed: ${cause?.message ?? cause}`);
    }
  }

  function recordGitCommandUnguarded(args, outcome, elapsedMs) {
    const { name, subcommand } = gitCommandIdentity(args);
    const phase = active?.phase ?? OUTSIDE_FIXTURE_SETUP_PHASE;
    const row = phaseTotals[phase];
    row.git_commands += 1;
    if (outcome === "nonzero") row.git_nonzero += 1;
    if (outcome === "fault") row.git_faults += 1;
    if (Number.isFinite(elapsedMs) && elapsedMs >= 0) row.git_elapsed_ms += elapsedMs;
    else collectionFailure(`impossible git ${name} duration`);
    if (outcome === "ok" && name === "init") row.repositories_created += 1;
    if (outcome === "ok" && name === "worktree" && subcommand === "add") row.worktrees_created += 1;
    const key = Object.hasOwn(row.by_command, name) ||
      Object.keys(row.by_command).length < maxCommandNames - 1 ? name : OTHER_GIT_COMMANDS;
    if (key === OTHER_GIT_COMMANDS) row.commands_overflowed += 1;
    row.by_command[key] = (row.by_command[key] ?? 0) + 1;
    if (active !== null) {
      active.gitCommands += 1;
      active.phases[phase].git_commands += 1;
    }
  }

  function report({ provenance } = {}) {
    const { provenance: normalized, errors } = normalizeMeasurementProvenance(provenance);
    const rows = Object.values(phaseTotals);
    const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
    const workloadElapsed = duration(startedAt, "workload");
    const fixtureSetup = samples.reduce((total, sample) => total + (sample.total_ms ?? 0), 0);
    const unavailable = [
      { quantity: "fixture_disk_bytes", reason: "not measured: walking fixture trees would perturb the timed workload" },
      { quantity: "git_child_cpu_ms", reason: "not observable: synchronous Git children are not attributed by process.resourceUsage" },
      { quantity: "production_git_commands", reason: "outside the fixture-helper Git owner" }
    ];
    if (samplesDropped > 0) {
      unavailable.push({ quantity: "fixture_setup_ms_of_dropped_samples", reason: "sample capacity exceeded" });
    }
    if (!observeProcess) {
      unavailable.push({ quantity: "process_peak_rss_kib", reason: "process observation disabled" },
        { quantity: "process_uptime_at_enrollment_ms", reason: "process observation disabled" });
    }
    return JSON.parse(JSON.stringify({
      schema_version: GIT_PREPARATION_MEASUREMENT_SCHEMA,
      workload,
      provenance: normalized,
      provenance_errors: errors,
      units: { duration: "ms (monotonic clock)", counts: "events", memory: "KiB" },
      git_command_scope: "fixture-helper Git only; production Git and delayed-shim Git outside that owner are unmeasured",
      counts: {
        ...counts,
        repositories_created: sum("repositories_created"),
        worktrees_created: sum("worktrees_created"),
        git_commands: sum("git_commands"),
        git_nonzero: sum("git_nonzero"),
        git_faults: sum("git_faults")
      },
      denominators: {
        samples_recorded: samples.length,
        samples_dropped: samplesDropped,
        sample_capacity: maxSamples,
        command_name_capacity: maxCommandNames
      },
      phases: phaseTotals,
      timing: {
        workload_elapsed_ms: workloadElapsed,
        fixture_setup_ms: fixtureSetup,

        outside_fixture_setup_unattributed_ms: workloadElapsed === null || samplesDropped > 0
          ? null : workloadElapsed - fixtureSetup,
        process_uptime_at_enrollment_ms: processUptimeMs
      },
      resources: observeProcess
        ? { process_peak_rss_kib: { value: process.resourceUsage().maxRSS, semantics: "peak for the workload process lifetime; excludes Git children" },
            git_processes_started: { value: sum("git_commands"), semantics: "cumulative fixture-helper Git processes" } }
        : { git_processes_started: { value: sum("git_commands"), semantics: "cumulative fixture-helper Git processes" } },
      unavailable,
      samples,
      collection: {
        status: failures.count === 0 && active === null ? "complete" : "incomplete",
        failures: failures.count,
        failure_messages: failures.messages,
        sample_active_at_report: active !== null
      }
    }));
  }

  const measurement = Object.freeze({ beginSample, report, now, recordGitCommand,
    get activeFixtureInstance() { return active?.instance ?? null; } });
  gitPreparationMeasurements.add(measurement);
  return measurement;
}

