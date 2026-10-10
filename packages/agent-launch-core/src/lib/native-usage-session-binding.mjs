
import path from "node:path";
import { randomUUID } from "node:crypto";
import { closeSync, openSync, watch } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";

import { bindNativeUsageIdentity, buildNativeUsageRecord } from "./native-usage-capture.mjs";
import { createNativeUsageCheckpointWriter } from "./native-usage-checkpoints.mjs";
import { writeJsonAtomic } from "./filesystem.mjs";
import { createNativeUsageJsonlDecoder } from "./native-usage-jsonl.mjs";
import {
  readAllNativeUsageRecords,
  readNativeUsageRecords,
  registerNativeUsageLaunch,
  resolveNativeUsageTask,
  selectSessionBaseline,
  writeNativeUsageRecord,
  writeRunUsageTotal
} from "./native-usage-records.mjs";

export const NATIVE_USAGE_SESSION_HOOK_EVENT = "SessionStart";
export const NATIVE_USAGE_SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const MAX_BINDING_BYTES = 64 * 1024;

const FRESH_SOURCES = new Set(["startup", "clear"]);

const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

export function buildSessionUsageHookCommand(bindingPath) {
  if (typeof bindingPath !== "string" || !path.isAbsolute(bindingPath)) {
    throw new TypeError("the usage hook requires an absolute binding path");
  }
  return `/bin/sh -c 'umask 077; cat >> "$1"; echo >> "$1"' sh ${shellQuote(bindingPath)}`;
}

export function buildSessionUsageSignalCommand(signalPath) {
  if (typeof signalPath !== "string" || !path.isAbsolute(signalPath)) {
    throw new TypeError("the usage checkpoint hook requires an absolute signal path");
  }
  return `/bin/sh -c 'cat > /dev/null; umask 077; echo >> "$1"' sh ${shellQuote(signalPath)}`;
}

const unbound = (cause) => ({ ok: false, cause });

export function createSessionRecordReader({ locate, extractor }) {
  const decoder = createNativeUsageJsonlDecoder({
    onRecord: ({ value }) => {
      try {
        extractor.accept(value);
      } catch {

      }
    },
    onDiagnostic: () => {}
  });
  let offset = 0;
  let settled = null;
  async function advance({ final = false } = {}) {
    if (settled !== null) return settled;
    const fail = (cause, sticky) => {
      const result = unbound(cause);
      if (sticky || final) settled = result;
      return result;
    };
    let handle;
    try {
      const located = await locate();
      if (!located.ok) return fail(located.cause, false);
      handle = await open(located.path, "r");
    } catch (error) {
      return fail(error?.code === "ENOENT" ? "session_record_not_found" : "session_record_unreadable", false);
    }
    try {
      if ((await handle.stat()).size < offset) return fail("session_record_unreadable", true);
      const buffer = Buffer.alloc(65536);
      for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
        decoder.push(buffer.subarray(0, bytesRead));
      }
    } catch {
      return fail("session_record_unreadable", false);
    } finally {
      await handle.close().catch(() => {});
    }
    const read = final ? decoder.finish(true) : decoder.getState();
    if (!extractor.bound()) return fail("session_record_not_bound", false);
    const result = { ok: true, facts: extractor.facts(),
      stream: { complete: final && read.complete === true, records: read.records, diagnostics: read.diagnostics } };
    if (final) settled = result;
    return result;
  }
  return Object.freeze({ advance });
}

export async function readSessionBindings(bindingPath, { rewrite = true } = {}) {
  let text;
  try {
    const stats = await lstat(bindingPath);
    if (!stats.isFile() || stats.size > MAX_BINDING_BYTES) return unbound("session_binding_invalid");
    text = await readFile(bindingPath, "utf8");
  } catch (error) {
    return unbound(error?.code === "ENOENT" ? "session_binding_missing" : "session_binding_unreadable");
  }
  const bindings = [];
  const seen = new Set();

  let inputs;
  try {
    const whole = JSON.parse(text);
    inputs = Array.isArray(whole) ? whole : [whole];
  } catch {
    try {
      inputs = text.split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line));
    } catch {
      return unbound("session_binding_invalid");
    }
  }
  for (const input of inputs) {
    const entries = Array.isArray(input) ? input : [input];
    for (const entry of entries) {
      const allowlisted = entry !== null && typeof entry === "object" && entry.hook_event_name === undefined
        && typeof entry.resumed !== "undefined";
      if (entry === null || typeof entry !== "object"
          || (!allowlisted && entry.hook_event_name !== NATIVE_USAGE_SESSION_HOOK_EVENT)
          || typeof entry.session_id !== "string" || !NATIVE_USAGE_SESSION_ID_PATTERN.test(entry.session_id)
          || typeof entry.transcript_path !== "string" || !path.isAbsolute(entry.transcript_path)) {
        return unbound("session_binding_invalid");
      }

      if (seen.has(entry.session_id)) continue;
      seen.add(entry.session_id);
      bindings.push({ session_id: entry.session_id, transcript_path: entry.transcript_path,
        resumed: allowlisted ? entry.resumed : entry.source === "resume" ? true : FRESH_SOURCES.has(entry.source) ? false : null });
    }
  }
  if (bindings.length === 0) return unbound("session_binding_missing");

  if (rewrite) await writeJsonAtomic(bindingPath, bindings, { mode: 0o600 }).catch(() => {});
  return { ok: true, bindings };
}

const emptyFacts = (source) => ({ session_id: null, session_conflict: false, client_version: null, snapshots: [], requests: [],
  requests_truncated: false, terminal_event: false, error_event: false, usage_presence: "unverified",
  descendant_coverage: source.descendant_coverage, final_text: null, protocol_events: 0 });

export function createSessionUsageTracker({ family, source, openReader, incompleteCause = () => null, identity, bindingPath,
  recordsDir, recordsRoot = null, now = () => new Date(), startedAt = now().toISOString() } = {}) {
  const failed = (code) => ({ record: null, records: [], retention: { ok: false, cause: { code, errno: null, detail: null } } });
  const sessions = new Map();
  let bound = null;

  async function sessionFor(binding, at) {
    const known = sessions.get(binding.session_id);
    if (known !== undefined) return known;
    const sessionIdentity = at === 0 ? bound : { ...bound, invocation_id: `${bound.invocation_id}.s${at + 1}` };
    let baseline = null;
    if (binding.resumed === true && recordsDir !== null) {

      const retained = recordsRoot === null ? (await readNativeUsageRecords(recordsDir)).records
        : await readAllNativeUsageRecords(recordsRoot);
      baseline = selectSessionBaseline(retained.filter((each) => !each.invocation_id.startsWith(bound.invocation_id)),
        { family, native_session_id: binding.session_id, source_id: source.id });
    }
    const session = { identity: sessionIdentity, baseline, registered: at === 0, reported: 0,
      reader: openReader({ transcriptPath: binding.transcript_path, sessionId: binding.session_id,
        afterSequence: Number.isSafeInteger(baseline?.end_snapshot?.sequence) ? baseline.end_snapshot.sequence : 0 }),
      writer: createNativeUsageCheckpointWriter({ recordsDir, invocationId: sessionIdentity.invocation_id, now,
        onWritten: () => writeRunUsageTotal(recordsDir) }) };
    sessions.set(binding.session_id, session);
    return session;
  }

  async function register(session) {
    if (session.registered || recordsDir === null) return;
    session.registered = true;
    await registerNativeUsageLaunch(recordsDir, { ...session.identity, family });
  }

  async function checkpoint() {
    try {
      bound ??= bindNativeUsageIdentity(identity);
      const read = await readSessionBindings(bindingPath, { rewrite: false });
      if (!read.ok) return;
      for (const [at, binding] of read.bindings.entries()) {
        const session = await sessionFor(binding, at);
        const usage = await session.reader.advance();
        const reported = usage.ok ? usage.facts.snapshots.at(-1)?.sequence ?? 0 : 0;
        if (reported === 0 || reported === session.reported) continue;
        session.reported = reported;
        await register(session);

        const provisional = buildNativeUsageRecord({ family, source, identity: session.identity, resumed: binding.resumed,
          facts: usage.facts, stream: usage.stream, drained: false, baseline: session.baseline, causes: [], startedAt, now });
        session.writer.offer(() => provisional);
      }
    } catch {

    }
  }

  async function settle({ exit = null } = {}) {
    try {
      bound ??= bindNativeUsageIdentity(identity);
      const read = await readSessionBindings(bindingPath);
      const bindings = read.ok ? read.bindings : [null];
      const settled = [];
      for (const [at, binding] of bindings.entries()) {
        const session = binding === null ? null : await sessionFor(binding, at);
        if (session !== null) await register(session);
        const causes = [];
        let facts = emptyFacts(source);
        let stream = { complete: false, records: 0, diagnostics: 0 };
        if (binding === null) {
          causes.push({ code: read.cause, quantity: null, detail: null });
        } else {
          const usage = await session.reader.advance({ final: true });
          if (usage.ok) ({ facts, stream } = usage);
          else causes.push({ code: usage.cause, quantity: null, detail: null });
        }
        const incomplete = incompleteCause(bound);
        if (incomplete !== null) causes.push({ code: incomplete, quantity: null, detail: null });
        const record = buildNativeUsageRecord({ family, source, identity: session?.identity ?? bound,
          resumed: binding === null ? null : binding.resumed, facts, stream, drained: stream.complete === true,
          damaged: incomplete !== null, baseline: session?.baseline ?? null, exit, causes, startedAt, now });

        await session?.writer.close();
        const retention = recordsDir === null
          ? { ok: false, cause: { code: "usage_records_dir_unresolved", errno: null, detail: null } }
          : await writeNativeUsageRecord(recordsDir, record);
        if (retention.ok) await session?.writer.retire();
        settled.push({ record, retention });
      }

      for (const session of sessions.values()) await session.writer.close();
      await writeRunUsageTotal(recordsDir);
      return { record: settled[0].record, retention: settled.find((each) => !each.retention.ok)?.retention ?? settled[0].retention,
        records: settled.map((each) => each.record) };
    } catch {
      return failed("usage_capture_settle_failed");
    }
  }

  return Object.freeze({ checkpoint, settle });
}

export function prepareSessionUsageLaunch({ family, hook, checkpointHook = null, track, workspaceDir, env = process.env,
  identity = {}, bindingDir, begun = null } = {}) {
  const invocationId = begun?.invocation_id ?? `INV-${randomUUID()}`;
  const unprepared = (code) => ({ invocation_id: invocationId, records_dir: null, binding_path: null, usageHook: null,
    tap: null, cause: { code } });
  if (typeof bindingDir !== "string" || !path.isAbsolute(bindingDir)) return unprepared("usage_session_binding_unprepared");
  try {
    const records = begun?.task ?? resolveNativeUsageTask({ workspaceDir, env, invocationId });
    const recordsDir = records.ok ? records.task_dir : null;
    const recordsRoot = records.ok ? records.records_root : null;

    const bound = bindNativeUsageIdentity({ ...Object.fromEntries(Object.entries(identity ?? {})
      .map(([key, value]) => [key, typeof value === "string" && value !== "" ? value : null])), invocation_id: invocationId,
    parent_invocation_id: records.ok ? records.parent_invocation_id : null });
    const bindingPath = path.join(bindingDir, `${invocationId}.usage-session.json`);
    const signalPath = checkpointHook !== null && recordsDir !== null
      ? path.join(bindingDir, `${invocationId}.usage-signal`) : null;
    const startedAt = new Date().toISOString();
    const tracker = track({ identity: bound, bindingPath, recordsDir, recordsRoot, startedAt });
    let settlement = null;
    let registration = null;

    let round = null;
    let again = false;
    const signal = () => {
      if (settlement !== null) return;
      if (round !== null) {
        again = true;
        return;
      }
      round = Promise.resolve(registration).then(() => tracker.checkpoint()).then(() => {
        round = null;
        if (again) {
          again = false;
          signal();
        }
      });
    };
    let watcher = null;
    const watchSignals = () => {
      if (signalPath === null || watcher !== null) return;
      try {

        closeSync(openSync(signalPath, "a", 0o600));
        watcher = watch(signalPath, { persistent: false }, signal);
        watcher.on("error", () => {});
        signal();
      } catch {

      }
    };
    const tap = Object.freeze({
      family,
      recordsDir,

      started: () => {
        registration ??= registerNativeUsageLaunch(recordsDir, { ...bound, family })
          .then(async (result) => { await writeRunUsageTotal(recordsDir); return result; });
        watchSignals();
      },
      bind: () => {},
      push: () => {},
      events: () => 0,
      end: () => {},
      settle: (observation) => (settlement ??= (async () => {
        try {
          watcher?.close();
        } catch {

        }
        await registration;
        await round;
        return tracker.settle({ exit: observation?.exit ?? null });
      })())
    });
    return { invocation_id: invocationId, records_dir: recordsDir, task_id: records.ok ? records.task_id : null,
      binding_path: bindingPath,
      usageHook: { ...hook, command: buildSessionUsageHookCommand(bindingPath),
        ...(signalPath === null ? {} : { checkpoint: { event: checkpointHook.event, timeoutSec: checkpointHook.timeoutSec,
          command: buildSessionUsageSignalCommand(signalPath) } }) },
      tap, cause: records.ok ? null : { code: records.cause.code } };
  } catch {
    return unprepared("usage_capture_unprepared");
  }
}
