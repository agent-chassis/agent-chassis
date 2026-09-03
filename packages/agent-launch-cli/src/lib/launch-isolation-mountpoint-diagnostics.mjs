

import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";

export const MOUNTPOINT_DIAGNOSTICS_SCHEMA_VERSION =
  "agent_launch.isolation.mountpoint_diagnostics.v1";

const MAX_ENTRIES = 24;
const MAX_NAME_CHARS = 128;
const MAX_MOUNT_LINES = 8;
const MAX_TARGET_CHARS = 512;

function boundString(value, limit) {
  if (typeof value !== "string") return null;
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function fileKind(stats) {
  if (stats.isSymbolicLink()) return "symlink";
  if (stats.isDirectory()) return "directory";
  if (stats.isFile()) return "file";
  if (stats.isBlockDevice()) return "block_device";
  if (stats.isCharacterDevice()) return "character_device";
  if (stats.isFIFO()) return "fifo";
  if (stats.isSocket()) return "socket";
  return "unknown";
}

function octalMode(stats) {
  return `0${(stats.mode & 0o7777).toString(8).padStart(4, "0").slice(-4)}`;
}

function describeImmediateEntries(target) {
  let names;
  try {
    names = readdirSync(target);
  } catch (error) {
    return { available: false, errno: error?.code ?? null, total: null, entries: [] };
  }
  const sorted = [...names].sort();
  const entries = [];
  for (const name of sorted.slice(0, MAX_ENTRIES)) {
    let stats;
    try {
      stats = lstatSync(path.join(target, name));
    } catch (error) {
      entries.push({ name: boundString(name, MAX_NAME_CHARS), kind: "unreadable", mode: null, errno: error?.code ?? null });
      continue;
    }
    entries.push({
      name: boundString(name, MAX_NAME_CHARS),
      kind: fileKind(stats),
      mode: octalMode(stats),
      uid: stats.uid,
      gid: stats.gid
    });
  }
  return {
    available: true,
    errno: null,
    total: sorted.length,
    truncated: sorted.length > MAX_ENTRIES,
    entries
  };
}

function describeMountInfo(target) {
  let raw;
  try {
    raw = readFileSync("/proc/self/mountinfo", "utf8");
  } catch (error) {
    return { available: false, errno: error?.code ?? null, lines: [] };
  }
  const matches = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const fields = line.split(" ");
    const mountPoint = fields[4];
    if (typeof mountPoint !== "string") continue;
    if (mountPoint === target || target.startsWith(`${mountPoint}${path.sep}`) || mountPoint.startsWith(`${target}${path.sep}`)) {
      matches.push({
        mount_point: boundString(mountPoint, MAX_TARGET_CHARS),

        root: boundString(fields[3] ?? null, MAX_TARGET_CHARS),
        options: boundString(fields[5] ?? null, MAX_NAME_CHARS),
        exact: mountPoint === target
      });
    }
  }

  matches.sort((left, right) => right.mount_point.length - left.mount_point.length);
  return {
    available: true,
    errno: null,
    truncated: matches.length > MAX_MOUNT_LINES,
    lines: matches.slice(0, MAX_MOUNT_LINES)
  };
}

export function describeRefusedMountpoint(target, { role = null, phase = null, code = null, message = null } = {}) {
  const facts = {
    schema_version: MOUNTPOINT_DIAGNOSTICS_SCHEMA_VERSION,
    path: boundString(target, MAX_TARGET_CHARS),

    role,
    lifecycle_phase: phase,
    refusal_code: code,
    refusal_message: boundString(message, MAX_TARGET_CHARS)
  };
  let stats = null;
  try {
    stats = lstatSync(target);
  } catch (error) {
    return Object.freeze({ ...facts, exists: false, errno: error?.code ?? null });
  }
  facts.exists = true;
  facts.kind = fileKind(stats);
  facts.mode = octalMode(stats);
  facts.uid = stats.uid;
  facts.gid = stats.gid;
  facts.nlink = stats.nlink;
  facts.dev = String(stats.dev);
  facts.ino = String(stats.ino);
  if (stats.isSymbolicLink()) {
    try {
      facts.symlink_target = boundString(readlinkSync(target), MAX_TARGET_CHARS);
    } catch (error) {
      facts.symlink_target = null;
      facts.symlink_errno = error?.code ?? null;
    }
  }
  try {
    const real = realpathSync(target);
    facts.realpath = boundString(real, MAX_TARGET_CHARS);
    facts.redirected = real !== target;
  } catch (error) {
    facts.realpath = null;
    facts.realpath_errno = error?.code ?? null;
  }
  facts.directory = stats.isDirectory() && !stats.isSymbolicLink()
    ? describeImmediateEntries(target)
    : { available: false, errno: null, total: null, entries: [] };
  facts.mount_info = describeMountInfo(target);
  return Object.freeze(facts);
}

export function safeDescribeRefusedMountpoint(target, context) {
  try {
    return describeRefusedMountpoint(target, context);
  } catch (error) {
    return Object.freeze({
      schema_version: MOUNTPOINT_DIAGNOSTICS_SCHEMA_VERSION,
      path: boundString(target, MAX_TARGET_CHARS),
      collection_failed: true,
      collection_error: boundString(error?.message ?? String(error), MAX_NAME_CHARS)
    });
  }
}
