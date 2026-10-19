
import path from "node:path";
import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";

import { AGENT_RUN_USAGE_TOKEN_QUANTITIES, combinePopulationUsage } from "./agent-run-usage.mjs";
import { resolveLauncherRuntimeStateDirForWorkspace } from "./launcher-runtime-state-dir.mjs";
import { ensureDirectory, writeJsonAtomic } from "./filesystem.mjs";
import { NATIVE_USAGE_ADAPTERS } from "./native-usage-adapters.mjs";
import { createNativeUsageCheckpointWriter, readNativeUsageCheckpoints } from "./native-usage-checkpoints.mjs";
import {
  AGENT_RUN_USAGE_RECORD_SCHEMA_VERSION,
  NATIVE_USAGE_INVOCATION_ID_PATTERN,
  createNativeUsageCapture
} from "./native-usage-capture.mjs";

export const AGENT_RUN_USAGE_TASK_SCHEMA_VERSION = "agent-run-usage-task.v1";
export const NATIVE_USAGE_RECORD_SUFFIX = ".usage.json";

export const NATIVE_USAGE_RECORDS_DIRNAME = "usage";

const failure = (code, error = null, detail = null) =>
  ({ ok: false, cause: { code, errno: typeof error?.code === "string" ? error.code : null, detail } });

async function isRealDirectory(dir) {
  const stats = await lstat(dir);
  return stats.isDirectory() && !stats.isSymbolicLink();
}

export async function writeNativeUsageRecord(dir, record) {
  if (typeof dir !== "string" || dir === "" || record?.schema_version !== AGENT_RUN_USAGE_RECORD_SCHEMA_VERSION
      || typeof record.invocation_id !== "string" || !NATIVE_USAGE_INVOCATION_ID_PATTERN.test(record.invocation_id)) {
    return failure("usage_record_invalid");
  }
  const target = path.join(dir, `${record.invocation_id}${NATIVE_USAGE_RECORD_SUFFIX}`);
  try {
    await ensureDirectory(dir);
    if (!(await isRealDirectory(dir))) return failure("usage_records_dir_not_owned");
    await writeJsonAtomic(target, record, { mode: 0o600 });
    return { ok: true, path: target };
  } catch (error) {
    return failure("usage_record_write_failed", error);
  }
}

export async function readNativeUsageRecords(dir) {
  const result = { records: [], unreadable: [] };
  let names;
  try {
    if (!(await isRealDirectory(dir))) return { ...result, unreadable: [{ file: ".", code: "usage_records_dir_not_owned" }] };
    names = (await readdir(dir)).filter((name) => name.endsWith(NATIVE_USAGE_RECORD_SUFFIX)).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return result;
    return { ...result, unreadable: [{ file: ".", code: "usage_records_dir_unreadable" }] };
  }
  for (const name of names) {
    try {
      const record = JSON.parse(await readFile(path.join(dir, name), "utf8"));
      const named = `${record?.invocation_id}${NATIVE_USAGE_RECORD_SUFFIX}`;
      if (record?.schema_version === AGENT_RUN_USAGE_RECORD_SCHEMA_VERSION && named === name) result.records.push(record);
      else result.unreadable.push({ file: name, code: "usage_record_invalid" });
    } catch {
      result.unreadable.push({ file: name, code: "usage_record_unreadable" });
    }
  }
  return result;
}

export function selectSessionBaseline(records, { family, native_session_id, source_id }) {
  let selected = null;
  let ambiguous = false;
  for (const record of Array.isArray(records) ? records : []) {
    if (record?.family !== family || record.native_session_id !== native_session_id
        || record.source?.id !== source_id || record.end_snapshot === null || typeof record.end_snapshot !== "object"
        || typeof record.settled_at !== "string") {
      continue;
    }
    if (selected === null || record.settled_at > selected.settled_at) {
      selected = record;
      ambiguous = false;
    } else if (record.settled_at === selected.settled_at
        && JSON.stringify(record.end_snapshot.counters) !== JSON.stringify(selected.end_snapshot.counters)) {
      ambiguous = true;
    }
  }
  return ambiguous ? null : selected;
}

export const AGENT_RUN_USAGE_LAUNCH_SCHEMA_VERSION = "agent-run-usage-launch.v1";
export const NATIVE_USAGE_LAUNCH_SUFFIX = ".launch.json";
const LAUNCH_IDENTITY_KEYS = ["invocation_id", "attempt_id", "run_id", "parent_invocation_id", "repo", "subject",
  "role", "route", "mode"];

export async function registerNativeUsageLaunch(dir, launch) {
  if (typeof dir !== "string" || dir === "" || typeof launch?.invocation_id !== "string"
      || !NATIVE_USAGE_INVOCATION_ID_PATTERN.test(launch.invocation_id)) {
    return failure("usage_launch_invalid");
  }
  const entry = { schema_version: AGENT_RUN_USAGE_LAUNCH_SCHEMA_VERSION };
  for (const key of LAUNCH_IDENTITY_KEYS) entry[key] = typeof launch[key] === "string" && launch[key] !== "" ? launch[key] : null;
  entry.family = typeof launch.family === "string" ? launch.family : null;
  entry.started_at = new Date().toISOString();
  const target = path.join(dir, `${launch.invocation_id}${NATIVE_USAGE_LAUNCH_SUFFIX}`);
  try {
    await ensureDirectory(dir);
    if (!(await isRealDirectory(dir))) return failure("usage_records_dir_not_owned");
    await writeJsonAtomic(target, entry, { mode: 0o600 });
    return { ok: true, path: target };
  } catch (error) {
    return failure("usage_launch_write_failed", error);
  }
}

export async function readRunContributors(dir) {
  const retained = await readNativeUsageRecords(dir);
  const result = { contributors: [], records: retained.records, checkpoints: [], unlisted: [],
    unreadable: [...retained.unreadable] };
  let names = [];
  try {
    if (await isRealDirectory(dir)) {
      names = (await readdir(dir)).filter((name) => name.endsWith(NATIVE_USAGE_LAUNCH_SUFFIX)).sort();
    }
  } catch (error) {
    if (error?.code !== "ENOENT") result.unreadable.push({ file: ".", code: "usage_records_dir_unreadable" });
  }
  const settled = new Set(retained.records.map((record) => record.invocation_id));
  const listed = new Set();
  for (const name of names) {
    try {
      const entry = JSON.parse(await readFile(path.join(dir, name), "utf8"));
      if (entry?.schema_version !== AGENT_RUN_USAGE_LAUNCH_SCHEMA_VERSION
          || `${entry.invocation_id}${NATIVE_USAGE_LAUNCH_SUFFIX}` !== name) {
        result.unreadable.push({ file: name, code: "usage_launch_invalid" });
        continue;
      }
      listed.add(entry.invocation_id);
      result.contributors.push({ ...entry, outcome: settled.has(entry.invocation_id) ? "launched" : "unknown" });
    } catch {
      result.unreadable.push({ file: name, code: "usage_launch_unreadable" });
    }
  }
  for (const id of settled) if (!listed.has(id)) result.unlisted.push(id);
  const pending = await readNativeUsageCheckpoints(dir);
  const unsettled = (id) => listed.has(id) && !settled.has(id);
  result.checkpoints = pending.checkpoints.filter((checkpoint) => unsettled(checkpoint.invocation_id));
  result.unreadable.push(...pending.unreadable.filter((entry) =>
    unsettled(entry.file.slice(0, entry.file.indexOf(".checkpoint.json")))));
  return result;
}

export async function aggregateRetainedRunUsage(dir) {
  const run = await readRunContributors(dir);
  const total = aggregateRunUsage({ contributors: run.contributors, records: run.records, checkpoints: run.checkpoints });
  if (run.unreadable.length > 0) {
    total.causes.push({ code: "usage_artifacts_unreadable", invocation_id: null, quantity: null });
    for (const name of AGENT_RUN_USAGE_TOKEN_QUANTITIES) total.tokens[name] = demote(total.tokens[name]);
    total.cost = { ...total.cost, amount: demote(total.cost.amount) };
    total.peak_context = demote(total.peak_context);
    total.status = total.tokens.total.status;
  }

  const launches = run.contributors.map((entry) => ({ invocation_id: entry.invocation_id, attempt_id: entry.attempt_id,
    run_id: entry.run_id, role: entry.role, route: entry.route, family: entry.family, outcome: entry.outcome }));
  return { ...total, launches, unlisted: run.unlisted, unreadable: run.unreadable };
}

export const NATIVE_USAGE_RUN_TOTAL_FILE = "run-total.json";
export const NATIVE_USAGE_POINTER_FILE = "native-usage.json";
export const AGENT_RUN_USAGE_POINTER_SCHEMA_VERSION = "agent-run-usage-pointer.v1";

export async function writeRunUsageTotal(dir) {
  if (typeof dir !== "string" || dir === "") return failure("usage_records_dir_unresolved");
  const target = path.join(dir, NATIVE_USAGE_RUN_TOTAL_FILE);
  try {
    if (!(await isRealDirectory(dir))) return failure("usage_records_dir_not_owned");
    await writeJsonAtomic(target, await aggregateRetainedRunUsage(dir), { mode: 0o600 });
    return { ok: true, path: target };
  } catch (error) {
    return failure("usage_run_total_write_failed", error);
  }
}

export async function writeNativeUsagePointer(runtimeDir, recordsDir) {
  if (typeof runtimeDir !== "string" || runtimeDir === "" || typeof recordsDir !== "string" || recordsDir === "") {
    return failure("usage_pointer_invalid");
  }
  const target = path.join(runtimeDir, NATIVE_USAGE_POINTER_FILE);
  try {
    await writeJsonAtomic(target, { schema_version: AGENT_RUN_USAGE_POINTER_SCHEMA_VERSION, records_dir: recordsDir,
      run_total_path: path.join(recordsDir, NATIVE_USAGE_RUN_TOTAL_FILE) }, { mode: 0o600 });
    return { ok: true, path: target };
  } catch (error) {
    return failure("usage_pointer_write_failed", error);
  }
}

export function createNativeUsageLaunchTap({ family, identity, resumed, recordsDir, recordsRoot = null, now,
  usageTransport = "stdout" } = {}) {
  if (usageTransport !== "stdout" && !(family === "opencode" && usageTransport === "opencode_api")) {
    throw new TypeError("native_usage_transport_unsupported");
  }
  let sink = null;
  const capture = createNativeUsageCapture({ family, identity, resumed, ...(now ? { now } : {}),
    onText: (text) => { if (sink !== null) sink(text); } });
  const source = NATIVE_USAGE_ADAPTERS[family].source;
  let settlement = null;
  let sourceComplete = false;
  let sourceSessionBound = false;
  const api = usageTransport === "opencode_api";
  const checkpoints = createNativeUsageCheckpointWriter({ recordsDir, invocationId: identity?.invocation_id,
    onWritten: () => writeRunUsageTotal(recordsDir), ...(now ? { now } : {}) });
  let checkpointed = 0;

  let baselineLookup = null;
  const resolveBaseline = () => (baselineLookup ??= (async () => {
    const sessionId = capture.sessionId();
    if (resumed !== true || sessionId === null || recordsDir === null) return undefined;

    const retained = recordsRoot === null ? (await readNativeUsageRecords(recordsDir)).records
      : await readAllNativeUsageRecords(recordsRoot);
    return selectSessionBaseline(retained.filter((each) => each.invocation_id !== identity.invocation_id),
      { family, native_session_id: sessionId, source_id: source.id });
  })());
  const checkpoint = () => {
    const reports = capture.observations();
    if (reports === checkpointed) return;
    checkpointed = reports;
    checkpoints.offer(async () => {
      const baseline = await resolveBaseline();
      return capture.provisional(baseline === undefined ? {} : { baseline });
    });
  };
  async function settleOnce(observation, registration) {
    try {
      await registration;
      if (api) capture.end({ drained: sourceComplete });
      await checkpoints.close();
      const baseline = await resolveBaseline();
      const record = capture.settle({ exit: observation?.exit ?? null,
        ...(baseline === undefined ? {} : { baseline }) });
      const retention = recordsDir === null ? failure("usage_records_dir_unresolved")
        : await writeNativeUsageRecord(recordsDir, record);
      if (retention.ok) await checkpoints.retire();
      await writeRunUsageTotal(recordsDir);
      return { record, retention };
    } catch (error) {
      return { record: null, retention: failure("usage_capture_settle_failed", error) };
    }
  }
  let registration = null;
  return Object.freeze({
    family,
    preserveProtocol: NATIVE_USAGE_ADAPTERS[family].preserveProtocol === true,

    recordsDir,
    started: () => {
      registration ??= registerNativeUsageLaunch(recordsDir, { ...identity, family })
        .then(async (result) => { await writeRunUsageTotal(recordsDir); return result; });
    },
    registered: () => registration,
    outputArgs: (args) => NATIVE_USAGE_ADAPTERS[family].outputArgs(args),
    bind: (next) => { sink = typeof next === "function" ? next : null; },
    push: (chunk) => {
      if (api) return;
      try {
        capture.push(chunk);
      } finally {
        checkpoint();
      }
    },
    events: () => api ? 0 : capture.events(),
    end: (observation) => { if (!api) capture.end(observation); },
    ...(api ? {
      bindNativeSession: (sessionId, options) => {
        capture.bindSession(sessionId, options);
        sourceSessionBound = true;
      },
      observeNativePart: (part) => {
        if (!sourceSessionBound) throw new Error("native_usage_api_session_unbound");
        if (sourceComplete || settlement !== null) throw new Error("native_usage_api_source_finished");
        const type = { "step-start": "step_start", "step-finish": "step_finish" }[part?.type];
        if (type === undefined) return;
        try { capture.push(Buffer.from(`${JSON.stringify({ type, sessionID: part.sessionID, part })}\n`)); }
        finally { checkpoint(); }
      },
      endNativeUsage: ({ complete }) => {
        if (settlement !== null) throw new Error("native_usage_api_source_finished");
        if (typeof complete !== "boolean") throw new TypeError("native_usage_api_completion_invalid");
        sourceComplete = complete;
      }
    } : {}),
    settle: (observation) => (settlement ??= settleOnce(observation, registration))
  });
}

export const AGENT_RUN_USAGE_TASK_ENTRY_SCHEMA_VERSION = "agent-run-usage-task-entry.v1";
export const NATIVE_USAGE_TASK_FILE = "task.json";

export const NATIVE_USAGE_TASK_DIR_ENV = "AGENT_LAUNCH_USAGE_TASK_DIR";
export const NATIVE_USAGE_PARENT_INVOCATION_ENV = "AGENT_LAUNCH_USAGE_PARENT_INVOCATION_ID";

function readTaskEntrySync(taskDir) {
  try {
    const stats = lstatSync(taskDir);
    if (!stats.isDirectory() || stats.isSymbolicLink()) return null;
    const entry = JSON.parse(readFileSync(path.join(taskDir, NATIVE_USAGE_TASK_FILE), "utf8"));
    return entry?.schema_version === AGENT_RUN_USAGE_TASK_ENTRY_SCHEMA_VERSION
      && entry.task_id === path.basename(taskDir) ? entry : null;
  } catch {
    return null;
  }
}

function createTaskSync(root, taskId, repo) {

  mkdirSync(root, { recursive: true, mode: 0o700 });
  const rootStats = lstatSync(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) throw new Error("usage records root is not owned");
  const taskDir = path.join(root, taskId);
  mkdirSync(taskDir, { mode: 0o700 });
  const stats = lstatSync(taskDir);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("usage task directory is not owned");
  if (readTaskEntrySync(taskDir) === null) {
    writeFileSync(path.join(taskDir, NATIVE_USAGE_TASK_FILE), `${JSON.stringify({
      schema_version: AGENT_RUN_USAGE_TASK_ENTRY_SCHEMA_VERSION, task_id: taskId, root_invocation_id: taskId,
      repo: typeof repo === "string" ? repo : null, started_at: new Date().toISOString() }, null, 2)}\n`,
    { mode: 0o600, flag: "wx" });
  }
  return taskDir;
}

export function resolveNativeUsageTask({ workspaceDir, env = process.env, invocationId, root = false } = {}) {
  const records = resolveNativeUsageRecordsDir({ workspaceDir, env });
  if (!records.ok) return records;
  if (!root) {
    const carried = env?.[NATIVE_USAGE_TASK_DIR_ENV];
    const parent = env?.[NATIVE_USAGE_PARENT_INVOCATION_ENV];
    if (typeof carried === "string" && path.isAbsolute(carried)) {
      const entry = readTaskEntrySync(carried);
      if (entry !== null && typeof parent === "string" && NATIVE_USAGE_INVOCATION_ID_PATTERN.test(parent)) {
        return { ok: true, records_root: path.dirname(carried), task_dir: carried, task_id: entry.task_id,
          parent_invocation_id: parent, joined: true };
      }
    }
  }
  try {
    const taskDir = createTaskSync(records.dir, invocationId, workspaceDir);
    return { ok: true, records_root: records.dir, task_dir: taskDir, task_id: invocationId, parent_invocation_id: null,
      joined: false };
  } catch (error) {
    return failure("usage_task_dir_unavailable", error);
  }
}

export function beginNativeUsageTask({ workspaceDir, env = process.env } = {}) {
  const invocationId = `INV-${randomUUID()}`;
  const task = resolveNativeUsageTask({ workspaceDir, env, invocationId, root: true });
  if (!task.ok) return { invocation_id: invocationId, task: null };
  env[NATIVE_USAGE_TASK_DIR_ENV] = task.task_dir;
  env[NATIVE_USAGE_PARENT_INVOCATION_ENV] = invocationId;
  return { invocation_id: invocationId, task };
}

export function nativeUsageTaskEnv(env = process.env) {
  const carried = {};
  for (const key of [NATIVE_USAGE_TASK_DIR_ENV, NATIVE_USAGE_PARENT_INVOCATION_ENV]) {
    if (typeof env?.[key] === "string" && env[key] !== "") carried[key] = env[key];
  }
  return carried;
}

export async function readAllNativeUsageRecords(recordsRoot) {
  const records = [];
  let names = [];
  try {
    names = (await readdir(recordsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return records;
  }
  for (const name of names.sort()) records.push(...(await readNativeUsageRecords(path.join(recordsRoot, name))).records);
  return records;
}

export function resolveNativeUsageRecordsDir({ workspaceDir, env = process.env } = {}) {

  if (typeof workspaceDir !== "string" || workspaceDir === "") return failure("usage_records_dir_unresolved");
  let resolved;
  try {
    resolved = resolveLauncherRuntimeStateDirForWorkspace({ workspaceBasis: path.resolve(workspaceDir), env });
  } catch {
    return failure("usage_records_dir_unresolved");
  }
  return resolved.ok ? { ok: true, dir: path.join(resolved.dir, NATIVE_USAGE_RECORDS_DIRNAME) }
    : failure("usage_records_dir_unresolved", null, { code: resolved.code });
}

export function prepareNativeUsageLaunch({ family, args, workspaceDir, env = process.env, identity = {}, resumed,
  begun = null, usageTransport = "stdout" } = {}) {
  const invocationId = begun?.invocation_id ?? `INV-${randomUUID()}`;
  const unprepared = (code, recordsDir = null) =>
    ({ args, tap: null, invocation_id: invocationId, records_dir: recordsDir, cause: { code } });
  if (!Object.hasOwn(NATIVE_USAGE_ADAPTERS, family) || !Array.isArray(args)) return unprepared("usage_family_unsupported");
  if (usageTransport !== "stdout" && !(family === "opencode" && usageTransport === "opencode_api")) {
    return unprepared("usage_transport_unsupported");
  }
  const switched = usageTransport === "opencode_api" ? args : NATIVE_USAGE_ADAPTERS[family].outputArgs(args);
  if (switched === null) return unprepared("usage_output_mode_unsupported");

  const records = begun?.task ?? resolveNativeUsageTask({ workspaceDir, env, invocationId });
  const recordsDir = records.ok ? records.task_dir : null;
  try {
    const bound = Object.fromEntries(Object.entries(identity ?? {})
      .map(([key, value]) => [key, typeof value === "string" && value !== "" ? value : null]));

    const tap = createNativeUsageLaunchTap({ family, resumed, recordsDir, usageTransport, recordsRoot: records.ok ? records.records_root : null,
      identity: { ...bound, invocation_id: invocationId, parent_invocation_id: records.ok ? records.parent_invocation_id : null } });
    return { args: switched, tap, invocation_id: invocationId, records_dir: recordsDir,
      task_id: records.ok ? records.task_id : null,
      cause: records.ok ? null : { code: records.cause.code } };
  } catch {
    return unprepared("usage_capture_unprepared", recordsDir);
  }
}

const demote = (quantity) => (quantity.status === "complete"
  ? { value: null, observed: quantity.observed, status: "partial" } : quantity);

export function aggregateRunUsage({ contributors = [], records = [], checkpoints = [] } = {}) {
  const pendingByInvocation = new Map((Array.isArray(checkpoints) ? checkpoints : [])
    .filter((checkpoint) => typeof checkpoint?.invocation_id === "string" && typeof checkpoint.native_session_id === "string"
      && checkpoint.status === "partial")
    .map((checkpoint) => [checkpoint.invocation_id, checkpoint]));
  const byInvocation = new Map();
  const conflicted = new Set();
  const causes = [];
  for (const record of Array.isArray(records) ? records : []) {
    if (record?.schema_version !== AGENT_RUN_USAGE_RECORD_SCHEMA_VERSION) continue;
    const prior = byInvocation.get(record.invocation_id);
    if (prior === undefined) byInvocation.set(record.invocation_id, record);
    else if (JSON.stringify(prior.tokens) !== JSON.stringify(record.tokens) && !conflicted.has(record.invocation_id)) {
      causes.push({ code: "conflicting_invocation_records", invocation_id: record.invocation_id, quantity: null });
      conflicted.add(record.invocation_id);
    }
  }
  const coverage = { expected: 0, complete: 0, partial: 0, unavailable: 0, not_spawned: 0, unknown_outcome: 0 };
  const listed = [];
  const usable = [];
  const seen = new Set();
  for (const contributor of Array.isArray(contributors) ? contributors : []) {
    const id = contributor?.invocation_id;
    if (typeof id !== "string" || seen.has(id)) continue;
    seen.add(id);
    const outcome = ["launched", "not_spawned", "unknown"].includes(contributor.outcome) ? contributor.outcome : "unknown";
    if (outcome === "not_spawned") {
      coverage.not_spawned += 1;
      listed.push({ invocation_id: id, outcome, status: "not_spawned" });
      continue;
    }
    coverage.expected += 1;
    if (outcome === "unknown") coverage.unknown_outcome += 1;
    const record = byInvocation.get(id);
    const pending = record === undefined ? pendingByInvocation.get(id) : undefined;
    const status = pending !== undefined ? "partial"
      : record === undefined || conflicted.has(id) || record.native_session_id === null ? "unavailable" : record.status;
    coverage[status] += 1;
    listed.push({ invocation_id: id, outcome, status });
    if (pending !== undefined) {
      causes.push({ code: "contributor_usage_pending", invocation_id: id, quantity: null });
      usable.push(pending);
    } else if (status === "unavailable") {
      causes.push({ code: record === undefined ? "contributor_record_missing" : "contributor_usage_unavailable",
        invocation_id: id, quantity: null });
    } else {
      usable.push(record);
    }
    if (outcome === "unknown") causes.push({ code: "contributor_outcome_unknown", invocation_id: id, quantity: null });
  }
  const asUsage = (record) => ({
    identity: { invocation_id: record.invocation_id, session_id: record.native_session_id, source_id: record.source.id,
      population_id: record.native_session_id, interval_id: record.invocation_id },
    descendant_coverage: record.source.descendant_coverage,
    tokens: record.tokens, cost: record.cost, peak_context: record.peak_context
  });
  const unavailable = () => ({ value: null, observed: null, status: "unavailable" });
  let combined = { tokens: Object.fromEntries(AGENT_RUN_USAGE_TOKEN_QUANTITIES.map((name) => [name, unavailable()])),
    cost: { amount: unavailable(), currency: null, source: null, kind: "native_estimate" }, peak_context: unavailable() };
  if (usable.length > 0) {
    const [root, ...members] = usable;
    combined = combinePopulationUsage({ root: asUsage(root),
      members: members.map((record) => ({ relation: "managed_invocation", usage: asUsage(record) })) });
    for (const cause of combined.causes) {
      causes.push({ code: cause.code, invocation_id: cause.identity?.invocation_id ?? null, quantity: cause.quantity });
    }
  }
  const incomplete = coverage.expected === 0 || coverage.complete !== coverage.expected || coverage.unknown_outcome > 0;
  const tokens = {};
  for (const name of AGENT_RUN_USAGE_TOKEN_QUANTITIES) {
    tokens[name] = incomplete ? demote(combined.tokens[name]) : combined.tokens[name];
  }

  const cost = { ...combined.cost, amount: incomplete ? demote(combined.cost.amount) : combined.cost.amount };
  return {
    schema_version: AGENT_RUN_USAGE_TASK_SCHEMA_VERSION,
    status: tokens.total.status,
    coverage,
    tokens,
    cost,
    peak_context: incomplete ? demote(combined.peak_context) : combined.peak_context,
    contributors: listed,
    causes
  };
}
