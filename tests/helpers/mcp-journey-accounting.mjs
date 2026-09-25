

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

export function channels(raw) {
  assert.ok(raw && typeof raw === "object", `tool result must be an object: ${JSON.stringify(raw)}`);
  assert.ok(raw.structuredContent !== null && typeof raw.structuredContent === "object",
    `structured tool result must carry structuredContent: ${JSON.stringify(raw)}`);
  assert.deepEqual(raw.content, [], "structured tool result must not carry content beside structuredContent");
  return raw.structuredContent;
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

export const CALL_PURPOSES = Object.freeze({
  consumer: "a call the consuming journey needs to act",
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

export function journeyRedundancy(trace, { minimumSubtreeBytes = 1024, retrievalTools = [] } = {}) {
  const findings = [];
  const calls = trace.filter(entry => entry.method === "tools/call" && entry.outcome !== "transport_failure");
  const exempt = entry => ["restart", "conformance_control"].includes(entry.purpose ?? "consumer");
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
        if (offered?.recommended === true && added.length === 0) {
          findings.push({ kind: "redundant_recommended_detail", ...describe, recommended_by: emitter.id });
        }
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
