import { CREATE_RECORD_ROUTE, creationMaintenanceSubject, saveMaintenanceSubject } from "./record-authoring-maintenance-subject.mjs";

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { createSyncEffects, planReplacement, runCrashDurablePlanSync } from
  "@agent-chassis/wiki-core/src/lib/crash-durable-state.mjs";
import { withSidecarUpdaterLock } from "@agent-chassis/wiki-core/src/lib/sidecar-store-lifecycle.mjs";

import { describeRetentionFailure, getResponseSpillConfig, jsonContent } from "./mcp-response.mjs";
import { findSelectedResponseSources, readSelectedResponseSource, retainSelectedResponseSource, selectedResponseQueryInvalidError } from "./selected-response-snapshot.mjs";
import { runRepositoryChecks } from "./work-record-closeout-response.mjs";
import { createMutationRecovery, mutationAuthorityIdentity } from './record-mutation-recovery.mjs';
import { recoverWorkRecordAdmissionArtifactCleanup } from '@agent-chassis/wiki-core/src/operations/work-records-store-io.mjs';

export const SAVE_RECORD_ROUTE = "workspace_save_record";
export const SAVE_RECORD_MAINTENANCE_ATTEMPTS_SCHEMA_VERSION = "save-record-maintenance-attempts.v2";
export const SAVE_RECORD_MAINTENANCE_LOCK_TIMEOUT_MS = 1000;
const CHECK_MEMBER = "generate_and_lint";
const CLEANUP_MEMBER = 'admission_artifact_cleanup';
const APPLICABLE_MEMBERS = Object.freeze([CHECK_MEMBER]);
const OWNER_DIRECTORY = "save-record-maintenance";

const memberOf = ({ checked_corpus: _corpus, ...check }) => ({ member: CHECK_MEMBER,
  state: check.ran !== true ? "not_run" : check.ok === true ? "succeeded" : check.ok === false ? "failed" : "unknown", check });
const pendingOf = (members) => members.filter((entry) => entry.state !== "succeeded")
  .map((entry) => entry.member);
function cleanupCheckpoint(carrier) {
  const persistence = carrier.persistence ?? carrier.receipt?.terminal_receipt;
  const cleanup = persistence?.admission_sidecar_cleanup;
  if (cleanup?.ok !== false) return null;
  const paths = cleanup.failed?.length ? cleanup.failed.map(entry => entry.sidecar_path)
    : [...(cleanup.diagnostic?.operation?.startsWith('cleanup_reference_') ? cleanup.immutable ?? [] : cleanup.unreferenced ?? []),
      ...(cleanup.stages ?? [])];
  if (!paths.length) return null;
  return { member: CLEANUP_MEMBER, state: 'failed', paths, check: { ran: true,
    cause_code: cleanup.diagnostic?.cause_code ?? cleanup.diagnostic?.code ?? 'artifact_cleanup_incomplete',
    cause_message: cleanup.diagnostic?.message ?? 'Published mutation left admission artifact cleanup incomplete.',
    top_findings: cleanup.failed ?? [], write_effects_retained: true } };
}
function unstartedMaintenance(cleanup = null) {
  return { applicable: true, members: [...APPLICABLE_MEMBERS.map(member => ({ member, state: 'not_run', check: { ran: false,
    cause_code: 'maintenance_not_started', cause_message: 'Maintenance did not start after the reported publication failure.' } })),
  ...(cleanup === null ? [] : [cleanup])] };
}

const causeOf = (error) => ({ code: error?.code ?? null, message: error?.message ?? String(error),
  ...(error?.details === undefined ? {} : { details: error.details }),
  ...(error?.cause === undefined ? {} : { cause: causeOf(error.cause) }) });

class MaintenanceStateError extends Error {
  constructor(code, message, details = {}, cause) { super(message, { cause }); this.code = code; this.details = details; }
}

export function createSaveRecordMaintenance({ workspace, responseEnv = process.env, generateAndLint,
  authorityIdentity, lockTimeoutMs = SAVE_RECORD_MAINTENANCE_LOCK_TIMEOUT_MS, effects = createSyncEffects() }) {
  const ownerDir = path.join(getResponseSpillConfig(responseEnv).stateDir, OWNER_DIRECTORY);
  const lockPath = path.join(ownerDir, "coordination.sqlite");
  const inFlight = new Map();

  const responseOwner = (envelope, options) => jsonContent(envelope, { env: responseEnv, ...options,
    selectedAccess: () => ({ operator_only: true }) });
  const authority = (unit, route) => mutationAuthorityIdentity(workspace, { ...authorityIdentity(unit), route });
  const retain = ({ unit, carrier, queryIdentity, observationIdentity, route = SAVE_RECORD_ROUTE }) => retainSelectedResponseSource({
    binding: { route, repository: workspace.repo, unit, query_identity: queryIdentity,
      observation_identity: observationIdentity, authority_identity: authority(unit, route) }, carrier }, { responseOwner });
  const indexPath = (source) => path.join(ownerDir, `${createHash("sha256")
    .update(JSON.stringify([workspace.repo, source.ref_id]), "utf8").digest("hex")}.json`);

  function readIndex(source, original) {
    const file = indexPath(source);
    if (!existsSync(file)) return { schema_version: SAVE_RECORD_MAINTENANCE_ATTEMPTS_SCHEMA_VERSION,
      original: { ...source, unit: original.unit, ...(original.revision === undefined ? {} : { revision: original.revision }),
        producer: original.producer }, attempts: [] };
    let index;
    try { index = JSON.parse(readFileSync(file, "utf8")); } catch { index = null; }

    if (index?.schema_version !== SAVE_RECORD_MAINTENANCE_ATTEMPTS_SCHEMA_VERSION || !Array.isArray(index.attempts) ||
        index.original?.ref_id !== source.ref_id || index.attempts.some(attempt => !Number.isInteger(attempt.ordinal) ||
          attempt.ordinal < 1 || !['running', 'settled', 'outcome_unknown'].includes(attempt.state) ||
          !Array.isArray(attempt.pending) || !Array.isArray(attempt.members))) {
      throw new MaintenanceStateError("save_record_maintenance_state_corrupt",
        "Retained maintenance state is unreadable; this operation's execution outcome cannot be established.");
    }
    return index;
  }
  function writeIndex(source, index) {
    mkdirSync(ownerDir, { recursive: true });
    const targetPath = indexPath(source);
    const run = runCrashDurablePlanSync(planReplacement({ targetPath,
      privatePath: `${targetPath}.${process.pid}.${Date.now()}.private`,
      bytes: `${JSON.stringify(index, null, 2)}\n` }), effects);
    if (run.failed_fault !== null) throw new MaintenanceStateError("save_record_maintenance_state_unwritable",
      "the maintenance attempt index could not be durably published", { failed_fault: run.failed_fault }, run.error);
  }

  const corpusRecord = (original) => original.kind === "work_item" ? original.unit.split("#")[0] : null;

  function checkedSource(original, check) {
    const corpus = check.checked_corpus ?? null;
    const record = corpusRecord(original);
    const captured = corpus !== null && record !== null ? corpus.records?.[record] ?? null : null;
    return { unit: original.unit, saved_revision: original.revision ?? null,
      ...(original.producer === "create" ? { created_source: original.source, created_read_identity: original.read_identity,
        ...(captured === null ? { checked_source_unavailable: { code: record === null
          ? "creation_checked_page_identity_unavailable" : "creation_checked_record_identity_unavailable" } } : {}) } : {}),
      saved_record_source_digest: original.record_source_digest ?? null,
      checked_corpus: corpus === null ? null : { schema_version: corpus.schema_version,
        digest: corpus.digest, work_record_count: corpus.work_record_count },
      checked_record_source_digest: captured,
      moved_since_save: captured === null || original.record_source_digest == null ? null
        : captured !== original.record_source_digest };
  }

  function retainedAttempt(source, unit, ordinal) {
    return findSelectedResponseSources({ env: responseEnv, expected: {
      route: SAVE_RECORD_ROUTE, repository: workspace.repo, unit,
      query_identity: { operation: 'maintenance_attempt', unit, attempt: ordinal },
      observation_identity: { original: source }, authority_identity: authority(unit, SAVE_RECORD_ROUTE) } });
  }
  function operationAttempt(source, carrier, ordinal) {
    if (carrier?.mutation_request === undefined) return null;
    const route = Object.hasOwn(carrier.mutation_request, 'kind') ? CREATE_RECORD_ROUTE : SAVE_RECORD_ROUTE;
    const recovered = createMutationRecovery({ route, workspace, responseEnv, authorityIdentity })
      .observe(carrier.mutation_request, carrier.unit).body;
    if (recovered.original?.locator?.ref_id !== source.ref_id || recovered.maintenance?.attempt !== ordinal) return null;
    return { operation: ordinal === 1 ? 'save_maintenance' : 'maintenance_retry', unit: carrier.unit,
      original_save: source, attempt: ordinal, members: recovered.maintenance.members,
      checked_source: recovered.maintenance.checked_source, effects: recovered.maintenance.effects };
  }
  function observedAttemptState(source, unit, ordinal = null) {
    const observations = findSelectedResponseSources({ env: responseEnv, expected: { route: SAVE_RECORD_ROUTE,
      repository: workspace.repo, unit, query_identity: { operation: 'save_observation', unit },
      authority_identity: authority(unit, SAVE_RECORD_ROUTE) } }).filter(candidate => candidate.current &&
        candidate.binding.observation_identity?.original?.ref_id === source.ref_id);
    const candidates = observations.map(({ binding, carrier }) => {
      const number = binding.observation_identity.attempt ?? carrier.attempts?.at(-1)?.ordinal ?? 0;
      const result = carrier.result ?? (carrier.maintenance?.members?.length ? {
        operation: 'maintenance_observation', unit, original_save: source, attempt: number, members: carrier.maintenance.members,
        checked_source: carrier.maintenance.checked_source, effects: carrier.maintenance.effects } : null);
      const known = result?.members.every(member => member.check !== undefined || member.state === 'not_run');
      return { ordinal: number, result: known ? result : null };
    }).filter(candidate => ordinal === null || candidate.ordinal === ordinal);
    if (!candidates.length) return null;
    const number = candidates.reduce((greatest, candidate) => Math.max(greatest, candidate.ordinal), 0);
    const known = candidates.filter(candidate => candidate.ordinal === number && candidate.result !== null);
    if (!known.length) return { ordinal: number, result: null };
    const meanings = new Set(known.map(candidate => JSON.stringify(candidate.result.members)));
    if (meanings.size !== 1) throw new MaintenanceStateError('maintenance_outcome_ambiguous',
      'Retained observations disagree about this maintenance attempt. No unique outcome can be established.');
    return known[0];
  }
  function retainAttemptResult(source, unit, ordinal, result) {
    return retain({ unit, carrier: result, queryIdentity: { operation: 'maintenance_attempt', unit, attempt: ordinal },
      observationIdentity: { original: source } });
  }
  async function runAttempt({ source, original, observedAttempt }) {
    const index = readIndex(source, original);
    let last = index.attempts.at(-1) ?? null;
    let reconstructed = false;
    if (last === null && original.initial !== true) {
      const observed = observedAttemptState(source, original.unit);
      if (observed?.result !== null && observed?.ordinal > 0) {
        const results = retainedAttempt(source, original.unit, observed.ordinal);
        last = { ordinal: observed.ordinal, state: 'settled', members: observed.result.members.map(member => member.member),
          pending: pendingOf(observed.result.members), outcome: results.length === 1 ? results[0].result
            : retainAttemptResult(source, original.unit, observed.ordinal, observed.result) };
        index.attempts.push(last); writeIndex(source, index);
        reconstructed = true;
      } else if (observed?.ordinal !== 0) {
        const error = new MaintenanceStateError('maintenance_execution_outcome_unavailable',
          'No retained state establishes what maintenance already ran. Stop; do not rerun checks to discover its outcome.');
        error.execution_not_started = true; throw error;
      }
    }
    if (last?.state === 'running' || last?.state === 'outcome_unknown') {
      const recorded = retainedAttempt(source, original.unit, last.ordinal);
      if (recorded.length > 1) throw new MaintenanceStateError('maintenance_outcome_ambiguous',
        'More than one retained result describes this attempt; no unique result can be selected.');
      const known = recorded.length === 1 && recorded[0].current ? recorded[0].carrier
        : observedAttemptState(source, original.unit, last.ordinal)?.result ?? operationAttempt(source, original.carrier, last.ordinal);
      if (known !== null) {
        last.state = 'settled';
        last.outcome = recorded.length === 1 ? recorded[0].result : retainAttemptResult(source, original.unit, last.ordinal, known);
        last.pending = pendingOf(known.members);

        writeIndex(source, index);
      } else {
        const error = new MaintenanceStateError('maintenance_execution_outcome_unavailable',
          'The admitted attempt has no retained completion facts. It may have executed; stop rather than rerun checks to discover its outcome.');
        error.execution_not_started = true;
        throw error;
      }
    }

    if (!reconstructed && last !== null && last.state === "settled" && (last.ordinal > (observedAttempt?.ordinal ?? 0) ||
        (last.ordinal === observedAttempt?.ordinal && observedAttempt.state === "running" && observedAttempt.execution_complete !== true))) {
      return { outcome: "joined_attempt", attempt: last, attempts: index.attempts,
        result: authenticated(last.outcome).carrier };
    }
    if (last?.state === "settled" && last.pending.length === 0) {
      return { outcome: "no_retry_needed", attempt: last, attempts: index.attempts,
        result: authenticated(last.outcome).carrier };
    }

    if (last?.state === "running") last.state = "outcome_unknown";
    const settledBefore = index.attempts.findLast((entry) => entry.state === "settled") ?? null;
    const pending = settledBefore === null ? [...APPLICABLE_MEMBERS] : settledBefore.pending;
    let priorResult = null;
    if (settledBefore !== null) {
      try { priorResult = settledBefore.outcome === null ? null : authenticated(settledBefore.outcome).carrier; }
      catch (error) {
        priorResult = observedAttemptState(source, original.unit, settledBefore.ordinal)?.result ?? operationAttempt(source, original.carrier, settledBefore.ordinal);
        if (priorResult === null) { error.execution_not_started = true; throw error; }
      }
      priorResult ??= observedAttemptState(source, original.unit, settledBefore.ordinal)?.result ?? operationAttempt(source, original.carrier, settledBefore.ordinal);
      if (priorResult === null) {
        const error = new MaintenanceStateError('maintenance_completed_result_unavailable',
          'Previously completed maintenance has no readable result. Its deciding cause cannot be established; do not rerun it to discover the outcome.');
        error.execution_not_started = true; throw error;
      }
    }
    const attempt = { ordinal: (last?.ordinal ?? 0) + 1, state: "running", members: pending, pending, outcome: null };
    index.attempts.push(attempt);
    try { writeIndex(source, index); } catch (error) {

      error.execution_not_started = true;
      throw error;
    }

    const record = corpusRecord(original);
    const prior = priorResult?.members ?? [];
    const members = [...prior];
    const replace = member => {
      const at = members.findIndex(value => value.member === member.member);
      if (at < 0) members.push(member); else members[at] = member;
    };
    let checksRan = false;
    let checkedSourceResult = priorResult?.checked_source ?? null;
    if (pending.includes(CHECK_MEMBER)) {
      const check = await runRepositoryChecks({ workspaceDir: workspace.dir, generateAndLint,
        identifyRecords: record === null ? [] : [record] });
      checksRan = check.ran === true;
      checkedSourceResult = checkedSource(original, check);
      replace(memberOf(check));
    }
    if (original.cleanup !== null && original.cleanup !== undefined) {
      if (attempt.ordinal === 1 && original.deferInitial !== true) replace(original.cleanup);
      else if (pending.includes(CLEANUP_MEMBER) || attempt.ordinal === 1) {
        try {
          const cleaned = await recoverWorkRecordAdmissionArtifactCleanup({ dir: workspace.dir, id: original.unit.split('#')[0], paths: original.cleanup.paths });
          replace({ member: CLEANUP_MEMBER, state: cleaned.ok ? 'succeeded' : 'failed', check: { ran: true, ok: cleaned.ok,
            ...(cleaned.ok ? {} : { cause_code: cleaned.diagnostic?.cause_code ?? cleaned.diagnostic?.code,
              cause_message: cleaned.diagnostic?.message, top_findings: cleaned.failed }),
            removed: cleaned.removed, write_effects_retained: true } });
        } catch (error) { replace({ member: CLEANUP_MEMBER, state: 'failed', check: { ran: true,
          cause_code: error.code, cause_message: error.message, write_effects_retained: true } }); }
      }
    }
    const result = { operation: attempt.ordinal === 1 ? original.producer === "create" ? "creation_maintenance" : "save_maintenance" : "maintenance_retry",
      unit: original.unit, original_save: source, attempt: attempt.ordinal, members,
      checked_source: checkedSourceResult,
      effects: { canonical_mutation_repeated: false, checks_ran: checksRan } };
    attempt.pending = pendingOf(members);
    try {
      attempt.outcome = retain({ unit: original.unit, carrier: result,
        queryIdentity: { operation: "maintenance_attempt", unit: original.unit, attempt: attempt.ordinal },
        observationIdentity: { original: source } });
    } catch (error) {
      attempt.retention_failure = describeRetentionFailure(error, { operation: "retain_save_record_maintenance_attempt",
        subject: { unit: original.unit, attempt: attempt.ordinal } });
    }
    attempt.state = "settled";
    try { writeIndex(source, index); } catch (error) {
      attempt.state = "outcome_unknown";
      return { outcome: "maintenance_attempt_outcome_unknown", attempt, attempts: index.attempts, result,
        coordination: { state: "publication_failed", stage: "settled_attempt", cause: causeOf(error) },
        retry: { unit: original.unit, maintenance_retry: { save_result: source } } };
    }
    return { outcome: attempt.pending.length === 0 ? "maintenance_succeeded" : "maintenance_failed",
      attempt, attempts: index.attempts, result };
  }

  async function attemptFor({ source, original }) {
    const key = indexPath(source);
    if (inFlight.has(key)) return { ...(await inFlight.get(key)), joined: true };
    mkdirSync(ownerDir, { recursive: true });
    const observedAttempt = readIndex(source, original).attempts.at(-1) ?? null;
    if (observedAttempt?.state === 'running' || observedAttempt?.state === 'outcome_unknown') {
      observedAttempt.execution_complete = retainedAttempt(source, original.unit, observedAttempt.ordinal).length === 1 ||
        observedAttemptState(source, original.unit, observedAttempt.ordinal)?.result != null;
    }
    const running = withSidecarUpdaterLock(lockPath, () => runAttempt({ source, original, observedAttempt }),
      { timeoutMs: lockTimeoutMs }).catch((error) => {
      if (error?.code !== "contention") throw error;
      return { outcome: "maintenance_attempt_in_progress", attempt: null,
        attempts: readIndex(source, original).attempts,
        retry: { unit: original.unit, maintenance_retry: { save_result: source } } };
    });
    inFlight.set(key, running);
    try { return await running; } finally { inFlight.delete(key); }
  }

  async function settleInitial(saved, creationSubject = null, onProgress = null) {
    const creation = creationSubject !== null;
    const published = creation ? saved.effects?.published === true : saved.outcome === "saved" || saved.effects?.published === true;
    if (!published) {
      return { complete: { ...saved, maintenance: { applicable: false, members: [] } },
        original: { available: false, locator: null, reason: "nothing_published" } };
    }
    const subject = creation ? creationSubject : saveMaintenanceSubject(saved);
    const original = { ...subject, ...(creation && saved.revision !== undefined ? { revision: saved.revision } : {}),
      producer: creation ? "create" : "save", cleanup: cleanupCheckpoint(saved), deferInitial: saved.outcome === 'failed', carrier: saved, initial: true };
    const route = creation ? CREATE_RECORD_ROUTE : SAVE_RECORD_ROUTE;
    let source;
    try {
      source = retain({ unit: subject.unit, carrier: saved, route,
        queryIdentity: creation ? { operation: "create", unit: subject.unit, subject }
          : { operation: "save", unit: subject.unit },
        observationIdentity: creation ? { source: subject.source, read_identity: subject.read_identity }
          : { revision: saved.revision, prior_revision: saved.prior_revision } });
    } catch (error) {

      const unavailable = { available: false, locator: null, reason: creation ? 'creation_receipt_unavailable' : 'save_receipt_unavailable',
        retention_failure: describeRetentionFailure(error, { operation: creation ? 'retain_create_record_result' : 'retain_save_record_result',
          subject: { unit: subject.unit, ...(saved.revision === undefined ? {} : { revision: saved.revision }) } }) };
      if (saved.outcome === 'failed') return { complete: { ...saved, maintenance: unstartedMaintenance(original.cleanup) }, original: unavailable };
      const record = corpusRecord(original);
      const check = await runRepositoryChecks({ workspaceDir: workspace.dir, generateAndLint,
        identifyRecords: record === null ? [] : [record] });
      return { complete: { ...saved, maintenance: { applicable: true, attempt: null, members: [memberOf(check), ...(original.cleanup === null ? [] : [original.cleanup])],
        checked_source: checkedSource(original, check) } },
      original: unavailable };
    }
    let settled;
    onProgress?.({ ...saved, original: { available: true, locator: source } });
    if (saved.outcome === 'failed') return { complete: { ...saved, maintenance: unstartedMaintenance(original.cleanup) },
      original: { available: true, locator: source } };
    try {
      settled = await attemptFor({ source, original });
    } catch (error) {

      return { complete: { ...saved, maintenance: { applicable: true, attempt: null,
        state: "maintenance_attempt_outcome_unknown",
        cause: causeOf(error),
        members: APPLICABLE_MEMBERS.map((member) => ({ member,
          state: error.execution_not_started === true ? "not_run" : "unknown" })) } },
      original: { available: true, locator: source } };
    }
    const maintenance = settled.result === undefined
      ? { applicable: true, attempt: null, state: settled.outcome,
        members: APPLICABLE_MEMBERS.map((member) => ({ member, state: "unknown" })) }
      : { applicable: true, attempt: settled.attempt.ordinal, members: settled.result.members,
        checked_source: settled.result.checked_source,
        effects: settled.result.effects,
        ...(settled.coordination === undefined ? {} : { state: settled.outcome, coordination: settled.coordination,
          cause: settled.coordination.cause }),
        ...(settled.attempt.outcome === null ? { outcome_retention_failure: settled.attempt.retention_failure }
          : { outcome: settled.attempt.outcome }) };
    return { complete: { ...saved, maintenance, ...(settled.retry === undefined ? {} : { retry: settled.retry }) },
      original: { available: true, locator: source } };
  }

  async function retry({ unit, saveResult: source }) {
    const { binding, carrier } = authenticated(source, unit, true);
    const original = { ...(binding.route === CREATE_RECORD_ROUTE
      ? { ...binding.query_identity.subject, ...(carrier.revision === undefined ? {} : { revision: carrier.revision }), producer: "create" }
      : { ...saveMaintenanceSubject(carrier), producer: "save" }), cleanup: cleanupCheckpoint(carrier), deferInitial: carrier.outcome === 'failed', carrier };
    const settled = await attemptFor({ source, original });
    return { ...settled, unit, original_save: source,
      original: { ...(original.producer === "create" ? { producer: "create", source: original.source,
        read_identity: original.read_identity } : { revision: carrier.revision, prior_revision: carrier.prior_revision }),
        effects: carrier.effects },
      effects: { canonical_mutation_repeated: false, checks_ran: settled.outcome === 'no_retry_needed' ? false : settled.result?.effects.checks_ran ?? false } };
  }

  function retainObservation(carrier) {
    try {
      const source = retain({ unit: carrier.unit, carrier,
        queryIdentity: { operation: "save_observation", unit: carrier.unit },
        observationIdentity: { original: carrier.original?.locator ?? carrier.original_save ?? null,
          attempt: carrier.maintenance?.attempt ?? carrier.attempt?.ordinal ?? null } });
      return { available: true, locator: source };
    } catch (error) {
      return { available: false, locator: null, retention_failure: describeRetentionFailure(error,
        { operation: "retain_save_observation", subject: { unit: carrier.unit } }) };
    }
  }

  function authenticated(source, requestedUnit = null, originalOnly = false) {
    const retained = readSelectedResponseSource(source, { env: responseEnv, route: SAVE_RECORD_ROUTE,
      expected: { repository: workspace.repo } });
    const { binding, carrier } = retained;
    const operation = binding.query_identity?.operation;
    const creation = binding.route === CREATE_RECORD_ROUTE && operation === "create";
    const save = binding.route === SAVE_RECORD_ROUTE && operation === "save";
    const observation = binding.route === SAVE_RECORD_ROUTE &&
      ["save_observation", "maintenance_attempt"].includes(operation);
    if ((!creation && !save && !(observation && !originalOnly)) ||
        (requestedUnit !== null && binding.unit !== requestedUnit) ||
        binding.query_identity.unit !== binding.unit) throw selectedResponseQueryInvalidError(SAVE_RECORD_ROUTE,
      "source_binding_mismatch", { binding_field: "query_identity" });
    const verified = readSelectedResponseSource(source, { env: responseEnv, route: SAVE_RECORD_ROUTE,
      expected: { route: binding.route, repository: workspace.repo, unit: binding.unit,
        authority_identity: authority(binding.unit, binding.route), query_identity: binding.query_identity } });
    if (creation) {
      const subject = binding.query_identity.subject;
      const checked = creationMaintenanceSubject({ unit: subject?.unit, kind: subject?.kind,
        source: subject?.source, readIdentity: subject?.read_identity, recordSourceDigest: subject?.record_source_digest });
      if (checked.unit !== binding.unit || !['created', 'failed'].includes(carrier.outcome) || carrier.effects?.published !== true ||
          (carrier.unit !== undefined && carrier.unit !== binding.unit) ||
          (carrier.kind !== undefined && carrier.kind !== subject.kind) ||
          (subject.read_identity?.repository !== undefined && subject.read_identity.repository !== workspace.repo)) throw selectedResponseQueryInvalidError(
        SAVE_RECORD_ROUTE, "source_binding_mismatch", { binding_field: "subject" });
    } else if (carrier.unit !== binding.unit) throw selectedResponseQueryInvalidError(SAVE_RECORD_ROUTE,
      "source_binding_mismatch", { binding_field: "unit" });
    return verified;
  }
  function readOriginal(source) { return authenticated(source); }

  async function observe({ unit, saveResult: source }) {
    const { binding, carrier } = authenticated(source, unit, true);
    const index = readIndex(source, { ...carrier, producer: binding.route === CREATE_RECORD_ROUTE ? 'create' : 'save' });
    const last = index.attempts.at(-1);
    const base = { unit, original_save: source,
      effects: { canonical_mutation_repeated: false, checks_ran: false } };
    const observation = observedAttemptState(source, unit, last?.ordinal ?? null);
    if (last === undefined && observation?.ordinal === 0 && observation.result !== null) return {
      ...base, outcome: 'maintenance_not_run', maintenance: { members: observation.result.members } };
    const ordinal = last?.ordinal ?? observation?.ordinal;
    const outcomes = ordinal === undefined ? [] : retainedAttempt(source, unit, ordinal);
    const recorded = outcomes.length === 0 ? observation?.result ?? (ordinal === undefined ? null : operationAttempt(source, carrier, ordinal)) : null;
    if (outcomes.length === 1 && outcomes[0].current || recorded !== null) {
      const result = recorded ?? outcomes[0].carrier;
      return { ...base, outcome: pendingOf(result.members).length ? 'maintenance_failed' : 'maintenance_succeeded', result };
    }
    const unavailable = last?.state === 'settled' || outcomes.length > 1;
    return { ...base, outcome: unavailable ? 'maintenance_outcome_unavailable' : 'maintenance_attempt_in_progress',
      ...(unavailable ? { recovery: { missing_capability: 'retained_maintenance_outcome',
        correction: 'The specific completed result is unavailable or ambiguous. Stop this recovery; do not rerun completed checks or replay the mutation.' } } : {}),
      maintenance: { state: unavailable ? 'maintenance_outcome_unavailable' : 'maintenance_attempt_in_progress',
        cause: { code: outcomes.length > 1 ? 'maintenance_outcome_ambiguous' : 'maintenance_completion_not_recorded',
          message: outcomes.length > 1 ? 'More than one retained result describes this attempt; no unique outcome can be selected.'
            : last?.state === 'settled' ? 'Maintenance settled, but its detailed outcome is unavailable; completed checks must not be rerun.'
            : 'Completion is not recorded; this attempt may still be running or may have been interrupted.' } } };
  }
  async function observeBody(body) {
    const source = body.original?.locator;
    if (source === undefined) return body;
    let current;
    try { current = await observe({ unit: body.unit, saveResult: source }); }
    catch (error) {

      const knownComplete = body.maintenance?.members?.length > 0 && body.maintenance.members.every(member =>
        member.state === 'succeeded' && member.check?.cause_code == null && member.check?.cause_message == null);
      if (knownComplete) return body;
      return { ...body, original: { available: false, locator: null }, recovery: {
        missing_capability: 'authenticated_maintenance_original', cause: causeOf(error),
        correction: 'The retained mutation outcome stands, but its maintenance credential is unavailable. Do not repeat the mutation or rerun checks to discover their outcome.' } };
    }
    const result = current.result;
    return { ...body, maintenance: result === undefined ? current.maintenance
      : { members: result.members, checked_source: result.checked_source, effects: result.effects },
      ...(current.recovery === undefined ? {} : { recovery: current.recovery }),
      ...(result?.members.some(member => member.member === CLEANUP_MEMBER && member.state === 'succeeded') ? { cleanup_resolved: true } : {}),
      original: body.original };
  }

  async function settleCreation(created, subject, onProgress = null) {
    if (!['created', 'failed'].includes(created.outcome) || created.effects?.published !== true || subject === null) return {
      complete: { ...created, maintenance: created.effects?.published === true
        ? { applicable: true, members: APPLICABLE_MEMBERS.map(member => ({ member, state: "not_run" })) }
        : { applicable: false, members: [] } },
      original: { available: false, locator: null, reason: created.effects?.published === true
        ? "creation_receipt_unavailable" : "publication_not_established" } };
    const projected = creationMaintenanceSubject(subject);
    if (["source", "area"].includes(projected.kind) && Object.hasOwn(created, "revision")) {
      throw new TypeError("Source and area creation do not supply a save revision");
    }
    if ((created.unit !== undefined && created.unit !== projected.unit) ||
        (created.kind !== undefined && created.kind !== projected.kind) ||
        (projected.read_identity.repository !== undefined && projected.read_identity.repository !== workspace.repo)) {
      throw new TypeError("Creation producer result and subject are mismatched");
    }
    return settleInitial(created, projected, onProgress);
  }

  const receiptUnavailable = () => ({
    original: { available: false, locator: null, reason: "save_receipt_unavailable" },
    maintenance: { applicable: true, members: APPLICABLE_MEMBERS.map((member) => ({ member, state: "not_run" })) }
  });
  return Object.freeze({ settleInitial, settleCreation, retry, observe, observeBody, retainObservation, readOriginal, receiptUnavailable });
}
