
import path from "node:path";
import { lstat, readdir, readFile, rm } from "node:fs/promises";

import { writeJsonAtomic } from "./filesystem.mjs";
import {
  AGENT_RUN_USAGE_RECORD_SCHEMA_VERSION,
  NATIVE_USAGE_INVOCATION_ID_PATTERN
} from "./native-usage-capture.mjs";

export const AGENT_RUN_USAGE_CHECKPOINT_SCHEMA_VERSION = "agent-run-usage-checkpoint.v1";
export const NATIVE_USAGE_CHECKPOINT_SUFFIX = ".checkpoint.json";

const IDENTITY_KEYS = ["invocation_id", "attempt_id", "run_id", "parent_invocation_id", "repo", "subject",
  "role", "route", "mode"];

const pendingQuantity = (quantity) => (typeof quantity?.observed === "number" && quantity.status !== "unavailable"
  ? { value: null, observed: quantity.observed, status: "partial" }
  : { value: null, observed: null, status: "unavailable" });

export function buildNativeUsageCheckpoint(provisional, { sequence, now = () => new Date() } = {}) {
  if (provisional?.schema_version !== AGENT_RUN_USAGE_RECORD_SCHEMA_VERSION
      || typeof provisional.invocation_id !== "string" || typeof provisional.native_session_id !== "string") {
    return null;
  }
  const tokens = Object.fromEntries(Object.entries(provisional.tokens ?? {}).map(([name, quantity]) => [name, pendingQuantity(quantity)]));
  const checkpoint = { schema_version: AGENT_RUN_USAGE_CHECKPOINT_SCHEMA_VERSION, state: "pending", sequence,
    checkpointed_at: now().toISOString() };
  for (const key of IDENTITY_KEYS) checkpoint[key] = provisional[key] ?? null;
  return Object.assign(checkpoint, {
    family: provisional.family,
    client_version: provisional.client_version ?? null,
    native_session_id: provisional.native_session_id,
    source: provisional.source,
    resumed: provisional.resumed ?? null,
    status: tokens.total?.status === "partial" ? "partial" : "unavailable",
    tokens,
    cost: { ...provisional.cost, amount: pendingQuantity(provisional.cost?.amount) },
    peak_context: pendingQuantity(provisional.peak_context),
    causes: (provisional.causes ?? []).map((cause) => ({ code: cause.code, quantity: cause.quantity ?? null })),
    started_at: provisional.started_at ?? null
  });
}

async function isRealDirectory(dir) {
  const stats = await lstat(dir);
  return stats.isDirectory() && !stats.isSymbolicLink();
}

export function createNativeUsageCheckpointWriter({ recordsDir, invocationId, now = () => new Date(), onWritten = null } = {}) {
  const usable = typeof recordsDir === "string" && recordsDir !== "" && typeof invocationId === "string"
    && NATIVE_USAGE_INVOCATION_ID_PATTERN.test(invocationId);
  const target = usable ? path.join(recordsDir, `${invocationId}${NATIVE_USAGE_CHECKPOINT_SUFFIX}`) : null;
  const stats = { written: 0, failed: 0, replaced: 0 };
  let closed = !usable;
  let waiting = null;
  let running = null;
  let sequence = 0;

  async function writeOne(build) {
    try {
      const provisional = await build();
      if (provisional === null || provisional === undefined) return;
      if (provisional.invocation_id !== invocationId || !(await isRealDirectory(recordsDir))) {
        stats.failed += 1;
        return;
      }
      const checkpoint = buildNativeUsageCheckpoint(provisional, { sequence: sequence + 1, now });
      if (checkpoint === null) return;
      await writeJsonAtomic(target, checkpoint, { mode: 0o600 });
      sequence += 1;
      stats.written += 1;
      if (typeof onWritten === "function") await onWritten();
    } catch {
      stats.failed += 1;
    }
  }

  function pump() {
    running = (async () => {
      while (waiting !== null && !closed) {
        const build = waiting;
        waiting = null;
        await writeOne(build);
      }
    })().then(() => {
      running = null;
      if (waiting !== null && !closed) pump();
    });
  }

  return Object.freeze({
    offer(build) {
      if (closed || typeof build !== "function") return false;
      if (waiting !== null) stats.replaced += 1;
      waiting = build;
      if (running === null) pump();
      return true;
    },
    async close() {
      closed = true;
      waiting = null;
      await running;
    },
    async retire() {
      closed = true;
      waiting = null;
      await running;
      if (target !== null) await rm(target, { force: true }).catch(() => {});
    },
    stats: () => ({ ...stats })
  });
}

export async function readNativeUsageCheckpoints(dir) {
  const result = { checkpoints: [], unreadable: [] };
  let names;
  try {
    if (!(await isRealDirectory(dir))) return result;
    names = (await readdir(dir)).filter((name) => name.endsWith(NATIVE_USAGE_CHECKPOINT_SUFFIX)).sort();
  } catch {
    return result;
  }
  for (const name of names) {
    try {
      const checkpoint = JSON.parse(await readFile(path.join(dir, name), "utf8"));
      const quantities = [...Object.values(checkpoint?.tokens ?? {}), checkpoint?.cost?.amount, checkpoint?.peak_context];
      if (checkpoint?.schema_version === AGENT_RUN_USAGE_CHECKPOINT_SCHEMA_VERSION && checkpoint.state === "pending"
          && `${checkpoint.invocation_id}${NATIVE_USAGE_CHECKPOINT_SUFFIX}` === name
          && (checkpoint.status === "partial" || checkpoint.status === "unavailable")
          && quantities.every((quantity) => quantity?.status !== "complete" && (quantity?.value ?? null) === null)) {
        result.checkpoints.push(checkpoint);
      } else {
        result.unreadable.push({ file: name, code: "usage_checkpoint_invalid" });
      }
    } catch {
      result.unreadable.push({ file: name, code: "usage_checkpoint_unreadable" });
    }
  }
  return result;
}
