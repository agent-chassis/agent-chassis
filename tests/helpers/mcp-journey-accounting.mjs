

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

export const ACCOUNTING_PHASES = Object.freeze([
  "setup", "discovery", "journey", "recovery", "restart", "shutdown"
]);
export const CAPTURE_CHANNELS = Object.freeze(["stdin", "stdout", "stderr"]);

export const sha = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export const CARRIER_FINDING_KINDS = Object.freeze({
  TEXT_MISSING: "text_representation_missing",
  TEXT_EMPTY: "text_representation_empty",
  TEXT_DISAGREES: "text_representation_disagrees",
  TEXT_ADDITIONAL: "text_representation_additional",
  CONTENT_BESIDE_STRUCTURED: "content_block_beside_structured",
  STRUCTURED_MEANING_MISSING: "structured_meaning_missing"
});

const isPlainObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

function parsedText(text) {
  try {
    return { parsed: true, value: JSON.parse(text) };
  } catch {
    return { parsed: false, value: undefined };
  }
}

export function structuredCarrierFindings(result, { permitNonTextBlocks = false } = {}) {
  const blocks = Array.isArray(result?.content) ? result.content : [];
  const texts = blocks.filter(block => block?.type === "text");
  if (!isPlainObject(result?.structuredContent)) {
    const unstructuredError = result?.isError === true && texts.length > 0 && texts.length === blocks.length;
    return { structured: false, unstructured_error: unstructuredError, text_bytes: 0,
      findings: unstructuredError ? [] : [{ kind: CARRIER_FINDING_KINDS.STRUCTURED_MEANING_MISSING }] };
  }
  const findings = [];
  if (!permitNonTextBlocks) {
    for (const block of blocks.filter(item => item?.type !== "text")) {
      findings.push({ kind: CARRIER_FINDING_KINDS.CONTENT_BESIDE_STRUCTURED, block_type: block?.type ?? null });
    }
  }
  if (texts.length === 0) findings.push({ kind: CARRIER_FINDING_KINDS.TEXT_MISSING });
  let textBytes = 0;
  const expected = JSON.stringify(result.structuredContent);
  texts.forEach((block, index) => {
    const text = typeof block.text === "string" ? block.text : "";
    const bytes = Buffer.byteLength(text);
    textBytes += bytes;
    if (index > 0) {
      findings.push({ kind: CARRIER_FINDING_KINDS.TEXT_ADDITIONAL, text_bytes: bytes });
      return;
    }
    if (text.length === 0) {
      findings.push({ kind: CARRIER_FINDING_KINDS.TEXT_EMPTY });
      return;
    }
    const parsed = parsedText(text);
    if (!parsed.parsed || !isDeepStrictEqual(parsed.value, result.structuredContent)) {
      findings.push({ kind: CARRIER_FINDING_KINDS.TEXT_DISAGREES, reason: "meaning", text_bytes: bytes });
    } else if (text !== expected) {
      findings.push({ kind: CARRIER_FINDING_KINDS.TEXT_DISAGREES, reason: "serialization", text_bytes: bytes });
    }
  });
  return { structured: true, unstructured_error: false, text_bytes: textBytes, findings };
}

export function assertStructuredCarrier(result, options = {}) {
  const { structured, findings } = structuredCarrierFindings(result, options);
  assert.ok(structured, `structured tool result must carry structuredContent: ${JSON.stringify(result)}`);
  assert.deepEqual(findings, [], `structured carrier contract: ${JSON.stringify(findings)}`);
  return result.structuredContent;
}

export function channels(raw) {
  assert.ok(raw && typeof raw === "object", `tool result must be an object: ${JSON.stringify(raw)}`);
  return assertStructuredCarrier(raw);
}

export function carrierBytes(message) {
  const result = message?.result;
  if (!result || typeof result !== "object") return { content_text: 0, structured: 0 };
  const text = (result.content ?? []).filter(item => item.type === "text")
    .map(item => item.text).join("");
  return {
    content_text: Buffer.byteLength(text),
    structured: result.structuredContent === undefined
      ? 0
      : Buffer.byteLength(JSON.stringify(result.structuredContent))
  };
}

export function callablesIn(value, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) callablesIn(item, found);
    return found;
  }
  if (!value || typeof value !== "object") return found;
  if (typeof value.tool === "string" && value.arguments && typeof value.arguments === "object") {
    found.push(value);
  }
  for (const item of Object.values(value)) callablesIn(item, found);
  return found;
}

export const sameCallable = (left, right) =>
  left.tool === right.tool && isDeepStrictEqual(left.arguments, right.arguments);

function captureError(code, message) {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}

export async function createMcpJourneyCapture({ directory, manifest, byteLimit = 64 * 1024 * 1024 }) {
  assert.ok(Number.isSafeInteger(byteLimit) && byteLimit > 0, "capture byteLimit must be positive");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const captures = new Map();
  let authority = true;

  const beginProcess = processIndex => {
    const current = Object.fromEntries(CAPTURE_CHANNELS.map(channel => {
      const id = `p${processIndex}-${channel}`;
      const entry = { id, process_index: processIndex, channel,
        file: path.join(directory, `${id}.bin`), chunks: [], byte_count: 0, state: "recording" };
      captures.set(id, entry);
      return [channel, entry];
    }));
    return ({ channel, bytes }) => {
      const entry = current[channel];
      assert.ok(entry, `unknown capture channel ${channel}`);
      entry.byte_count += bytes.length;
      assert.ok(entry.byte_count <= byteLimit,
        `capture_evidence_bound_exceeded: ${entry.id} exceeded ${byteLimit} bytes`);
      entry.chunks.push(Buffer.from(bytes));
    };
  };

  const finalize = async () => {
    for (const entry of captures.values()) {
      if (entry.state !== "recording") continue;
      const bytes = Buffer.concat(entry.chunks);
      await writeFile(entry.file, bytes, { mode: 0o600 });
      await chmod(entry.file, 0o400);
      Object.assign(entry, { state: "finalized", chunks: null,
        byte_count: bytes.length, sha256: sha(bytes) });
      manifest.captures.push({ id: entry.id, process_index: entry.process_index,
        channel: entry.channel, byte_count: entry.byte_count, sha256: entry.sha256 });
    }
  };

  const read = async id => {
    if (!authority) throw captureError("capture_unavailable", "capture authority has been released");
    const entry = captures.get(id);
    if (!entry) throw captureError("capture_unauthorized", `capture ${JSON.stringify(id)} was not issued`);
    if (entry.state !== "finalized") throw captureError("capture_unfinalized", `capture ${id} is still recording`);
    const dirMode = (await stat(directory)).mode & 0o777;
    let bytes;
    let fileMode;
    try {
      bytes = await readFile(entry.file);
      fileMode = (await stat(entry.file)).mode & 0o777;
    } catch (error) {
      if (error.code === "ENOENT") throw captureError("capture_missing", `capture ${id} is absent`);
      if (error.code === "EACCES") throw captureError("capture_unauthorized", `capture ${id} is not readable`);
      throw error;
    }
    if ((dirMode & 0o077) !== 0 || (fileMode & 0o077) !== 0) {
      throw captureError("capture_unprotected", `capture ${id} is group/world accessible`);
    }
    if (bytes.length !== entry.byte_count || sha(bytes) !== entry.sha256) {
      throw captureError("capture_corrupt", `capture ${id} bytes differ from finalization`);
    }
    return bytes;
  };

  return Object.freeze({
    beginProcess,
    finalize,
    read,
    file: id => captures.get(id)?.file ?? null,
    release: () => { authority = false; }
  });
}

function tally(events, phases) {
  const requests = events.filter(event => event.type === "request");
  const requestIds = new Set(requests.map(event => `${event.process_index}:${event.request_id}`));
  const responses = events.filter(event => event.type === "response");
  const sum = (values, field = "byte_count") => values.reduce((total, value) => total + value[field], 0);
  const origins = Object.fromEntries([...new Set(requests.map(event => event.origin))]
    .map(origin => [origin, requests.filter(event => event.origin === origin).length]));
  const repeated = [];
  const seen = new Set();
  for (const event of requests) {
    const key = JSON.stringify([event.method, event.params]);
    if (seen.has(key)) repeated.push(event);
    else seen.add(key);
  }
  const timed = requests.filter(event => event.outcome !== "failed" &&
    Number.isFinite(event.started_ms) && Number.isFinite(event.completed_ms));
  const lifecycle = events.filter(event => event.type === "lifecycle");
  const starts = lifecycle.filter(event => event.event === "start").length;
  return {
    calls: requests.length,
    delivered_calls: requests.filter(event => event.outcome === "delivered").length,
    failed_calls: requests.filter(event => event.outcome !== "delivered").length,
    transport_failed_calls: requests.filter(event => event.outcome === "failed").length,
    tool_error_calls: requests.filter(event => event.outcome === "tool_error").length,
    refused_calls: requests.filter(event => event.refused === true).length,
    server_emitted_calls: origins.server_emitted ?? 0,
    caller_authored_calls: origins.caller_authored ?? 0,
    caller_built_retrieval_calls: origins.caller_built_retrieval ?? 0,
    protocol_calls: origins.protocol ?? 0,
    response_frames: responses.length,
    lost_responses: responses.filter(event => event.withheld_from_consumer).length,
    substituted_responses: responses.filter(event => event.substitution !== undefined).length,
    unmatched_responses: responses.filter(event =>
      !requestIds.has(`${event.process_index}:${event.request_id}`)).length,
    recovery_calls: requests.filter(event => event.phase === "recovery").length,
    recovery_sequences: Object.fromEntries([...new Set(events.map(event => event.recovery_sequence)
      .filter(Boolean))].map(label => [label,
      requests.filter(event => event.recovery_sequence === label).length])),
    request_bytes: sum(requests),
    server_response_bytes: sum(responses),
    withheld_response_bytes: sum(responses.filter(event => event.withheld_from_consumer)),
    consumer_response_bytes: sum(responses.filter(event => !event.withheld_from_consumer)),

    substituted_delivery_bytes: responses.reduce((total, event) =>
      total + (event.substitution?.delivered_byte_count ?? 0), 0),
    content_text_bytes: responses.reduce((total, event) => total + event.carrier_bytes.content_text, 0),
    structured_bytes: responses.reduce((total, event) => total + event.carrier_bytes.structured, 0),
    materialized_logical_result_bytes: sum(requests.filter(event => Number.isSafeInteger(event.materialized_logical_result_bytes)),
      "materialized_logical_result_bytes"),
    declared_client_display_bytes: sum(requests.filter(event => Number.isSafeInteger(event.declared_client_display_bytes)),
      "declared_client_display_bytes"),
    repeated_requests: repeated.length,
    repeated_request_bytes: sum(repeated),
    process_starts: starts,
    process_exits: lifecycle.filter(event => ["exit", "killed"].includes(event.event)).length,
    restarts: Math.max(0, starts - 1),
    latency_ms: { observed_calls: timed.length, unavailable_calls: requests.length - timed.length,
      total: timed.reduce((total, event) => total + event.completed_ms - event.started_ms, 0) },
    model_input_tokens: null,
    model_output_tokens: null,
    phases: [...phases]
  };
}

export function accounting(trace, { phases = ["journey"], identities = null,
  phasePopulation = ACCOUNTING_PHASES } = {}) {
  for (const value of [...phases, ...trace.map(event => event.phase)]) {
    assert.ok(phasePopulation.includes(value), `unaccountable phase ${value}`);
  }
  return {
    ...tally(trace.filter(event => phases.includes(event.phase)), phases),
    bounds: { phases: [...phases], complete: phasePopulation.every(value => phases.includes(value)) },
    by_phase: Object.fromEntries(phasePopulation.map(value =>
      [value, tally(trace.filter(event => event.phase === value), [value])])),
    complete: tally(trace, phasePopulation),
    identities: identities === null
      ? { unavailable: "no source, client or role identity was supplied for this report" }
      : structuredClone(identities),
    unavailable: {
      model_tokens: "no client, model, tokenizer or projection observation",
      billed_usage: "not observed; request repetition is not billed context"
    }
  };
}

export function accountingView(trace, { key, phases = ACCOUNTING_PHASES } = {}) {
  assert.equal(typeof key, "string", "an accounting view names its metadata key");
  const requests = new Map(trace.filter(event => event.type === "request")
    .map(event => [`${event.process_index}:${event.request_id}`, event]));
  const partitionOf = event => {
    const request = event.type === "request" ? event
      : requests.get(`${event.process_index}:${event.request_id}`);
    return String(request?.[key] ?? "unlabelled");
  };
  const partitions = [...new Set(trace.filter(event => event.type !== "lifecycle").map(partitionOf))].sort();
  const complete = tally(trace, phases);
  const view = Object.fromEntries(partitions.map(name => [name,
    tally(trace.filter(event => event.type !== "lifecycle" && partitionOf(event) === name), phases)]));
  for (const field of ["calls", "request_bytes", "server_response_bytes", "response_frames",
    "substituted_delivery_bytes"]) {
    const total = Object.values(view).reduce((sum, entry) => sum + entry[field], 0);
    assert.equal(total, complete[field], `accounting_view_unreconciled: ${key}.${field} ${total} != ${complete[field]}`);
  }
  return { key, population: "every request and response frame of the ledger", partitions: view,
    complete: { calls: complete.calls, request_bytes: complete.request_bytes,
      server_response_bytes: complete.server_response_bytes, response_frames: complete.response_frames,
      substituted_delivery_bytes: complete.substituted_delivery_bytes } };
}

export const CALL_PURPOSES = Object.freeze({
  consumer: "a call the consuming journey needs to act",
  setup: "scenario setup or an interleaved second writer; never consumer knowledge or consumer cost",
  first_discovery: "initial discovery of a surface the journey has not yet read",
  freshness: "a CAS/currentness read whose digest the next write must carry",
  restart: "re-establishing state after an actual process restart",
  conformance_control: "an explicitly requested independent control, not consumer cost"
});

export const CLIENT_DISPLAY_CONFIGURATIONS = Object.freeze({
  structured: "one line per call: the materialized structured result only",
  raw_result_frame: "one line per call: the whole tool result frame exactly as returned"
});

const displayLine = (result, configuration) => {
  if (configuration === "structured") return JSON.stringify(result.payload ?? null);
  assert.equal(configuration, "raw_result_frame", `unknown client display configuration ${configuration}`);
  return JSON.stringify(result.raw ?? null);
};

export function clientBatchLines(results, configuration) {
  return results.map(result => displayLine(result, configuration));
}

export function clientBatchProjection(batch, results, configuration) {
  assert.ok(results.length > 0, `client batch ${batch} has no calls`);
  const text = clientBatchLines(results, configuration).join("\n");
  return { batch, configuration, calls: results.map(result => result.entry.id),
    lines: results.length, utf8_bytes: Buffer.byteLength(text), tokens: null,
    tokens_unavailable: "no client tokenizer or limiter is exercised by this deterministic client" };
}

export function assertWithinCeilings(measured, ceilings, label) {
  for (const [key, ceiling] of Object.entries(ceilings)) {
    const value = measured?.[key];
    assert.ok(Number.isSafeInteger(value), `output_budget_unmeasured: ${label}.${key}`);
    if (value > ceiling) {
      throw new assert.AssertionError({ message: `output_budget_exceeded: ${label}.${key} ${value} > ${ceiling}`,
        actual: value, expected: ceiling, operator: "<=" });
    }
  }
}

export const DEFAULT_STATUS_FRAME_BUDGET_BYTES = 8192;

export function assertDefaultStatusFrame(results, label) {
  const projection = clientBatchProjection(label, results, "raw_result_frame");
  try {
    assertWithinCeilings(projection, { utf8_bytes: DEFAULT_STATUS_FRAME_BUDGET_BYTES }, label);
  } catch (error) {

    const members = (result) => Object.entries(result.raw?.structuredContent ?? {})
      .map(([key, value]) => [key, Buffer.byteLength(JSON.stringify(value) ?? "")])
      .sort((left, right) => right[1] - left[1]);
    throw new assert.AssertionError({
      message: `${error.message}; members: ${JSON.stringify(results.map(members))}`,
      actual: error.actual, expected: error.expected, operator: error.operator });
  }
  return projection;
}

const PUBLICATION_CLAIM_KEYS = Object.freeze(["published", "merged", "landed", "handed_off",
  "publication", "landing", "pull_request"]);

function publicationClaims(value, at = "", found = []) {
  if (!value || typeof value !== "object") return found;
  for (const [key, member] of Object.entries(value)) {
    if (PUBLICATION_CLAIM_KEYS.includes(key) && member !== null && member !== false) {
      found.push(`${at}${key}`);
    }
    publicationClaims(member, `${at}${key}.`, found);
  }
  return found;
}

export function defaultStatusConclusion(payload, label = "default status") {
  const fail = (fact) => {
    throw new assert.AssertionError({ message: `default_status_fact_missing: ${label}: ${fact}`,
      actual: payload, expected: fact, operator: "defaultStatusConclusion" });
  };
  if (payload?.accepted !== true) fail("accepted run observation");
  for (const field of ["attempt_id", "subject", "status"]) {
    if (typeof payload[field] !== "string" || payload[field].length === 0) fail(field);
  }
  if (typeof payload.terminal !== "boolean" || typeof payload.child_terminal !== "boolean") {
    fail("terminal and child_terminal");
  }
  const claims = publicationClaims(payload);
  if (claims.length > 0) fail(`no publication claim (found ${claims.join(", ")})`);
  const lifecycle = payload.slice_lifecycle ?? null;
  const resolution = payload.lifecycle_resolution ?? null;
  if (payload.terminal) {
    if (payload.child_terminal !== true) fail("a terminal run has a terminal child");
    if (resolution !== null && resolution.resolved !== true) fail("terminal only when the lifecycle resolved");
    if (lifecycle !== null && lifecycle.phase !== "finalized") fail("terminal only when finalized");
  } else if (typeof payload.next_action !== "string") fail("next_action of a nonterminal run");

  const correction = payload.required_correction ?? resolution?.required_correction ?? null;
  if (correction !== null && (typeof correction.correction !== "string" ||
      typeof correction.then !== "string" || typeof correction.retry_alone_repairs !== "boolean")) {
    fail("the required correction, its follow-up and retry_alone_repairs");
  }
  const proof = payload.proof_verification ?? null;
  let verification = null;
  if (proof !== null) {
    if (proof.grants_authority !== false) fail("proof_verification grants no authority");
    if (proof.state === "none_recorded" && !/not a pass/u.test(proof.meaning ?? "")) {
      fail("an unrecorded verification says it is not a pass");
    }
    if (proof.state === "recorded") {
      const latest = proof.last_recorded_invocation;
      if (!Number.isInteger(proof.recorded_count) || !proof.status_counts) fail("recorded counts");
      if (typeof latest?.status !== "string" || typeof latest.coverage_scope !== "string") {
        fail("the latest invocation's status and coverage scope");
      }
      if (!Array.isArray(latest.outcome?.proofs) || latest.outcome.proofs.some((row) =>
        typeof row.status !== "string" || typeof row.execution_status !== "string" ||
        typeof row.selected_status !== "string")) {
        fail("each carried proof row's status, execution and selected-test outcome");
      }
      if (!proof.detail_call) fail("the recorded verification's detail call");
      verification = {
        recorded: proof.recorded_count,
        status_counts: proof.status_counts,
        latest: {
          invocation_id: latest.invocation_id,
          status: latest.status,
          coverage_scope: latest.coverage_scope,
          tested_source: latest.tested_source?.source_snapshot_digest ?? null,
          proofs: latest.outcome.proofs.map((row) => ({ status: row.status,
            execution_status: row.execution_status, selected_status: row.selected_status,
            limitations: row.capability_limitations ?? [] }))
        }
      };
    } else verification = { recorded: proof.recorded_count ?? null, state: proof.state };
  }
  let delivery = null;
  let candidate = null;
  if (lifecycle !== null) {
    if (typeof lifecycle.phase !== "string") fail("lifecycle phase");
    if (!lifecycle.complete?.call && lifecycle.view !== undefined) fail("the complete-result call");
    if (lifecycle.integrated === true) {
      const integration = lifecycle.integration ?? {};
      for (const field of ["delivery_sha", "wk_sha"]) {
        if (typeof integration[field] !== "string") fail(`integration.${field}`);
      }
      delivery = { delivery_sha: integration.delivery_sha, wk_sha: integration.wk_sha,
        previous_wk_sha: integration.previous_wk_sha ?? null };
    }
    if (lifecycle.terminal_candidate !== undefined) {
      const view = lifecycle.terminal_candidate;
      for (const field of ["candidate", "base", "wk_tip"]) {
        if (typeof view?.[field] !== "string") fail(`terminal_candidate.${field}`);
      }
      candidate = { candidate: view.candidate, base: view.base, wk_tip: view.wk_tip,
        candidate_ref: view.candidate_ref ?? null };
    }
    if (payload.terminal && typeof lifecycle.cleanup?.state !== "string") fail("cleanup state");
  }
  return {
    run: { attempt_id: payload.attempt_id, subject: payload.subject, child_status: payload.status,
      terminal: payload.terminal, child_terminal: payload.child_terminal },
    next: payload.terminal ? "stop_run_terminal" : payload.next_action,
    correction: correction === null ? null : { kind: correction.kind,
      retry_alone_repairs: correction.retry_alone_repairs },
    failure_reason: resolution?.latest_failure?.failure_cause?.reason ?? null,
    verification,
    lifecycle_phase: lifecycle?.phase ?? null,
    delivery,
    candidate,
    cleanup: lifecycle?.cleanup?.state ?? null,
    review: "unknown",
    publication: "unknown"
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const DIAGNOSTIC_COLLECTION = /diagnostic|reason|warning|finding|error/iu;

const VALIDATE_PROOF_TOOL = "workspace_validate_proof";

export function responseRepetitions(payload, { minimumSubtreeBytes = 1024 } = {}) {
  const findings = [];
  const subtrees = new Map();
  const walk = (value, at, inherited) => {
    if (!value || typeof value !== "object") return;
    const key = stableJson(value);
    if (Buffer.byteLength(key) >= minimumSubtreeBytes && !inherited) {
      const seen = subtrees.get(key);
      if (seen) findings.push({ kind: "duplicate_response_subtree", path: at, first: seen, bytes: Buffer.byteLength(key) });
      else subtrees.set(key, at);
    }

    const repeated = inherited || (Buffer.byteLength(key) >= minimumSubtreeBytes && subtrees.get(key) !== at);
    if (Array.isArray(value) && DIAGNOSTIC_COLLECTION.test(at.split("/").at(-1) ?? "")) {
      const items = new Map();
      value.forEach((item, index) => {
        const identity = stableJson(item);
        if (items.has(identity)) {
          findings.push({ kind: "duplicate_diagnostic_fact", path: `${at}/${index}`, first: `${at}/${items.get(identity)}` });
        } else items.set(identity, index);
      });
    }
    for (const [name, item] of Object.entries(value)) walk(item, `${at}/${name}`, repeated);
  };
  walk(payload, "", false);
  return findings;
}

const DIAGNOSIS_SUBJECT_MEMBERS = new Set(["diagnostic_group_id", "semantic_cause_id", "affected_obligation_ids",
  "affected_obligation_ids_truncated", "affected_obligation_ids_omitted", "affected_obligation_count",
  "occurrence_count", "global_occurrence_count", "detail_call", "inspection_call", "supported_next_call"]);

const diagnosisMeaning = value => Array.isArray(value) ? value.map(diagnosisMeaning)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value)
    .filter(([name]) => !DIAGNOSIS_SUBJECT_MEMBERS.has(name)).map(([name, item]) => [name, diagnosisMeaning(item)]))
    : value;

export function validationDiagnosisSites(payload) {
  const found = [];
  const broken = [];
  const seen = new Set();
  const diagnostics = payload?.diagnostics;
  if (diagnostics && typeof diagnostics === "object" && Array.isArray(diagnostics.issues)) {
    const meanings = Array.isArray(diagnostics.meanings) ? diagnostics.meanings : null;
    if (meanings === null) broken.push({ path: "/diagnostics/meanings", reason: "meanings_absent" });
    diagnostics.issues.forEach((issue, index) => {
      const path = `/diagnostics/issues/${index}`;
      seen.add(issue);
      const reference = issue?.meaning;
      const meaning = meanings !== null && Number.isInteger(reference) ? meanings[reference] : undefined;
      if (meaning === undefined || meaning === null || typeof meaning !== "object") {
        broken.push({ path, reason: "meaning_reference_unresolved", reference: reference ?? null });
        return;
      }
      const groupId = issue?.call?.arguments?.diagnostic_group_id ?? null;
      found.push({ path, meaning_path: `/diagnostics/meanings/${reference}`,
        diagnosis: { diagnostic_group_id: groupId, ...meaning } });
    });
  }
  if (payload?.selected && typeof payload.selected === "object" &&
      typeof payload.selected.diagnostic_group_id === "string") {
    seen.add(payload.selected);
    found.push({ path: "/selected", diagnosis: payload.selected });
  }
  const walk = (value, at) => {
    if (!value || typeof value !== "object") return;
    if (!seen.has(value) && typeof value.diagnostic_group_id === "string" &&
        (Object.hasOwn(value, "code") || Object.hasOwn(value, "reason_codes"))) {
      found.push({ path: at, diagnosis: value });
    }
    for (const [name, item] of Object.entries(value)) walk(item, `${at}/${name}`);
  };
  walk(payload, "");
  return { diagnoses: found, broken };
}

export function sharedDiagnosisRepetitions(payload, { minimumMeaningBytes }) {
  assert.ok(Number.isInteger(minimumMeaningBytes) && minimumMeaningBytes > 0, "an explicit meaning floor is required");
  const findings = [];
  const groups = new Map();
  const meanings = new Map();
  const { diagnoses, broken } = validationDiagnosisSites(payload);
  for (const entry of broken) findings.push({ kind: "diagnosis_reference_broken", ...entry });
  const stored = payload?.diagnostics?.meanings;
  if (Array.isArray(stored)) {
    const summaries = new Map();
    stored.forEach((meaning, index) => {
      const key = stableJson(meaning);
      const bytes = Buffer.byteLength(key);
      const first = summaries.get(key);
      if (first !== undefined && bytes >= minimumMeaningBytes) {
        findings.push({ kind: "shared_diagnosis_repeated", path: `/diagnostics/meanings/${index}`,
          first: `/diagnostics/meanings/${first}`, bytes });
      } else if (first === undefined) summaries.set(key, index);
    });
  }
  for (const { path: at, meaning_path: meaningPath = null, diagnosis } of diagnoses) {
    const groupId = diagnosis.diagnostic_group_id;
    const first = typeof groupId === "string" ? groups.get(groupId) : undefined;
    if (first) findings.push({ kind: "repeated_diagnosis_group", path: at, first, diagnostic_group_id: groupId });
    else if (typeof groupId === "string") groups.set(groupId, at);
    const meaning = stableJson(diagnosisMeaning(diagnosis));
    const bytes = Buffer.byteLength(meaning);
    const same = meanings.get(meaning);

    if (bytes >= minimumMeaningBytes && same && !first && (meaningPath === null || same.meaning_path !== meaningPath)) {
      findings.push({ kind: "shared_diagnosis_repeated", path: at, first: same.path, bytes });
    } else if (!same) meanings.set(meaning, { path: at, meaning_path: meaningPath });
  }
  return findings;
}

const guidanceSelection = entry => {
  const selector = entry.arguments?.input_contract;
  if (entry.tool !== "workspace_tools_describe" || selector?.kind !== "guidance") return null;
  const selection = entry.response?.results?.[0]?.input_guidance;
  if (!selection || !Array.isArray(selector.path) || !Object.hasOwn(selection, "value")) return null;
  return { tool: entry.arguments.tool_name, path: selector.path, digest: selection.source_digest };
};

const isPrefix = (prefix, path) => prefix.length <= path.length &&
  prefix.every((segment, index) => segment === path[index]);

const DIGEST_FIELDS = ["content_digest", "source_digest", "current_source_digest"];
const EXPECTED_FIELDS = ["expected_content_digest", "expected_source_digest"];

const holdsValue = (container, value) => {
  const wanted = stableJson(value);
  const walk = node => stableJson(node) === wanted || (node !== null && typeof node === "object" &&
    Object.values(node).some(walk));
  return walk(container);
};

const valueAt = (value, fieldPath) => fieldPath.reduce((current, name) => current?.[name], value);

export function correctionClauseFacts(response) {
  const facts = new Set();
  const walk = (value, definitions) => {
    if (Array.isArray(value)) { value.forEach(item => walk(item, definitions)); return; }
    if (!value || typeof value !== "object") return;
    const own = value.corrections && typeof value.corrections === "object" && !Array.isArray(value.corrections)
      ? value.corrections : definitions;
    for (const subject of Array.isArray(value.subjects) ? value.subjects : []) {
      for (const clause of Array.isArray(subject?.corrections) ? subject.corrections : []) {
        facts.add(stableJson([subject.obligation_id ?? null, clause, own?.[clause]?.field ?? null]));
      }
    }
    for (const item of Object.values(value)) walk(item, own);
  };
  walk(response, null);
  return facts;
}

export function selectedDiagnosisSuppliedUsedFact(entry, { calls, actions, rules = [], exempt = () => false }) {
  const byId = new Map(calls.map(call => [call.id, call]));
  const earlier = calls.filter(call => call.id < entry.id && !exempt(call));
  const earlierClauses = new Set(earlier.flatMap(call => [...correctionClauseFacts(call.response)]));
  for (const action of actions) {
    const request = byId.get(action.request);
    if (!request || request.id <= entry.id || exempt(request)) continue;
    for (const antecedent of action.antecedents ?? []) {
      if (antecedent.source !== entry.id || antecedent.derived !== undefined) continue;
      const published = valueAt(entry.response, antecedent.source_field ?? []);
      if (published === undefined || published === null) continue;
      if (antecedent.rule !== undefined) {
        const typed = antecedent.rule;
        const field = valueAt(entry.response, typed.definition ?? []);
        const subject = valueAt(entry.response, typed.subject ?? []);
        const written = antecedent.field ?? [];
        const requestField = written.length > 2 && written[0] === "obligations"
          ? `obligations[].${written.slice(2).join(".")}` : null;
        const activated = rules.some(rule => rule.status === "matched" && rule.source === entry.id &&
          rule.rule === typed.id && isDeepStrictEqual(rule.typed?.member, antecedent.source_field));
        if (published !== typed.clause || field !== requestField || !activated) continue;
        if (valueAt(request.arguments, [...written.slice(0, 2), "obligation_id"]) !== subject) continue;
        if (valueAt(request.arguments, written) === undefined) continue;
        if (earlierClauses.has(stableJson([subject, published, field]))) continue;
        return { action: action.action, request: request.id, field: antecedent.field,
          source_field: antecedent.source_field, kind: "typed_correction_clause" };
      }
      if (!isDeepStrictEqual(valueAt(request.arguments, antecedent.field ?? []), published)) continue;
      if (earlier.some(call => holdsValue(call.response, published) || holdsValue(call.arguments, published))) continue;
      return { action: action.action, request: request.id, field: antecedent.field,
        source_field: antecedent.source_field, kind: "copied_value" };
    }
  }
  return null;
}

export function detailSuppliedUsedFact(entry, { calls, actions, exempt = () => false }) {
  const byId = new Map(calls.map(call => [call.id, call]));
  const earlier = calls.filter(call => call.id < entry.id && !exempt(call));
  for (const action of actions) {
    const request = byId.get(action.request);
    if (!request || request.id <= entry.id || exempt(request)) continue;
    for (const antecedent of action.antecedents ?? []) {
      if (antecedent.source !== entry.id || antecedent.derived !== undefined) continue;
      const published = valueAt(entry.response, antecedent.source_field ?? []);
      if (published === undefined || published === null) continue;
      if (!isDeepStrictEqual(valueAt(request.arguments, antecedent.field ?? []), published)) continue;
      if (earlier.some(call => holdsValue(call.response, published))) continue;
      return { action: action.action, request: request.id, field: antecedent.field, source_field: antecedent.source_field };
    }
  }
  return null;
}

function followsNewCall(entry, emitter, calls, exempt) {
  const known = callablesIn(emitter.response);
  return calls.some(later => later.id > entry.id && later.emitted_by === entry.id && !exempt(later) &&
    !known.some(call => sameCallable(call, { tool: later.tool, arguments: later.arguments })) &&
    callablesIn(entry.response).some(call => sameCallable(call, { tool: later.tool, arguments: later.arguments })));
}

export function journeyRedundancy(trace, { minimumSubtreeBytes = 1024, retrievalTools = [], actions = [],
  rules = [] } = {}) {
  const findings = [];
  const calls = trace.filter(entry => entry.method === "tools/call" && entry.outcome !== "transport_failure");
  const exempt = entry => ["restart", "conformance_control", "setup"].includes(entry.purpose ?? "consumer");
  const byId = new Map(calls.map(entry => [entry.id, entry]));
  calls.forEach((entry, index) => {
    const earlier = calls.slice(0, index).filter(prior => !exempt(prior));
    const describe = { id: entry.id, tool: entry.tool, note: entry.note, purpose: entry.purpose ?? "consumer" };
    if (!exempt(entry)) {
      const selection = guidanceSelection(entry);
      const held = selection && earlier.find(prior => {
        const prev = guidanceSelection(prior);
        return prev && prev.tool === selection.tool && prev.digest === selection.digest &&
          isPrefix(prev.path, selection.path);
      });
      if (held) findings.push({ kind: "guidance_member_reread", ...describe, held_by: held.id });
      const key = stableJson([entry.tool, entry.arguments]);
      const repeated = entry.purpose !== "freshness" && earlier.find(prior =>
        prior.generation === entry.generation && stableJson([prior.tool, prior.arguments]) === key &&
        prior.response_digest === entry.response_digest);
      if (repeated && !held) findings.push({ kind: "repeated_read", ...describe, repeats: repeated.id });

      if (retrievalTools.includes(entry.tool) && entry.purpose !== "freshness" &&
          !(entry.decision?.missing?.length > 0)) {
        findings.push({ kind: "retrieval_dependency_unrecorded", ...describe });
      } else if (entry.decision !== null && entry.decision !== undefined &&
          !(entry.consumed?.length > 0)) {
        findings.push({ kind: "retrieval_unused", ...describe, decides: entry.decision.decides });
      }
      const emitter = byId.get(entry.emitted_by);
      if (emitter && entry.arguments?.detail !== undefined) {

        const { field_path: _narrowed, ...detail } = entry.arguments.detail;
        const requested = { tool: entry.tool, arguments: { ...entry.arguments, detail } };
        const offered = callablesIn(emitter.response).find(call => sameCallable(call, requested));
        const known = callablesIn(emitter.response).filter(call => call.arguments?.detail === undefined);
        const added = callablesIn(entry.response).filter(call => call.arguments?.detail === undefined &&
          !known.some(prior => sameCallable(prior, call)));
        if (offered?.recommended === true && added.length === 0 &&
            detailSuppliedUsedFact(entry, { calls, actions, exempt }) === null) {
          findings.push({ kind: "redundant_recommended_detail", ...describe, recommended_by: emitter.id });
        }
      }
      if (emitter && entry.tool === VALIDATE_PROOF_TOOL && (typeof entry.arguments?.diagnostic_group_id === "string" ||
          typeof entry.arguments?.obligation_id === "string") &&
          selectedDiagnosisSuppliedUsedFact(entry, { calls, actions, rules, exempt }) === null &&
          !followsNewCall(entry, emitter, calls, exempt)) {
        findings.push({ kind: "redundant_selected_diagnosis", ...describe, emitted_by: emitter.id });
      }
    }
    if (entry.purpose === "freshness") {
      const digests = DIGEST_FIELDS.map(field => entry.response?.[field]).filter(value => typeof value === "string");
      const consumed = calls.slice(index + 1).some(later =>
        EXPECTED_FIELDS.some(field => digests.includes(later.arguments?.[field])));
      if (!consumed) findings.push({ kind: "freshness_read_unused", ...describe });
    }
    for (const repetition of responseRepetitions(entry.response, { minimumSubtreeBytes })) {
      findings.push({ ...repetition, ...describe });
    }
  });
  return findings;
}
