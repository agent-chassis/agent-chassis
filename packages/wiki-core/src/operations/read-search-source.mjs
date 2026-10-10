import path from "node:path";
import { resolveContractContext } from "../lib/wiki.mjs";
import { captureSearchSource, decodeSearchToken, encodeSearchToken } from "../lib/search-source-reader.mjs";
import { digestResolvedSearchProjectionContext, projectCapturedSearchSource } from "../lib/search-source-corpus.mjs";
import { scalarLength, sliceScalars } from "../lib/search-passages.mjs";

export const SEARCH_SOURCE_TEXT_DEFAULT_SCALARS = 512;
export const SEARCH_SOURCE_TEXT_MAX_SCALARS = 1024;

function selectedSourceError(code, message, nextCalls = [], cause = undefined) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.code = code;
  error.envelope = { schema_version: "search-refusal.v1", accepted: false, code,
    reason: message, next_calls: nextCalls };
  return error;
}

export async function readSearchSource({ dir = ".", repository = null, path: requestedPath,
  searchMatch, length = SEARCH_SOURCE_TEXT_DEFAULT_SCALARS } = {}) {
  const selection = decodeSearchToken(searchMatch, "source");
  const requestedRepository = repository ?? null;
  if (selection.repository !== requestedRepository || selection.path !== requestedPath) {
    throw selectedSourceError("search_source_selection_mismatch", "Selected search source does not match this repository or path");
  }
  if (!Number.isSafeInteger(length) || length <= 0 || length > SEARCH_SOURCE_TEXT_MAX_SCALARS) {
    throw selectedSourceError("search_source_length_invalid", `length must be an integer from 1 through ${SEARCH_SOURCE_TEXT_MAX_SCALARS}`);
  }
  const targetDir = path.resolve(String(dir));
  const context = await resolveContractContext(targetDir, {
    profile: selection.profile,
    extensionNamespaces: selection.extension_namespaces
  });
  if (digestResolvedSearchProjectionContext(context) !== selection.context_digest) {
    throw selectedSourceError("search_source_context_changed", "Selected search source context is incompatible");
  }

  const sourceError = (code, message, cause) => {
    const error = selectedSourceError(code, message, [], cause);
    error.envelope.subject = { repository: requestedRepository, path: requestedPath,
      source_id: selection.source_id };
    return error;
  };
  let capture;
  try { capture = await captureSearchSource(targetDir, requestedPath); }
  catch (error) {
    throw sourceError(error?.code ?? "search_source_changed",
      "Selected search source changed, disappeared, or became unreadable", error);
  }
  if (capture.digest !== selection.source_digest) {
    throw sourceError("search_source_changed", "Selected search source changed or was replaced");
  }
  const source = await projectCapturedSearchSource(targetDir, capture, context);
  const passage = source.passages.find((candidate) => candidate.sourceId === selection.source_id);
  if (!passage) throw sourceError("search_source_reordered", "Selected search source region no longer exists");
  const total = scalarLength(passage.originalText);
  if (!Number.isSafeInteger(selection.offset) || selection.offset < 0 || selection.offset > total) {
    throw selectedSourceError("search_source_selection_invalid", "Selected search source offset is invalid");
  }
  const returnedLength = Math.min(length, total - selection.offset);
  const text = sliceScalars(passage.originalText, selection.offset, returnedLength);
  const eof = selection.offset + returnedLength >= total;
  const tokenPayload = { ...selection };
  const nextMatch = eof ? null : encodeSearchToken("source", {
    ...tokenPayload, offset: selection.offset + returnedLength
  });
  const startMatch = encodeSearchToken("source", { ...tokenPayload, offset: 0 });
  return {
    format: "search-source-text.v1",
    path: requestedPath,
    source_id: passage.sourceId,
    location: passage.location,
    text,
    offset: selection.offset,
    length: returnedLength,
    total: total,
    eof,
    next_match: nextMatch,
    source_start: startMatch
  };
}
