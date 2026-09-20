

import { createHash, timingSafeEqual } from "node:crypto";
import { access, constants as fsConstants } from "node:fs/promises";

import { SHA256_PATTERN } from "./work-record-schema-constants.mjs";
import { getWorkRecordPath } from "./work-record-store.mjs";
import { workRecordProseRegistryEntries } from "./work-record-contract-edit-operations.mjs";
import {
  WORK_RECORD_REFERENCE_FIELDS,
  WORK_RECORD_ENTRY_REFERENCE_PREFIX,
  WORK_RECORD_TEXT_REFERENCE_PREFIX,
  checkedAdd,
  isUnicodeScalarString,
  utf8Length,
  validateWorkRecordEntryContent,
  workRecordEntryVersionFormat
} from "./work-record-entry-schema.mjs";

const SOURCE_PROVENANCE = "canonical_work_record";
function supportedSourceFields() {
  return new Set([
    ...workRecordProseRegistryEntries("record").map(({ field }) => field),
    ...workRecordProseRegistryEntries("slice").map(({ field }) => field),
    "sections.tasks.text"
  ]);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function digestWorkRecordEntryVersionContent(content) {
  return `sha256:${createHash("sha256").update(canonicalJson(content), "utf8").digest("hex")}`;
}

function decodeHistoricalWorkRecordEntryReference(encoded) {
  try {
    if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) return { invalid: true };
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) return { invalid: true };
    const text = bytes.toString("utf8");
    if (!isUnicodeScalarString(text) || !Buffer.from(text, "utf8").equals(bytes)) return { invalid: true };
    const value = JSON.parse(text);
    if (!strictKeys(value, ["r", "w", "u", "e", "v"]) ||
        typeof value.r !== "string" || value.r.length === 0 ||
        typeof value.w !== "string" || !/^WK-[0-9]{4,}$/u.test(value.w) ||
        !(value.u === null || (typeof value.u === "string" && /^SLICE-[0-9]{3,}$/u.test(value.u))) ||
        !Number.isSafeInteger(value.e) || value.e <= 0 ||
        !Number.isSafeInteger(value.v) || value.v <= 0) return { invalid: true };
    return { historical: true, r: value.r, w: value.w, u: value.u, e: value.e, n: value.v,
      o: 0, l: null, t: null };
  } catch { return { invalid: true }; }
}

export function decodeWorkRecordEntryReference(reference) {
  if (typeof reference !== "string" || !reference.startsWith(WORK_RECORD_ENTRY_REFERENCE_PREFIX)) return null;
  const framed = reference.slice(WORK_RECORD_ENTRY_REFERENCE_PREFIX.length);
  if (!framed.includes(".")) return decodeHistoricalWorkRecordEntryReference(framed);
  try {
    const separator = framed.lastIndexOf(".");
    if (separator <= 0) return { invalid: true };
    const encoded = framed.slice(0, separator);
    const suppliedChecksum = framed.slice(separator + 1);
    if (!/^[A-Za-z0-9_-]+$/u.test(encoded) || !/^[a-f0-9]{64}$/u.test(suppliedChecksum) ||
        checksum(encoded) !== suppliedChecksum) return { invalid: true };
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) return { invalid: true };
    const value = JSON.parse(bytes.toString("utf8"));
    if (!strictKeys(value, ["v", "p", "r", "w", "u", "e", "n", "o", "l", "t"]) ||
        value.v !== 1 || value.p !== "retained_work_record_entry" ||
        typeof value.r !== "string" || !/^WK-[0-9]{4,}$/u.test(value.w) ||
        !(value.u === null || /^SLICE-[0-9]{3,}$/u.test(value.u)) || !Number.isSafeInteger(value.e) || value.e <= 0 ||
        !Number.isSafeInteger(value.n) || value.n <= 0 || !Number.isSafeInteger(value.o) || value.o < 0 ||
        !Number.isSafeInteger(value.l) || value.l < 0 || !Number.isSafeInteger(value.t) || value.t < 0 ||
        checkedAdd(value.o, value.l) === null || value.o + value.l > value.t) return { invalid: true };
    return value;
  } catch { return { invalid: true }; }
}

export function encodeWorkRecordEntryReference({ repository, recordId, sliceId = null,
  entryId, versionId, offset = 0, length, total }) {
  const payload = { v: 1, p: "retained_work_record_entry", r: repository, w: recordId,
    u: sliceId, e: entryId, n: versionId, o: offset, l: length, t: total };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const reference = `${WORK_RECORD_ENTRY_REFERENCE_PREFIX}${encoded}.${checksum(encoded)}`;
  const decoded = decodeWorkRecordEntryReference(reference);
  if (decoded?.invalid || decoded === null) throw new TypeError("entry reference input is invalid");
  return reference;
}

function diagnostic(code, message, path = "value") {
  return { code, severity: "error", authority_limb: "mechanical", message, path };
}

function checksum(encodedPayload) {
  return createHash("sha256").update(encodedPayload).digest("hex");
}

function strictKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function referencePayloadIssue(payload) {
  if (!strictKeys(payload, WORK_RECORD_REFERENCE_FIELDS)) return "reference payload has an unsupported shape";
  if (payload.v !== 1 || payload.p !== SOURCE_PROVENANCE) return "reference payload has an unsupported producer";
  if (typeof payload.r !== "string" || payload.r.length === 0 ||
      typeof payload.w !== "string" || !/^WK-[0-9]{4,}$/u.test(payload.w)) return "reference source identity is invalid";
  if (payload.u !== null && (typeof payload.u !== "string" || payload.u.length === 0)) return "reference unit identity is invalid";
  if (!supportedSourceFields().has(payload.f)) return "reference field identity is unsupported";
  if (payload.f === "sections.tasks.text") {
    if (!Number.isSafeInteger(payload.i) || payload.i < 0) return "task reference requires a safe nonnegative task index";
  } else if (payload.i !== null) return "non-task reference must not carry a task index";
  if (typeof payload.g !== "string" || !SHA256_PATTERN.test(payload.g)) return "reference generation is invalid";
  for (const key of ["o", "l", "t"]) {
    if (!Number.isSafeInteger(payload[key]) || payload[key] < 0) return "reference extent is invalid";
  }
  const end = checkedAdd(payload.o, payload.l);
  if (end === null || end > payload.t) return "reference extent exceeds its source";
  return null;
}

export function encodeWorkRecordTextReference({
  repository,
  recordId,
  sliceId = null,
  field,
  taskIndex = null,
  sourceDigest,
  offset,
  length,
  total
}) {
  const payload = {
    v: 1, p: SOURCE_PROVENANCE, r: repository, w: recordId, u: sliceId,
    f: field, i: taskIndex, g: sourceDigest, o: offset, l: length, t: total
  };
  const problem = referencePayloadIssue(payload);
  if (problem !== null) throw new TypeError(problem);
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${WORK_RECORD_TEXT_REFERENCE_PREFIX}${encoded}.${checksum(encoded)}`;
}

export function decodeWorkRecordTextReference(reference) {
  if (typeof reference !== "string" || !reference.startsWith(WORK_RECORD_TEXT_REFERENCE_PREFIX)) {
    return { ok: false, diagnostic: diagnostic(
      "work_record_reference_unsupported",
      "ref is not a supported canonical work-record text reference",
      "ref"
    ) };
  }
  const rest = reference.slice(WORK_RECORD_TEXT_REFERENCE_PREFIX.length);
  const separator = rest.lastIndexOf(".");
  if (separator <= 0) {
    return { ok: false, diagnostic: diagnostic("work_record_reference_corrupt", "reference framing is corrupt", "ref") };
  }
  const encoded = rest.slice(0, separator);
  const suppliedChecksum = rest.slice(separator + 1);
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded) || !/^[a-f0-9]{64}$/u.test(suppliedChecksum)) {
    return { ok: false, diagnostic: diagnostic("work_record_reference_corrupt", "reference encoding is corrupt", "ref") };
  }
  const expected = checksum(encoded);
  if (!timingSafeEqual(Buffer.from(suppliedChecksum), Buffer.from(expected))) {
    return { ok: false, diagnostic: diagnostic("work_record_reference_corrupt", "reference checksum does not match", "ref") };
  }
  let payload;
  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) throw new Error("noncanonical base64url");
    const text = bytes.toString("utf8");
    if (!isUnicodeScalarString(text)) throw new Error("invalid Unicode");
    payload = JSON.parse(text);
  } catch {
    return { ok: false, diagnostic: diagnostic("work_record_reference_corrupt", "reference payload cannot be decoded", "ref") };
  }
  const problem = referencePayloadIssue(payload);
  if (problem !== null) {
    const unsupported = /unsupported/u.test(problem);
    return { ok: false, diagnostic: diagnostic(
      unsupported ? "work_record_reference_unsupported" : "work_record_reference_corrupt",
      problem,
      "ref"
    ) };
  }
  return { ok: true, reference: payload };
}

function selectSourceValue(record, ref) {
  const unit = ref.u === null ? record : record?.slices?.find((slice) => slice?.id === ref.u);
  if (!unit) return { ok: false, code: "work_record_reference_source_missing", message: `source unit ${ref.w}#${ref.u} is missing` };
  if (supportedSourceFields().has(ref.f) && ref.f !== "sections.tasks.text") {
    const value = ref.f.split(".").reduce((current, key) => current?.[key], unit);
    return typeof value === "string"
      ? { ok: true, value }
      : { ok: false, code: "work_record_reference_source_missing",
          message: `source ${ref.f} is missing` };
  }
  if (ref.f === "sections.tasks.text") {
    const tasks = unit?.sections?.tasks;
    const task = Array.isArray(tasks) ? tasks[ref.i] : null;
    return typeof task?.text === "string"
      ? { ok: true, value: task.text }
      : { ok: false, code: "work_record_reference_source_missing", message: `source task ${ref.i} is missing` };
  }
  return { ok: false, code: "work_record_reference_unsupported", message: "source field is unsupported" };
}

function sourceLoadFailure(loaded, ref) {
  const diagnostics = Array.isArray(loaded?.diagnostics) ? loaded.diagnostics : [];
  const combined = diagnostics.map((entry) => `${entry?.code ?? ""} ${entry?.message ?? ""}`).join(" ").toLowerCase();
  if (/eacces|eperm|permission|denied|unauthor/u.test(combined)) {
    return diagnostic("work_record_reference_source_denied", `read access to source ${ref.w} was denied`, "ref");
  }
  if (!loaded?.record) {
    return diagnostic("work_record_reference_source_missing", `canonical source ${ref.w} is missing`, "ref");
  }
  return diagnostic("work_record_reference_source_corrupt", `canonical source ${ref.w} is invalid or corrupt`, "ref");
}

async function classifySourceLoadFailure(loaded, ref, dir) {
  const projected = sourceLoadFailure(loaded, ref);
  if (projected.code !== "work_record_reference_source_missing") return projected;
  try {
    await access(getWorkRecordPath(dir, ref.w), fsConstants.R_OK);
  } catch (error) {
    if (["EACCES", "EPERM"].includes(error?.code)) {
      return diagnostic("work_record_reference_source_denied", `read access to source ${ref.w} was denied`, "ref");
    }
  }
  return projected;
}

export async function resolveWorkRecordEntryContent({
  content,
  repository,
  dir,
  loadWorkRecordById,
  entryResolutionState = null,
  materialize = true,
  offset = 0,
  length = null
}) {
  const root = validateWorkRecordEntryContent(content);
  if (!root.ok) return root;
  const state = entryResolutionState ?? { active: new Set(), memo: new Map(), sourceCache: new Map() };
  state.sourceCache ??= new Map();
  state.sourceClosure ??= [];
  state.sourceClosureKeys ??= new Set();
  const frames = [{ key: null, leaves: root.leaves, index: 0, pieces: [],
    scalarLength: 0, byteLength: 0, pending: null }];

  const appendPiece = (frame, piece) => {
    const nextScalars = checkedAdd(frame.scalarLength, piece.scalar_length);
    const nextBytes = checkedAdd(frame.byteLength, piece.utf8_bytes);
    if (nextScalars === null || nextBytes === null) return false;
    frame.pieces.push(piece);
    frame.scalarLength = nextScalars;
    frame.byteLength = nextBytes;
    return true;
  };

  const sliceNode = (node, selectedOffset, selectedLength, includeValue) => {
    const selectedEnd = checkedAdd(selectedOffset, selectedLength);
    if (!Number.isSafeInteger(selectedOffset) || selectedOffset < 0 ||
        !Number.isSafeInteger(selectedLength) || selectedLength < 0 ||
        selectedEnd === null || selectedEnd > node.scalar_length) return null;
    const chunks = [];
    let selectedBytes = 0;
    const work = [{ node, offset: selectedOffset, length: selectedLength }];
    while (work.length > 0) {
      const task = work.pop();
      const taskEnd = task.offset + task.length;
      let cursor = 0;
      const overlaps = [];
      for (const piece of task.node.pieces) {
        const pieceEnd = cursor + piece.scalar_length;
        const overlapStart = Math.max(task.offset, cursor);
        const overlapEnd = Math.min(taskEnd, pieceEnd);
        if (overlapStart < overlapEnd) {
          const localOffset = overlapStart - cursor;
          const localLength = overlapEnd - overlapStart;
          if (piece.kind === "text") {
            const value = Array.from(piece.value).slice(localOffset, localOffset + localLength).join("");
            overlaps.push({ kind: "text", value });
          } else {
            overlaps.push({ kind: "node", node: piece.node,
              offset: piece.offset + localOffset, length: localLength });
          }
        }
        cursor = pieceEnd;
        if (cursor >= taskEnd) break;
      }
      for (let index = overlaps.length - 1; index >= 0; index -= 1) work.push(overlaps[index]);
      while (work.at(-1)?.kind === "text") {
        const textTask = work.pop();
        const nextBytes = checkedAdd(selectedBytes, utf8Length(textTask.value));
        if (nextBytes === null) return null;
        selectedBytes = nextBytes;
        if (includeValue) chunks.push(textTask.value);
      }
    }
    return { value: includeValue ? chunks.join("") : undefined, utf8_bytes: selectedBytes };
  };

  while (frames.length > 0) {
    const frame = frames.at(-1);
    if (frame.index >= frame.leaves.length) {
      const resolved = { pieces: frame.pieces, scalar_length: frame.scalarLength,
        utf8_bytes: frame.byteLength };
      frames.pop();
      if (frame.key !== null) {
        state.active.delete(frame.key);
        state.memo.set(frame.key, resolved);
      }
      if (frames.length === 0) {
        const requestedLength = length ?? resolved.scalar_length - offset;
        const selected = sliceNode(resolved, offset, requestedLength, materialize);
        if (selected === null) return { ok: false, diagnostic: diagnostic(
          "work_record_reference_range_invalid", "requested rendered range is outside the entry content", "content") };
        return { ok: true, ...(materialize ? { value: selected.value } : {}),
          scalar_length: resolved.scalar_length, utf8_bytes: resolved.utf8_bytes,
          content_digest: digestWorkRecordEntryVersionContent(content),
          selected_offset: offset, selected_length: requestedLength,
          selected_utf8_bytes: selected.utf8_bytes,
          source_closure: state.sourceClosure.map(identity => ({ ...identity })) };
      }
      const parent = frames.at(-1);
      const { reference, version, format } = parent.pending;
      parent.pending = null;
      if (format === "current" && (resolved.scalar_length !== version.scalar_length ||
          resolved.utf8_bytes !== version.utf8_bytes)) return { ok: false, diagnostic: diagnostic(
        "work_record_reference_source_corrupt", "retained entry version length metadata is corrupt", "ref") };
      if (!reference.historical && resolved.scalar_length !== reference.t) return { ok: false, diagnostic: diagnostic(
        "work_record_reference_source_corrupt", "retained entry reference extent differs from its immutable version", "ref") };
      const span = referenceSpan(reference, resolved);
      const selected = sliceNode(resolved, span.offset, span.length, false);
      if (selected === null || !appendPiece(parent, { kind: "node", node: resolved,
        offset: span.offset, scalar_length: span.length, utf8_bytes: selected.utf8_bytes })) return { ok: false, diagnostic: diagnostic(
        "work_record_content_extent_overflow", "rendered content length exceeds safe integer arithmetic") };
      continue;
    }

    const leaf = frame.leaves[frame.index];
    frame.index += 1;
    if (Object.hasOwn(leaf, "text")) {
      if (!appendPiece(frame, { kind: "text", value: leaf.text,
        scalar_length: Array.from(leaf.text).length, utf8_bytes: utf8Length(leaf.text) })) return { ok: false,
        diagnostic: diagnostic("work_record_content_extent_overflow", "rendered content length exceeds safe integer arithmetic") };
      continue;
    }

    const entryRef = decodeWorkRecordEntryReference(leaf.ref);
    if (entryRef !== null) {
      if (entryRef.invalid) return { ok: false, diagnostic: diagnostic(
        "work_record_reference_corrupt", "retained entry reference is corrupt", "ref") };
      if (entryRef.r !== repository) return { ok: false, diagnostic: diagnostic(
        "work_record_reference_cross_repository", "entry reference belongs to another repository", "ref") };
      const recordKey = `entry\u0000${entryRef.w}`;
      let loaded = state.sourceCache.get(recordKey);
      if (loaded === undefined) {
        try { loaded = await loadWorkRecordById({ dir, id: entryRef.w }); }
        catch (error) { return { ok: false, diagnostic: diagnostic(
          "work_record_reference_source_missing", `retained entry source could not be read: ${error?.message ?? String(error)}`, "ref") }; }
        state.sourceCache.set(recordKey, loaded);
      }
      if (!loaded?.valid || !loaded.record) return { ok: false,
        diagnostic: await classifySourceLoadFailure(loaded, { w: entryRef.w }, dir) };
      const owner = entryRef.u === null ? loaded.record
        : loaded.record.slices?.find(slice => slice.id === entryRef.u);
      const entry = owner?.sections?.entries?.find(value => value.id === entryRef.e);
      const version = entry?.versions?.find(value => value.id === entryRef.n);
      if (!version) return { ok: false, diagnostic: diagnostic(
        "work_record_reference_source_missing", "retained entry version is unavailable", "ref") };
      const format = workRecordEntryVersionFormat(entry, version);
      if (format === null) return { ok: false, diagnostic: diagnostic(
        "work_record_reference_source_corrupt", "retained entry version shape is corrupt", "ref") };
      if (format === "current" && !entryRef.historical && version.scalar_length !== entryRef.t) return { ok: false, diagnostic: diagnostic(
        "work_record_reference_source_corrupt", "retained entry reference extent differs from its immutable version", "ref") };
      const key = `${entryRef.r}\u0000${entryRef.w}\u0000${entryRef.u ?? ""}\u0000${entryRef.e}\u0000${entryRef.n}`;
      if (!state.sourceClosureKeys.has(key)) {
        state.sourceClosureKeys.add(key);
        state.sourceClosure.push({ repository: entryRef.r,
          unit: entryRef.u === null ? entryRef.w : `${entryRef.w}#${entryRef.u}`,
          entry_id: entryRef.e, version_id: entryRef.n,
          content_digest: digestWorkRecordEntryVersionContent(version.content) });
      }
      const memoized = state.memo.get(key);
      if (memoized) {
        if (format === "current" && (memoized.scalar_length !== version.scalar_length ||
            memoized.utf8_bytes !== version.utf8_bytes)) {
          return { ok: false, diagnostic: diagnostic("work_record_reference_source_corrupt",
            "retained entry version length metadata is corrupt", "ref") };
        }
        if (!entryRef.historical && memoized.scalar_length !== entryRef.t) return { ok: false, diagnostic: diagnostic(
          "work_record_reference_source_corrupt", "retained entry reference extent differs from its immutable version", "ref") };
        const span = referenceSpan(entryRef, memoized);
        const selected = sliceNode(memoized, span.offset, span.length, false);
        if (selected === null || !appendPiece(frame, { kind: "node", node: memoized,
          offset: span.offset, scalar_length: span.length, utf8_bytes: selected.utf8_bytes })) return { ok: false, diagnostic: diagnostic(
          "work_record_content_extent_overflow", "rendered content length exceeds safe integer arithmetic") };
        continue;
      }
      if (state.active.has(key)) return { ok: false, diagnostic: diagnostic(
        "work_record_reference_cycle", "retained entry references contain a cycle", "ref") };
      const nested = validateWorkRecordEntryContent(version.content);
      if (!nested.ok) return nested;
      state.active.add(key);
      frame.pending = { reference: entryRef, version, format };
      frames.push({ key, leaves: nested.leaves, index: 0, pieces: [],
        scalarLength: 0, byteLength: 0, pending: null });
      continue;
    }

    const decoded = decodeWorkRecordTextReference(leaf.ref);
    if (!decoded.ok) return decoded;
    const ref = decoded.reference;
    if (ref.r !== repository) return { ok: false, diagnostic: diagnostic(
      "work_record_reference_cross_repository",
      `reference source repository ${ref.r} differs from target repository ${repository}`, "ref") };
    const cacheKey = `text\u0000${ref.w}\u0000${ref.g}`;
    let loaded = state.sourceCache.get(cacheKey);
    if (loaded === undefined) {
      try { loaded = await loadWorkRecordById({ dir, id: ref.w }); }
      catch (error) {
        const code = ["EACCES", "EPERM"].includes(error?.code)
          ? "work_record_reference_source_denied" : "work_record_reference_source_corrupt";
        return { ok: false, diagnostic: diagnostic(code,
          `canonical source ${ref.w} could not be read: ${error?.message ?? String(error)}`, "ref") };
      }
      state.sourceCache.set(cacheKey, loaded);
    }
    if (!loaded?.record || loaded.valid !== true) return { ok: false,
      diagnostic: await classifySourceLoadFailure(loaded, ref, dir) };
    if (loaded.source_digest !== ref.g) return { ok: false, diagnostic: diagnostic(
      "work_record_reference_source_stale", `canonical source ${ref.w} no longer has the referenced generation`, "ref"),
      expected_source_digest: ref.g, current_source_digest: loaded.source_digest ?? null };
    const selected = selectSourceValue(loaded.record, ref);
    if (!selected.ok) return { ok: false, diagnostic: diagnostic(selected.code, selected.message, "ref") };
    if (!isUnicodeScalarString(selected.value)) return { ok: false, diagnostic: diagnostic(
      "work_record_reference_source_corrupt", "referenced source contains invalid Unicode rather than scalar text", "ref") };
    const points = Array.from(selected.value);
    if (points.length !== ref.t) return { ok: false, diagnostic: diagnostic(
      "work_record_reference_source_corrupt", "referenced source extent does not match canonical content", "ref") };
    const end = checkedAdd(ref.o, ref.l);
    if (end === null || end > points.length) return { ok: false, diagnostic: diagnostic(
      "work_record_reference_source_corrupt", "referenced range exceeds canonical content", "ref") };
    const value = points.slice(ref.o, end).join("");
    if (!appendPiece(frame, { kind: "text", value, scalar_length: ref.l,
      utf8_bytes: utf8Length(value) })) return { ok: false, diagnostic: diagnostic(
      "work_record_content_extent_overflow", "rendered content length exceeds safe integer arithmetic") };
  }
  throw new Error("entry traversal terminated without a root result");
}

function referenceSpan(reference, resolved) {
  return reference.historical ? { offset: 0, length: resolved.scalar_length }
    : { offset: reference.o, length: reference.l };
}

export async function resolveWorkRecordEntryVersionLengths({ entry, version, repository, dir,
  loadWorkRecordById, entryResolutionState = null }) {
  const format = workRecordEntryVersionFormat(entry, version);
  if (format === "current") return { ok: true, scalar_length: version.scalar_length, utf8_bytes: version.utf8_bytes };
  if (format === null) return { ok: false, diagnostic: diagnostic(
    "work_record_entry_history_corrupt", "retained entry version shape is corrupt", "entry_id") };
  const resolved = await resolveWorkRecordEntryContent({ content: version.content, repository, dir,
    loadWorkRecordById, entryResolutionState, materialize: false, offset: 0, length: 0 });
  return resolved.ok ? { ok: true, scalar_length: resolved.scalar_length, utf8_bytes: resolved.utf8_bytes }
    : resolved;
}

export async function captureWorkRecordEntryContent({ content, repository, dir, loadWorkRecordById,
  resolveExternalReference = null }) {
  const shape = validateWorkRecordEntryContent(content);
  if (!shape.ok) return shape;
  const captured = [];
  const sources = [];
  for (const leaf of shape.leaves) {
    if (Object.hasOwn(leaf, "text")) {
      captured.push({ text: leaf.text });
      sources.push({ kind: "supplied_text", scalar_length: Array.from(leaf.text).length,
        utf8_bytes: utf8Length(leaf.text) });
      continue;
    }
    const retained = decodeWorkRecordEntryReference(leaf.ref);
    if (retained !== null) {
      if (retained.invalid) return { ok:false, diagnostic:diagnostic(
        "work_record_reference_corrupt", "retained entry reference is corrupt", "ref") };
      const resolved = await resolveWorkRecordEntryContent({ content: leaf, repository, dir,
        loadWorkRecordById });
      if (!resolved.ok) return resolved;

      const ref = retained.historical ? encodeWorkRecordEntryReference({ repository: retained.r,
        recordId: retained.w, sliceId: retained.u, entryId: retained.e, versionId: retained.n,
        offset: 0, length: resolved.scalar_length, total: resolved.scalar_length }) : leaf.ref;
      captured.push({ ref });
      sources.push({ kind: "retained_entry_reference", ref });
      continue;
    }
    const ordinary = decodeWorkRecordTextReference(leaf.ref);
    if (!ordinary.ok && typeof resolveExternalReference === "function") {
      const external = await resolveExternalReference({ reference: leaf.ref, repository });
      if (external?.ok !== true) {
        const state = external?.state ?? "unavailable";
        return { ok: false, diagnostic: diagnostic(
          `work_record_external_reference_${state}`,
          `external reference source is ${state}`,
          "ref"
        ) };
      }
      if (typeof external.text !== "string" || !isUnicodeScalarString(external.text) ||
          !external.provenance || typeof external.provenance !== "object") {
        return { ok: false, diagnostic: diagnostic("work_record_external_reference_corrupt",
          "external reference resolver returned corrupt source material", "ref") };
      }
      captured.push({ text: external.text });
      sources.push({ ...structuredClone(external.provenance), ref: leaf.ref,
        scalar_length: Array.from(external.text).length,
        utf8_bytes: utf8Length(external.text) });
      continue;
    }
    const resolved = await resolveWorkRecordEntryContent({ content: leaf, repository, dir,
      loadWorkRecordById });
    if (!resolved.ok) return resolved;
    captured.push({ text: resolved.value });
    sources.push({ kind: "captured_work_record_text", ref: leaf.ref,
      scalar_length: resolved.scalar_length, utf8_bytes: resolved.utf8_bytes });
  }
  const value = Object.hasOwn(content, "parts") ? { parts: captured } : captured[0];
  const rendered = await resolveWorkRecordEntryContent({ content: value, repository, dir,
    loadWorkRecordById });
  if (!rendered.ok) return rendered;
  return { ...rendered, content: value, provenance: { sources } };
}

export async function validateWorkRecordEntryIntegrity({ record, repository, dir, loadWorkRecordById }) {
  const units = [record, ...(record?.slices ?? [])];
  const entryResolutionState = { active: new Set(), memo: new Map(), sourceCache: new Map() };
  for (const unit of units) {
    for (const entry of unit?.sections?.entries ?? []) {
      for (const version of entry.versions ?? []) {
        const leaves = Object.hasOwn(version.content ?? {}, "parts")
          ? version.content.parts : [version.content];
        let resolvedRepository = repository;
        for (const leaf of leaves) {
          if (typeof leaf?.ref !== "string") continue;
          const retained = decodeWorkRecordEntryReference(leaf.ref);
          const ordinary = retained === null ? decodeWorkRecordTextReference(leaf.ref) : null;
          const identity = retained && !retained.invalid ? retained.r
            : ordinary?.ok ? ordinary.reference.r : null;
          if (identity !== null) {
            if (resolvedRepository !== null && resolvedRepository !== undefined &&
                resolvedRepository !== record.repo && resolvedRepository !== identity) {
              return { ok:false, diagnostic:diagnostic("work_record_reference_cross_repository",
                "one immutable version mixes repository identities", "sections.entries") };
            }
            resolvedRepository = identity;
          }
        }
        const resolved = await resolveWorkRecordEntryContent({ content:version.content,
          repository:resolvedRepository ?? record.repo, dir, loadWorkRecordById,
          entryResolutionState, materialize:false });
        if (!resolved.ok) return resolved;
        const format = workRecordEntryVersionFormat(entry, version);
        if (format === null || (format === "current" &&
            (resolved.scalar_length !== version.scalar_length || resolved.utf8_bytes !== version.utf8_bytes))) {
          return { ok:false, diagnostic:diagnostic("work_record_entry_history_corrupt",
            "immutable entry length metadata does not match its content", "sections.entries") };
        }
      }
    }
  }
  return { ok:true };
}

export function findExactScalarMatches(source, literal) {
  const sourcePoints = Array.from(source);
  const literalPoints = Array.from(literal);
  const matches = [];
  const last = sourcePoints.length - literalPoints.length;
  for (let offset = 0; offset <= last; offset += 1) {
    let equal = true;
    for (let index = 0; index < literalPoints.length; index += 1) {
      if (sourcePoints[offset + index] !== literalPoints[index]) {
        equal = false;
        break;
      }
    }
    if (equal) matches.push(offset);
  }
  return { sourcePoints, literalPoints, matches };
}
