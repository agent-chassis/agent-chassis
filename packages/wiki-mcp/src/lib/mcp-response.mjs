

import {
  existsSync,
  closeSync,
  openSync,
  mkdirSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export {
  NEXT_CALLS_DESCRIPTOR_VERSION,
  buildNextCall,
  renderNextCall,
  validateNextCalls,
  pickDoThisNext,
  projectNextActionScalar
} from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";

const PROCESS_ERROR_GUARDS_INSTALLED = Symbol.for(
  "agent-chassis.wiki-mcp.process-error-guards-installed"
);

const SPILLED_RESPONSE_SCHEMA_VERSION = "wiki-mcp-spilled-response.v1";
const CONTENT_REFERENCE_READ_SCHEMA_VERSION = "wiki-mcp-content-reference-read.v1";
const CONTENT_REFERENCE_KIND = "wiki_mcp_response_content_reference";
const DEFAULT_INLINE_BYTE_LIMIT = 128 * 1024;
const DEFAULT_PREVIEW_BYTE_LIMIT = 2048;
const MIN_INLINE_BYTE_LIMIT = 8 * 1024;
const MAX_REFERENCE_READ_BYTE_LIMIT = 64 * 1024;
const MAX_CONTENT_DESCRIPTOR_BYTES = 512;
const REF_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

const PATH_REDACTION_PLACEHOLDER = "[redacted absolute path]";

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function resolveStateDir(env = process.env) {
  if (typeof env.WIKI_MCP_RESPONSE_STATE_DIR === "string" && env.WIKI_MCP_RESPONSE_STATE_DIR.length > 0) {
    return path.resolve(env.WIKI_MCP_RESPONSE_STATE_DIR);
  }
  if (typeof env.XDG_STATE_HOME === "string" && env.XDG_STATE_HOME.length > 0) {
    return path.join(env.XDG_STATE_HOME, "agent-chassis", "wiki-mcp", "response-spill");
  }
  const home = homedir();
  if (typeof home === "string" && home.length > 0) {
    return path.join(home, ".local", "state", "agent-chassis", "wiki-mcp", "response-spill");
  }
  return path.join(tmpdir(), "agent-chassis", "wiki-mcp", "response-spill");
}

export function getResponseSpillConfig(env = process.env) {
  const inlineByteLimit = Math.max(
    MIN_INLINE_BYTE_LIMIT,
    parsePositiveInteger(env.WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT, DEFAULT_INLINE_BYTE_LIMIT)
  );
  const previewByteLimit = Math.min(
    parsePositiveInteger(env.WIKI_MCP_RESPONSE_PREVIEW_BYTE_LIMIT, DEFAULT_PREVIEW_BYTE_LIMIT),
    Math.max(256, Math.floor(inlineByteLimit / 8))
  );
  const maxReferenceReadBytes = Math.min(
    parsePositiveInteger(env.WIKI_MCP_RESPONSE_REFERENCE_READ_BYTE_LIMIT, Math.floor(inlineByteLimit / 8)),
    MAX_REFERENCE_READ_BYTE_LIMIT,
    Math.max(1, Math.floor(inlineByteLimit / 8))
  );
  return {
    inlineByteLimit,
    previewByteLimit,
    maxReferenceReadBytes,
    stateDir: resolveStateDir(env)
  };
}

function estimateInlineStructuredBytes(jsonText) {

  return Buffer.byteLength(jsonText, "utf8") + 512;
}

function capUtf8Descriptor(text, maxBytes = MAX_CONTENT_DESCRIPTOR_BYTES) {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return text;
  }
  const suffix = "…";
  const contentLimit = Math.max(0, maxBytes - Buffer.byteLength(suffix, "utf8"));
  let result = "";
  let bytes = 0;
  for (const character of text) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > contentLimit) break;
    result += character;
    bytes += characterBytes;
  }
  return `${result}${suffix}`;
}

function referencePathForId(stateDir, refId) {
  if (typeof refId !== "string" || !REF_ID_PATTERN.test(refId)) {
    throw new Error("Invalid MCP content reference id");
  }
  const absolutePath = path.resolve(stateDir, `${refId}.json`);
  const stateRoot = path.resolve(stateDir);
  if (absolutePath !== path.join(stateRoot, path.basename(absolutePath))) {
    throw new Error("Invalid MCP content reference path");
  }
  return absolutePath;
}

function metadataPathForId(stateDir, refId) {
  return `${referencePathForId(stateDir, refId)}.meta.json`;
}

function buildPreview(buffer, previewByteLimit) {
  const previewBuffer = buffer.subarray(0, Math.min(previewByteLimit, buffer.byteLength));
  return {
    text: previewBuffer.toString("utf8"),
    bytes: previewBuffer.byteLength
  };
}

function spillJsonResponse(jsonText, { env = process.env, force = false } = {}) {
  const config = getResponseSpillConfig(env);
  const bytes = Buffer.from(jsonText, "utf8");
  if (!force && estimateInlineStructuredBytes(jsonText) <= config.inlineByteLimit) {
    return null;
  }

  mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const refId = `resp-${Date.now()}-${process.pid}-${randomUUID()}`;
  const absolutePath = referencePathForId(config.stateDir, refId);
  const metadataPath = metadataPathForId(config.stateDir, refId);
  writeFileSync(absolutePath, bytes, { mode: 0o600 });
  writeFileSync(
    metadataPath,
    `${JSON.stringify({
      schema_version: "wiki-mcp-content-reference-metadata.v1",
      ref_id: refId,
      media_type: "application/json",
      encoding: "utf8",
      byte_count: bytes.byteLength,
      sha256,
      created_at: new Date().toISOString()
    }, null, 2)}\n`,
    { mode: 0o600 }
  );

  return {
    schema_version: SPILLED_RESPONSE_SCHEMA_VERSION,
    response_spilled: true,
    reason: "response_exceeds_inline_byte_limit",
    inline_byte_limit: config.inlineByteLimit,
    total_bytes: bytes.byteLength,
    preview: buildPreview(bytes, config.previewByteLimit),
    content_reference: {
      kind: CONTENT_REFERENCE_KIND,
      ref_id: refId,
      media_type: "application/json",
      encoding: "utf8",
      byte_count: bytes.byteLength,
      sha256,
      read_tool: "workspace_read_mcp_content_reference",
      range: {
        offset: 0,
        length: Math.min(config.maxReferenceReadBytes, bytes.byteLength),
        max_length: config.maxReferenceReadBytes
      }
    }
  };
}

export function readSpilledMcpContentReference({ ref_id, offset = 0, length = null }, { env = process.env } = {}) {
  const config = getResponseSpillConfig(env);
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("offset must be a non-negative integer");
  }
  const requestedLength = length ?? config.maxReferenceReadBytes;
  if (!Number.isInteger(requestedLength) || requestedLength < 1) {
    throw new Error("length must be a positive integer");
  }
  if (requestedLength > config.maxReferenceReadBytes) {
    throw new Error(
      `length exceeds max_length ${config.maxReferenceReadBytes}; request smaller ranges and reassemble by offset`
    );
  }

  const absolutePath = referencePathForId(config.stateDir, ref_id);
  if (!existsSync(absolutePath)) {
    throw new Error("MCP content reference not found");
  }
  const metadataPath = metadataPathForId(config.stateDir, ref_id);
  if (!existsSync(metadataPath)) {
    throw new Error("MCP content reference metadata not found");
  }

  const stats = statSync(absolutePath);
  if (!stats.isFile()) {
    throw new Error("MCP content reference is not a file");
  }
  if (offset > stats.size) {
    throw new Error("offset exceeds reference byte_count");
  }

  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  if (metadata.byte_count !== stats.size) {
    throw new Error("MCP content reference metadata byte_count mismatch");
  }
  const bytesToRead = Math.min(requestedLength, Math.max(0, stats.size - offset));
  const chunk = Buffer.alloc(bytesToRead);
  const fd = openSync(absolutePath, "r");
  try {
    if (bytesToRead > 0) {
      readSync(fd, chunk, 0, bytesToRead, offset);
    }
  } finally {
    closeSync(fd);
  }
  const nextOffset = offset + chunk.byteLength;
  return {
    schema_version: CONTENT_REFERENCE_READ_SCHEMA_VERSION,
    ref_id,
    offset,
    requested_length: requestedLength,
    length: chunk.byteLength,
    total_bytes: stats.size,
    eof: nextOffset >= stats.size,
    next_offset: nextOffset >= stats.size ? null : nextOffset,
    max_length: config.maxReferenceReadBytes,
    media_type: metadata.media_type ?? "application/json",
    encoding: "base64",
    source_encoding: metadata.encoding ?? "utf8",
    sha256: metadata.sha256,
    data_base64: chunk.toString("base64")
  };
}

function buildInlineStructuredDescriptor(jsonText) {
  const totalBytes = Buffer.byteLength(jsonText, "utf8");
  return capUtf8Descriptor(
    `MCP result: full machine-readable payload is available in structuredContent (${totalBytes} UTF-8 bytes).`
  );
}

function buildStructuredErrorDescriptor(jsonText) {
  const totalBytes = Buffer.byteLength(jsonText, "utf8");
  return capUtf8Descriptor(
    `MCP tool error: full machine-readable error envelope is available in structuredContent (${totalBytes} UTF-8 bytes).`
  );
}

export function jsonContent(data, { env = process.env, forceSpill = false } = {}) {
  const jsonText = JSON.stringify(data, null, 2);
  const config = getResponseSpillConfig(env);

  if (forceSpill) {
    const spilled = spillJsonResponse(jsonText, { env, force: true });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(spilled, null, 2)
        }
      ],
      structuredContent: spilled
    };
  }

  if (estimateInlineStructuredBytes(jsonText) <= config.inlineByteLimit) {
    return {
      content: [{ type: "text", text: buildInlineStructuredDescriptor(jsonText) }],
      structuredContent: data
    };
  }

  const spilled = spillJsonResponse(jsonText, { env });
  if (spilled) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(spilled, null, 2)
        }
      ],
      structuredContent: spilled
    };
  }
  return {
    content: [{ type: "text", text: buildInlineStructuredDescriptor(jsonText) }],
    structuredContent: data
  };
}

export function guardToolHandler(handler, { name = null, log = null } = {}) {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (typeof log === "function") {
        log({
          level: "error",
          message: "wiki-mcp tool handler threw; returning error result instead of closing transport",
          tool: name,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      return errorContent(error);
    }
  };
}

export function installProcessErrorGuards({ processLike = process, log = null } = {}) {
  if (!processLike || typeof processLike.on !== "function") {
    throw new Error("installProcessErrorGuards requires a process-like object with .on()");
  }
  if (processLike[PROCESS_ERROR_GUARDS_INSTALLED]) {
    return { installed: false };
  }

  const logProcessError = ({ event, error, origin = null }) => {
    if (typeof log !== "function") return;
    try {
      log({
        level: "error",
        message: "wiki-mcp process-level error caught; keeping server process alive",
        event,
        origin,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null
      });
    } catch {

    }
  };

  processLike.on("unhandledRejection", (reason) => {
    logProcessError({ event: "unhandledRejection", error: reason });
  });
  processLike.on("uncaughtException", (error, origin) => {
    logProcessError({ event: "uncaughtException", error, origin });
  });

  Object.defineProperty(processLike, PROCESS_ERROR_GUARDS_INSTALLED, {
    value: true,
    enumerable: false,
    configurable: false
  });
  return { installed: true };
}

function isBoundaryCharacter(char) {
  return (
    char === "" ||
    char === undefined ||
    /\s/u.test(char) ||
    char === '"' ||
    char === "'" ||
    char === "`" ||
    char === "<" ||
    char === ">"
  );
}

function isOpeningBracket(char) {
  return char === "(" || char === "[" || char === "{";
}

function isPrecededByBoundary(text, start) {
  const previous = start > 0 ? text[start - 1] : "";
  return previous === "" || isBoundaryCharacter(previous) || isOpeningBracket(previous);
}

function isSchemePrefixAt(text, start) {
  let boundary = start - 1;
  while (boundary >= 0 && !/\s/u.test(text[boundary])) {
    boundary -= 1;
  }
  const token = text.slice(boundary + 1, start);
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(token);
}

function isWindowsDriveStart(text, start) {
  if (
    start + 2 >= text.length ||
    !/^[A-Za-z]:$/u.test(text.slice(start, start + 2)) ||
    (text[start + 2] !== "\\" && text[start + 2] !== "/")
  ) {
    return false;
  }

  return isPrecededByBoundary(text, start);
}

function isPosixStart(text, start) {
  if (text[start] !== "/") {
    return false;
  }
  if (!isPrecededByBoundary(text, start)) {
    return false;
  }
  return !isSchemePrefixAt(text, start);
}

function shouldStopBeforeChar(text, index, start) {
  const char = text[index];
  if (char === "\n" || char === "\r") {
    return true;
  }
  if (char === '"' || char === "'" || char === "`" || char === "<" || char === ">") {
    return true;
  }

  if (char === ":" && index === start + 1) {
    return false;
  }
  if (char === ".") {
    const next = text[index + 1] ?? "";
    if (
      next === "" ||
      /\s/u.test(next) ||
      next === ")" ||
      next === "]" ||
      next === "}" ||
      next === ">" ||
      next === '"' ||
      next === "'" ||
      next === "`"
    ) {
      return true;
    }
    return false;
  }
  if (
    char === ":" ||
    char === ";" ||
    char === "," ||
    char === "!" ||
    char === "?" ||
    char === ")" ||
    char === "]"
  ) {
    return true;
  }
  return false;
}

function redactPathAt(text, start) {
  const isWindows = isWindowsDriveStart(text, start);
  const isPosix = isPosixStart(text, start);
  if (!isWindows && !isPosix) {
    return null;
  }

  let end = isWindows ? start + 3 : start + 1;
  let sawSeparator = true;
  while (end < text.length) {
    if (shouldStopBeforeChar(text, end, start)) {
      break;
    }
    const char = text[end];
    if (char === "\\" || char === "/") {
      sawSeparator = true;
      end += 1;
      continue;
    }
    if (char === " " || char === "\t") {

      const next = text[end + 1] ?? "";
      if (next === "" || next === "\n" || next === "\r") {
        break;
      }
      if (sawSeparator) {
        end += 1;
        continue;
      }
      break;
    }
    end += 1;
  }

  let trail = "";
  while (end < text.length && /[):\],.;!?]/u.test(text[end])) {
    trail += text[end];
    end += 1;
  }

  return {
    end,
    replacement: `${PATH_REDACTION_PLACEHOLDER}${trail}`
  };
}

export function redactAbsolutePaths(text) {
  if (typeof text !== "string" || text.length === 0) {
    return text;
  }
  let result = "";
  let index = 0;
  while (index < text.length) {
    const match = redactPathAt(text, index);
    if (match) {
      result += match.replacement;
      index = match.end;
      continue;
    }
    result += text[index];
    index += 1;
  }
  return result;
}

export function errorContent(error) {
  const envelope =
    error &&
    typeof error === "object" &&
    !Array.isArray(error) &&
    error.envelope &&
    typeof error.envelope === "object" &&
    !Array.isArray(error.envelope)
      ? error.envelope
      : null;
  const envelopeText = envelope ? JSON.stringify(envelope) : null;
  const descriptor = envelope
    ? buildStructuredErrorDescriptor(envelopeText)
    : capUtf8Descriptor(redactAbsolutePaths(error instanceof Error ? error.message : String(error)));
  const result = {
    content: [{ type: "text", text: descriptor }],
    isError: true
  };
  if (envelope) {
    result.structuredContent = envelope;
  }
  return result;
}
