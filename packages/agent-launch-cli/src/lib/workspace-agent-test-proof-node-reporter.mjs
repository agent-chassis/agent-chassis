import { createHash, randomBytes } from "node:crypto";
import { writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { captureTestFailureDiagnostic } from
  "./workspace-agent-test-proof-error-diagnostic.mjs";

const SCHEMA_VERSION = "workspace-agent-test-proof-node-events.v1";
const EVENT_TYPES = new Set(["test:coverage", "test:fail", "test:pass", "test:summary"]);
const RUNTIME_NODE_EVENT_TYPES = new Set(["test:enqueue", "test:dequeue", "test:start", "test:pass",
  "test:fail", "test:complete"]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(
    (key) => [key, canonicalize(value[key])]
  ));
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")}`;
}

export function stableRuntimeTestId(testIdentity) {
  if (typeof testIdentity !== "string" || testIdentity.length === 0) {
    throw new TypeError("test identity must be a nonempty string");
  }
  return `test-${createHash("sha256").update(testIdentity, "utf8").digest("hex")}`;
}

export function canonicalRuntimeTestIdentity({ file, name, nesting } = {}) {
  if (file !== null && (typeof file !== "string" || file.length === 0 ||
      path.posix.isAbsolute(file) || file.includes("\\") || file.split("/").some(
        (part) => part === "" || part === "." || part === ".."
      ))) return null;
  if (name !== null && (typeof name !== "string" || name.length === 0)) return null;
  if (nesting !== null && (!Number.isSafeInteger(nesting) || nesting < 0)) return null;
  return `${file ?? "<unknown-file>"} :: ${nesting ?? "<unknown-nesting>"} :: ${
    name ?? "<unnamed>"
  }`;
}

export function stableRuntimeTestIdFromParts(parts) {
  const identity = canonicalRuntimeTestIdentity(parts);
  return identity === null ? null : stableRuntimeTestId(identity);
}

export function relativeRuntimeTestFile(file, workingDirectory = process.cwd()) {
  if (typeof file !== "string" || file.length === 0) return null;
  if (file.startsWith("data:text/javascript")) return `runtime-module-${
    createHash("sha256").update(file, "utf8").digest("hex")
  }`;
  let sourcePath = file;
  if (file.startsWith("file:")) {
    try { sourcePath = fileURLToPath(file); } catch { return null; }
  }
  const root = path.resolve(workingDirectory);
  const absolute = path.isAbsolute(sourcePath)
    ? path.resolve(sourcePath)
    : path.resolve(root, sourcePath);
  const relative = path.relative(root, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join("/");
}

function errorCodes(error, result = new Set(), seen = new Set()) {
  if (error === null || typeof error !== "object" || seen.has(error)) return result;
  seen.add(error);
  if (typeof error.code === "string" && /^[A-Za-z0-9._-]{1,160}$/u.test(error.code)) {
    result.add(error.code);
  }
  errorCodes(error.cause, result, seen);
  if (Array.isArray(error.errors)) for (const child of error.errors) {
    errorCodes(child, result, seen);
  }
  return result;
}

function recordRuntimeNode(nodes, event) {
  if (!RUNTIME_NODE_EVENT_TYPES.has(event?.type)) return;
  const data = event.data;
  if (typeof data?.file !== "string" || !Number.isSafeInteger(data.testId)) return;
  const key = `${data.file}\u0000${data.testId}`;
  const fact = { name: data.name, nesting: data.nesting, parent_id: data.parentId,
    type: data.type ?? data.details?.type ?? null };
  const prior = nodes.get(key);
  if (prior === undefined) {
    nodes.set(key, fact);
    return;
  }
  if (prior.conflict === true || prior.name !== fact.name || prior.nesting !== fact.nesting ||
      prior.parent_id !== fact.parent_id ||
      (prior.type !== null && fact.type !== null && prior.type !== fact.type)) {
    nodes.set(key, { conflict: true });
    return;
  }
  if (prior.type === null) prior.type = fact.type;
}

function ancestorTestIds(nodes, data, file) {
  if (typeof data?.file !== "string" || !Number.isSafeInteger(data.testId) ||
      !Number.isSafeInteger(data.parentId) ||
      nodes.get(`${data.file}\u0000${data.testId}`)?.conflict === true) return null;
  const ancestors = [];
  const visited = new Set([data.testId]);
  let parentId = data.parentId;
  for (;;) {
    const node = nodes.get(`${data.file}\u0000${parentId}`);
    if (node === undefined) return ancestors;
    if (node.conflict === true || visited.has(parentId) ||
        !Number.isSafeInteger(node.parent_id)) return null;
    visited.add(parentId);
    if (node.type === "test") {
      const id = stableRuntimeTestIdFromParts({ file,
        name: typeof node.name === "string" ? node.name : null,
        nesting: Number.isInteger(node.nesting) ? node.nesting : null });
      if (id === null) return null;
      ancestors.unshift(id);
    }
    parentId = node.parent_id;
  }
}

function projectEvent(event, nodes) {
  if (!EVENT_TYPES.has(event?.type)) return null;
  if (event.type === "test:coverage") {
    const cwd = event.data?.summary?.workingDirectory ?? process.cwd();
    return {
      type: event.type,
      files: (event.data?.summary?.files ?? []).map((file) => ({
        path: relativeRuntimeTestFile(file.path, cwd),
        covered_line_count: file.coveredLineCount ?? 0,
        functions: (file.functions ?? []).map(({ name, count }) => ({ name, count }))
          .filter(({ name }) => typeof name === "string").sort(
            (left, right) => left.name.localeCompare(right.name)
          )
      })).filter(({ path }) => path !== null).sort(
        (left, right) => left.path.localeCompare(right.path)
      )
    };
  }
  if (event.type === "test:summary") return {
    type: event.type,
    counts: {
      passed: event.data?.counts?.passed ?? 0,
      failed: event.data?.counts?.failed ?? 0,
      skipped: event.data?.counts?.skipped ?? 0,
      cancelled: event.data?.counts?.cancelled ?? 0,
      todo: event.data?.counts?.todo ?? 0,
      tests: event.data?.counts?.tests ?? 0
    }
  };
  if (event.data?.details?.type !== "test") return null;
  const file = relativeRuntimeTestFile(event.data?.file);
  const name = typeof event.data?.name === "string" ? event.data.name : null;
  const nesting = Number.isInteger(event.data?.nesting) ? event.data.nesting : null;
  return {
    type: event.type,
    test_id: stableRuntimeTestIdFromParts({ file, name, nesting }),
    name,
    file,
    nesting,
    ancestor_test_ids: ancestorTestIds(nodes, event.data, file),
    status: event.data?.skip !== undefined ? "skipped"
      : event.data?.todo !== undefined ? "todo"
        : event.type === "test:fail" ? "failed" : "passed",
    ...(event.type === "test:fail"
      ? {
          error_codes: [...errorCodes(event.data?.details?.error)].sort(),
          failure_diagnostic: captureTestFailureDiagnostic(event.data?.details?.error)
        }
      : {})
  };
}

export default async function* launcherTestProofReporter(source) {
  const events = [];
  const nodes = new Map();
  for await (const event of source) {
    recordRuntimeNode(nodes, event);
    const projected = projectEvent(event, nodes);
    if (projected !== null) events.push(projected);
  }
  const payload = { schema_version: SCHEMA_VERSION, events };

  const reporterNonce = randomBytes(32).toString("hex");
  const envelope = `${JSON.stringify({
    ...payload,
    event_digest: digest(payload),
    reporter_nonce: reporterNonce,
    reporter_attestation: digest({ ...payload, reporter_nonce: reporterNonce })
  })}\n`;
  const protocolFd = new URL(import.meta.url).searchParams.get("launcher_protocol_fd");
  if (protocolFd === "3") {
    const bytes = Buffer.from(envelope, "utf8");
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(
      3, bytes, offset, bytes.length - offset
    );
    return;
  }
  yield envelope;
}
