

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, openSync, readFileSync, closeSync, readSync,
  symlinkSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";

import { copySelectedSource } from "./source-copy.mjs";

const PLAN_SCHEMA_VERSION = "workspace-agent-runner-attempt-plan.v2";
const STATUS_SCHEMA_VERSION = "workspace-agent-runner-attempt-status.v3";

const COMPLETION_UNPUBLISHED_EXIT_CODE = 124;
const COMPLETION_UNPUBLISHED_MARKER = "[attempt-driver] completion frame not published:";
let reported = false;
let unpublished = false;
function report(status, channelBytes = Buffer.alloc(0)) {
  if (reported) return;
  reported = true;
  const header = Buffer.from(`${JSON.stringify({ schema_version: STATUS_SCHEMA_VERSION,
    ...status })}\n`, "utf8");
  const message = Buffer.concat([header, channelBytes]);
  let offset = 0;
  try {
    while (offset < message.length) offset += writeSync(3, message, offset);
  } catch (error) {
    unpublished = true;
    try {
      writeSync(2, `${COMPLETION_UNPUBLISHED_MARKER} ${JSON.stringify({
        error: error?.code ?? error?.message ?? String(error), written_bytes: offset,
        frame_bytes: message.length })}\n`);
    } catch {

    }
  }
}

function exit(code) {
  process.exit(unpublished ? COMPLETION_UNPUBLISHED_EXIT_CODE : code);
}

function underPrivateRoot(target, privateRoot) {
  const resolved = path.resolve(target);
  return resolved === privateRoot || resolved.startsWith(`${privateRoot}/`);
}

function privatePath(target, what, privateRoot) {
  if (typeof target !== "string" || !path.isAbsolute(target) ||
      !underPrivateRoot(target, privateRoot)) {
    throw new Error(`${what} outside private scratch: ${target}`);
  }
  return target;
}

let plan;
try {
  plan = JSON.parse(readFileSync(0, "utf8"));
  if (plan?.schema_version !== PLAN_SCHEMA_VERSION) throw new Error("unsupported plan");
} catch (error) {
  report({ phase: "plan_invalid", error: error?.message ?? String(error), channel: null });
  exit(125);
}

const channel = plan.channel ?? null;
const channelCap = Number.isSafeInteger(plan.channel_cap_bytes) ? plan.channel_cap_bytes : 0;
const privateRoot = typeof plan.scratch_root === "string" ? path.resolve(plan.scratch_root) : "";
if (privateRoot !== "/agent-validation-tmp" && !privateRoot.startsWith("/tmp/")) {
  report({ phase: "plan_invalid", error: "invalid scratch root", channel: null });
  exit(125);
}

try {
  for (const directory of plan.directories ?? []) {
    mkdirSync(privatePath(directory, "directory", privateRoot), { recursive: true });
  }
  for (const copy of plan.copies ?? []) {

    copySelectedSource({ from: copy.from, to: privatePath(copy.to, "copy destination", privateRoot),
      entries: copy.entries });
  }
  for (const link of plan.links ?? []) {
    symlinkSync(link.target, privatePath(link.path, "link", privateRoot));
  }
  for (const file of plan.writes ?? []) {
    const target = privatePath(file.path, "write", privateRoot);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, Buffer.from(file.content_base64, "base64"), { mode: file.mode ?? 0o600 });
  }
  if (channel?.kind === "file") {
    writeFileSync(privatePath(channel.path, "channel", privateRoot), "", { mode: 0o600 });
  }
} catch (error) {
  report({ phase: "working_copy_failed", error: error?.message ?? String(error), channel: null });
  exit(125);
}

const FILE_CHUNK_BYTES = 64 * 1024;

function measureChannelFile() {
  const fd = openSync(channel.path, "r");
  try {
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(FILE_CHUNK_BYTES);
    let bytes = 0;
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
      bytes += read;
    }
    return { kind: "file", bytes, sha256: hash.digest("hex") };
  } finally {
    closeSync(fd);
  }
}

const pipeChunks = [];
let pipeBytes = 0;
let pipeOverflow = false;
const child = spawn(plan.exec.command, plan.exec.args, {
  cwd: plan.exec.cwd,
  env: process.env,
  stdio: ["ignore", "inherit", "inherit", channel?.kind === "fd" ? "pipe" : "ignore"],
  shell: false
});
if (channel?.kind === "fd") {
  child.stdio[3].on("data", (chunk) => {
    pipeBytes += chunk.length;
    if (pipeOverflow) return;
    if (pipeBytes > channelCap) {
      pipeOverflow = true;
      pipeChunks.length = 0;
      return;
    }
    pipeChunks.push(chunk);
  });
}
let spawnError = null;
child.on("error", (error) => {
  spawnError = error;
});
child.on("close", (code, signal) => {
  if (spawnError !== null && code === null) {
    report({ phase: "spawn_failed", error: spawnError.code ?? spawnError.message, channel: null });
    exit(126);
  }
  let declared = null;
  let relayed = Buffer.alloc(0);
  if (channel?.kind === "fd") {
    relayed = pipeOverflow ? relayed : Buffer.concat(pipeChunks);
    declared = { kind: "fd", bytes: relayed.length, overflow: pipeOverflow,
      sha256: pipeOverflow ? null : createHash("sha256").update(relayed).digest("hex") };
  } else if (channel?.kind === "file") {
    try {
      declared = measureChannelFile();
    } catch (error) {
      declared = { kind: "file", error: String(error?.code ?? error?.message ?? error).slice(0, 128) };
    }
  }
  report({ phase: "exited", exit_code: code, signal, channel: declared }, relayed);
  exit(code ?? 128);
});
