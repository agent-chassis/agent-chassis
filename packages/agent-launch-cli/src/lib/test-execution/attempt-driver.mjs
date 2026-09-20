

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, openSync, readFileSync, closeSync, fstatSync, readSync,
  symlinkSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";

const PLAN_SCHEMA_VERSION = "workspace-agent-runner-attempt-plan.v2";
const STATUS_SCHEMA_VERSION = "workspace-agent-runner-attempt-status.v2";
let reported = false;
function report(status, channelBytes = Buffer.alloc(0)) {
  if (reported) return;
  reported = true;
  const header = Buffer.from(`${JSON.stringify({ schema_version: STATUS_SCHEMA_VERSION,
    ...status })}\n`, "utf8");
  const message = Buffer.concat([header, channelBytes]);
  try {
    let offset = 0;
    while (offset < message.length) offset += writeSync(3, message, offset);
  } catch {

  }
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
  process.exit(125);
}

const channel = plan.channel ?? null;
const channelCap = Number.isSafeInteger(plan.channel_cap_bytes) ? plan.channel_cap_bytes : 0;
const privateRoot = typeof plan.scratch_root === "string" ? path.resolve(plan.scratch_root) : "";
if (privateRoot !== "/agent-validation-tmp" && !privateRoot.startsWith("/tmp/")) {
  report({ phase: "plan_invalid", error: "invalid scratch root", channel: null });
  process.exit(125);
}

try {
  for (const directory of plan.directories ?? []) {
    mkdirSync(privatePath(directory, "directory", privateRoot), { recursive: true });
  }
  for (const copy of plan.copies ?? []) {

    const excluded = new Set(copy.exclude ?? []);
    cpSync(copy.from, privatePath(copy.to, "copy destination", privateRoot), { recursive: true,
      verbatimSymlinks: true, errorOnExist: false,
      filter: (source) => !excluded.has(path.relative(copy.from, source).split(path.sep).join("/")) });
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
  process.exit(125);
}

function channelResult(bytes, overflow) {
  return { kind: channel.kind, bytes: overflow ? 0 : bytes.length, overflow,
    sha256: overflow ? null : createHash("sha256").update(bytes).digest("hex") };
}

function readChannelFile() {
  const fd = openSync(channel.path, "r");
  try {
    const size = fstatSync(fd).size;
    if (size > channelCap) return { bytes: Buffer.alloc(0), overflow: true };
    const buffer = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const read = readSync(fd, buffer, offset, size - offset, offset);
      if (read === 0) break;
      offset += read;
    }
    return { bytes: buffer.subarray(0, offset), overflow: false };
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
    process.exit(126);
  }
  let relayed = { bytes: Buffer.alloc(0), overflow: false };
  let channelError = null;
  try {
    if (channel?.kind === "fd") relayed = { bytes: Buffer.concat(pipeChunks), overflow: pipeOverflow };
    else if (channel?.kind === "file") relayed = readChannelFile();
  } catch (error) {
    channelError = error?.code ?? error?.message ?? String(error);
  }
  report({ phase: "exited", exit_code: code, signal,
    channel: channel === null ? null : channelError !== null
      ? { kind: channel.kind, bytes: 0, overflow: false, sha256: null, error: channelError }
      : channelResult(relayed.bytes, relayed.overflow) },
  channel === null || channelError !== null || relayed.overflow ? Buffer.alloc(0) : relayed.bytes);
  process.exit(code ?? 128);
});
