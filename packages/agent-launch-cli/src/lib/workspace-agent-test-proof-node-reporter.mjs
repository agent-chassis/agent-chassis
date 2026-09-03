import { createHash, randomBytes } from "node:crypto";
import { writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = "workspace-agent-test-proof-node-events.v1";
const EVENT_TYPES = new Set(["test:coverage", "test:fail", "test:pass", "test:summary"]);

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

function projectEvent(event) {
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
    status: event.data?.skip !== undefined ? "skipped"
      : event.data?.todo !== undefined ? "todo"
        : event.type === "test:fail" ? "failed" : "passed",
    ...(event.type === "test:fail"
      ? { error_codes: [...errorCodes(event.data?.details?.error)].sort() }
      : {})
  };
}

export default async function* launcherTestProofReporter(source) {
  const events = [];
  for await (const event of source) {
    const projected = projectEvent(event);
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
