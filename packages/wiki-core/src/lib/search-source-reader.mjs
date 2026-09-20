import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { createHash, timingSafeEqual } from "node:crypto";
import path from "node:path";

function sourceError(code, message, sourcePath, cause = undefined) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.code = code;
  error.sourcePath = sourcePath;
  error.envelope = { schema_version: "search-refusal.v1", accepted: false, code,
    reason: message, next_calls: [] };
  return error;
}

function normalizeRelativePath(sourcePath) {
  if (typeof sourcePath !== "string" || sourcePath.length === 0 || path.isAbsolute(sourcePath)) {
    throw sourceError("search_source_path_invalid", "Search source path must be repository-relative", sourcePath);
  }
  const normalized = path.posix.normalize(sourcePath.replaceAll(path.sep, "/"));
  if (normalized !== sourcePath.replaceAll(path.sep, "/") || normalized === ".." || normalized.startsWith("../")) {
    throw sourceError("search_source_path_invalid", "Search source path escapes the repository", sourcePath);
  }
  return normalized;
}

export async function captureSearchSource(targetDir, sourcePath) {
  const relativePath = normalizeRelativePath(sourcePath);
  const root = await realpath(path.resolve(targetDir));
  const absolutePath = path.resolve(root, relativePath);
  const relative = path.relative(root, absolutePath);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw sourceError("search_source_path_invalid", "Search source path escapes the repository", sourcePath);
  }

  let before;
  try {
    before = await lstat(absolutePath);
  } catch (error) {
    throw sourceError("search_source_unreadable", `Search source is unreadable: ${relativePath}`, relativePath, error);
  }
  if (before.isSymbolicLink() || !before.isFile()) {
    throw sourceError("search_source_not_regular", `Search source is not a regular file: ${relativePath}`, relativePath);
  }
  if (typeof constants.O_NOFOLLOW !== "number") {
    throw sourceError("search_source_no_follow_unavailable", "No-follow source opening is unavailable", relativePath);
  }

  let handle;
  try {
    handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat();
    const resolvedPath = await realpath(absolutePath);
    const resolved = await stat(resolvedPath);
    const resolvedRelative = path.relative(root, resolvedPath);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
        opened.dev !== resolved.dev || opened.ino !== resolved.ino ||
        resolvedRelative === "" || resolvedRelative.startsWith(`..${path.sep}`) || path.isAbsolute(resolvedRelative)) {
      throw sourceError("search_source_changed", `Search source changed during capture: ${relativePath}`, relativePath);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size ||
        after.mtimeMs !== opened.mtimeMs) {
      throw sourceError("search_source_changed", `Search source changed during capture: ${relativePath}`, relativePath);
    }
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch (error) { throw sourceError("search_source_invalid_utf8", `Search source is not valid UTF-8: ${relativePath}`, relativePath, error); }
    return Object.freeze({
      relativePath,
      absolutePath,
      bytes,
      text,
      digest: createHash("sha256").update(bytes).digest("hex"),
      byteLength: bytes.length
    });
  } catch (error) {
    if (error?.code?.startsWith?.("search_source_")) throw error;
    throw sourceError("search_source_unreadable", `Search source is unreadable: ${relativePath}: ${error.message}`, relativePath, error);
  } finally {
    await handle?.close();
  }
}

export function digestSearchProjectionContext(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const SEARCH_TOKEN_KEY = "wiki-search-selected-source.v1";

export function encodeSearchToken(kind, payload) {
  const body = Buffer.from(JSON.stringify({ version: 1, kind, payload }), "utf8").toString("base64url");
  const signature = createHash("sha256").update(`${SEARCH_TOKEN_KEY}:${body}`).digest("base64url");
  return `ws1.${body}.${signature}`;
}

export function decodeSearchToken(token, expectedKind) {
  if (typeof token !== "string") throw sourceError("search_token_invalid", "Search continuation is invalid", null);
  const match = token.match(/^ws1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/u);
  if (!match) throw sourceError("search_token_invalid", "Search continuation is invalid", null);
  const expected = createHash("sha256").update(`${SEARCH_TOKEN_KEY}:${match[1]}`).digest("base64url");
  const suppliedBytes = Buffer.from(match[2]);
  const expectedBytes = Buffer.from(expected);
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
    throw sourceError("search_token_invalid", "Search continuation is invalid", null);
  }
  let envelope;
  try { envelope = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")); }
  catch (error) { throw sourceError("search_token_invalid", "Search continuation is invalid", null, error); }
  if (envelope?.version !== 1 || envelope?.kind !== expectedKind || !envelope.payload || typeof envelope.payload !== "object") {
    throw sourceError("search_token_invalid", "Search continuation is incompatible", null);
  }
  return envelope.payload;
}
