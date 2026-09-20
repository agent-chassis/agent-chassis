import { spawn } from "node:child_process";

const COMPLETE_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const OBJECT_TYPES = new Set(["blob", "commit", "tag", "tree"]);

export class SidecarCommittedBlobReadError extends Error {
  constructor(message, { code, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "SidecarCommittedBlobReadError";
    this.code = code;
  }
}

function failMalformed(message) {
  throw new SidecarCommittedBlobReadError(message, { code: "malformed_batch_output" });
}

function normalizeObjectIds(objectIds) {
  if (!Array.isArray(objectIds)) {
    throw new SidecarCommittedBlobReadError("committed blob objectIds must be an array", {
      code: "invalid_object_id"
    });
  }
  const normalized = [];
  const seen = new Set();
  for (const objectId of objectIds) {
    if (typeof objectId !== "string" || !COMPLETE_OBJECT_ID.test(objectId)) {
      throw new SidecarCommittedBlobReadError(
        "committed blob objectIds must contain only complete hexadecimal object IDs",
        { code: "invalid_object_id" }
      );
    }
    const oid = objectId.toLowerCase();
    if (!seen.has(oid)) {
      seen.add(oid);
      normalized.push(oid);
    }
  }
  return normalized;
}

function readHeader(buffer, offset) {
  const headerEnd = buffer.indexOf(0x0a, offset);
  if (headerEnd === -1) failMalformed("Git batch output ended before a complete header");
  const headerBytes = buffer.subarray(offset, headerEnd);
  for (const byte of headerBytes) {
    if (byte > 0x7f || byte === 0x0d) {
      failMalformed("Git batch output contains a non-ASCII header");
    }
  }
  return { header: headerBytes.toString("ascii"), offset: headerEnd + 1 };
}

export function parseCommittedBlobBatch(buffer, objectIds) {
  if (!Buffer.isBuffer(buffer)) failMalformed("Git batch output must be a Buffer");
  const expectedIds = normalizeObjectIds(objectIds);
  const results = new Map();
  let offset = 0;

  for (const expectedId of expectedIds) {
    const parsed = readHeader(buffer, offset);
    offset = parsed.offset;
    const missing = parsed.header.match(/^([0-9a-fA-F]{40}|[0-9a-fA-F]{64}) missing$/);
    if (missing) {
      if (missing[1].toLowerCase() !== expectedId) {
        failMalformed("Git batch output object identity does not match the request");
      }
      results.set(expectedId, { state: "unavailable", reason: "missing_object" });
      continue;
    }

    const available = parsed.header.match(
      /^([0-9a-fA-F]{40}|[0-9a-fA-F]{64}) ([a-z]+) (0|[1-9][0-9]*)$/
    );
    if (!available || available[1].toLowerCase() !== expectedId ||
        !OBJECT_TYPES.has(available[2])) {
      failMalformed("Git batch output has an invalid identity, type, or size header");
    }
    const size = Number(available[3]);
    if (!Number.isSafeInteger(size)) failMalformed("Git batch output object size is not safe");
    const contentEnd = offset + size;
    if (!Number.isSafeInteger(contentEnd) || contentEnd >= buffer.length) {
      failMalformed("Git batch output ended before the framed object was complete");
    }
    if (buffer[contentEnd] !== 0x0a) {
      failMalformed("Git batch output object is missing its trailing LF");
    }
    const bytes = Buffer.from(buffer.subarray(offset, contentEnd));
    results.set(expectedId, available[2] === "blob"
      ? { state: "available", bytes }
      : { state: "unavailable", reason: "not_blob" });
    offset = contentEnd + 1;
  }

  if (offset !== buffer.length) failMalformed("Git batch output contains extra bytes or frames");
  return results;
}

function runCommittedBlobBatch(repoRoot, objectIds) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      ["-C", repoRoot, "--no-replace-objects", "cat-file", "--batch"],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    const stdout = [];
    const stderr = [];
    let settled = false;
    const fail = (message, cause = null) => {
      if (settled) return;
      settled = true;
      reject(new SidecarCommittedBlobReadError(message, { code: "git_failed", cause }));
    };
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (cause) => fail("Git committed-blob reader failed to start", cause));
    child.stdin.on("error", (cause) => {
      if (cause?.code !== "EPIPE") fail("Git committed-blob reader input failed", cause);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      if (code !== 0) {
        fail(`Git committed-blob reader exited unsuccessfully (${code ?? signal}): ${Buffer
          .concat(stderr).toString("utf8").trim()}`);
        return;
      }
      settled = true;
      resolve(Buffer.concat(stdout));
    });
    child.stdin.end(`${objectIds.join("\n")}\n`);
  });
}

export async function readCommittedBlobBytes({ repoRoot, objectIds }) {
  const normalizedIds = normalizeObjectIds(objectIds);
  if (normalizedIds.length === 0) return new Map();
  const output = await runCommittedBlobBatch(repoRoot, normalizedIds);
  return parseCommittedBlobBatch(output, normalizedIds);
}
