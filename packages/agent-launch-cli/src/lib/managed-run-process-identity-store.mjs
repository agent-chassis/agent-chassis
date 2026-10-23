

import path from "node:path";
import { activeCompletion, arbitrateCompletion, completionObservations, COMPLETION_OBSERVATION_KIND,
  deliveryCompletionRelease, reconcileDeliveryCompletion } from "./managed-run-completion-observation.mjs";
import {
  CRASH_DURABLE_RESULTS,
  createSyncEffects,
  planLockAcquisition,
  planReplacement,
  runCrashDurablePlanSync
} from "@agent-chassis/wiki-core/src/lib/crash-durable-state.mjs";
import {
  ATTEMPT_EVENT_KINDS,
  ATTEMPT_JOURNAL_REFUSALS,
  admitAttemptCommand,
  admitReviewOriginalBinding,
  attemptJournalFilePath,
  attemptJournalRootDir,
  attemptJournalRefusal,
  attemptPartitionLockPath,
  pageManagedAttemptDetail,
  parseAttemptJournal,
  projectManagedAttemptObservations,
  resultDigest,
  reviewOriginalPartitionSubject,
  selectManagedAttempt,
  selectReviewOriginalBinding,
  serializeAttemptJournal,
  validateAttemptJournal
} from "@agent-chassis/agent-launch-core";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeSync
} from "node:fs";

import {
  assertKillShape,
  captureProcessIdentity,
  defaultLivenessDeps,
  readSystemMonotonic
} from "./worktree-lease.mjs";

import {
  MANAGED_RUN_PROCESS_IDENTITY_CODES,
  MANAGED_RUN_PROCESS_IDENTITY_SCHEMA_VERSION,
  MANAGED_RUN_PROCESS_IDENTITY_STATES,
  MANAGED_RUN_PROCESS_IDENTITY_VERDICTS,
  RETIREMENT_REASON_VALUES,
  deriveManagedRunIdentityTupleFromBindingPair,
  fail,
  hasExactKeys,
  isPlainObject,
  normalizeManagedRunIdentityTuple,
  sameTuple
} from "./managed-run-process-identity-contract.mjs";

export function managedRunProcessIdentityStoreDir(mainRepo) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo)) {
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG,
      `mainRepo must be an absolute path, got: ${JSON.stringify(mainRepo)}`
    );
  }
  return path.join(mainRepo, ".agent-launch", "managed-run-identity");
}

export function managedRunProcessIdentityFilePath(mainRepo, tuple) {
  const normalized = normalizeManagedRunIdentityTuple(tuple);
  const key = JSON.stringify([
    MANAGED_RUN_PROCESS_IDENTITY_SCHEMA_VERSION,
    normalized.assigned_unit,
    normalized.launch_ref,
    normalized.run_id,
    normalized.retry_id
  ]);
  const digest = createHash("sha256").update(key).digest("hex");
  return path.join(managedRunProcessIdentityStoreDir(mainRepo), `identity-${digest}.json`);
}

export function readAttemptJournalEvents({ mainRepo, repository, subject, includeVerifiedSource = false,
  filePath = attemptJournalFilePath(mainRepo, repository, subject) }) {
  let body;
  try {
    body = readFileSync(filePath);
  } catch (err) {
    if (err && err.code === "ENOENT") return Object.freeze({ events: Object.freeze([]), refusal: null, file_path: filePath });
    return Object.freeze({
      events: Object.freeze([]),
      refusal: attemptJournalRefusal(ATTEMPT_JOURNAL_REFUSALS.UNREADABLE, "the attempt journal could not be read", { errno: err?.code ?? null }),
      file_path: filePath
    });
  }
  const parsed = parseAttemptJournal(body.toString("utf8"));
  if (parsed.ok !== true) {
    return Object.freeze({
      events: Object.freeze(parsed.durable_prefix ?? []),
      refusal: parsed.refusal,
      file_path: filePath
    });
  }
  return Object.freeze({ events: Object.freeze(parsed.events), refusal: null, file_path: filePath,
    ...(includeVerifiedSource ? { verified_source: { serializedBytes: body,
      source: { sha256: createHash("sha256").update(body).digest("hex") } } } : {}) });
}

export function publishAttemptJournalEvents({ mainRepo, repository, subject, events,
  filePath = attemptJournalFilePath(mainRepo, repository, subject) }) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const result = runCrashDurablePlanSync(
    planReplacement({
      targetPath: filePath,
      privatePath: `${filePath}.attempt-${process.pid}.tmp`,
      bytes: serializeAttemptJournal(events)
    }),
    createSyncEffects({ mode: 0o600 })
  );
  if (result.classification !== CRASH_DURABLE_RESULTS.PUBLISHED) {
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.STORE_WRITE_FAILED,
      `failed to durably publish the managed-worker attempt journal: ${filePath}`,
      { errno: result.error?.code ?? null },
      result.error
    );
  }
  return Object.freeze({ published: true, file_path: filePath, event_count: events.length });
}

export function withAttemptPartitionLock({ mainRepo, repository, subject }, mutate) {
  const canonicalPath = attemptPartitionLockPath(mainRepo, repository, subject);
  const ownerToken = randomUUID();
  const stagingPath = `${canonicalPath}.staging-${ownerToken}`;
  mkdirSync(path.dirname(canonicalPath), { recursive: true });
  let ownerIdentity;
  try {
    ownerIdentity = JSON.stringify(captureProcessIdentity(process.pid, defaultLivenessDeps));
  } catch (error) {
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.IDENTITY_CAPTURE_FAILED,
      "cannot capture the partition lock owner identity; refusing to mutate (fail closed)",
      { source_code: error?.code ?? null },
      error
    );
  }
  const acquisition = runCrashDurablePlanSync(
    planLockAcquisition({ canonicalPath, stagingPath, ownerToken, ownerIdentity }),
    createSyncEffects({ mode: 0o600 })
  );
  if (acquisition.classification !== CRASH_DURABLE_RESULTS.LOCK_ACQUIRED) {
    return Object.freeze({ acquired: false, contended: true, result: null });
  }
  try {
    return Object.freeze({ acquired: true, contended: false, result: mutate() });
  } finally {
    try {
      rmSync(canonicalPath, { recursive: true, force: true });
    } catch {   }
  }
}

function readValidatedAttemptJournal(mainRepo, subject, includeVerifiedSource = false) {
  const repository = mainRepo;
  const read = readAttemptJournalEvents({ mainRepo, repository, subject, includeVerifiedSource });
  if (read.refusal !== null) {
    return { ok: false, refusal: read.refusal, repository, events: read.events };
  }
  const validated = validateAttemptJournal({ repository, subject, events: read.events });
  if (!validated.valid) {
    return { ok: false, refusal: validated.refusal, repository, events: read.events };
  }
  return { ok: true, repository, events: validated.events, verified_source: read.verified_source };
}

export function readManagedRunObservation({ mainRepo, subject, attemptId = null, detail = null,
  sliceBinding = null, includeVerifiedSource = false, includeProofSummary = false }) {
  const read = readValidatedAttemptJournal(mainRepo, subject, includeVerifiedSource);
  if (!read.ok) return sliceBinding === null ? read : { ok: false, refusal: read.refusal };
  const withSource = result => includeVerifiedSource
    ? { ...result, verified_source: read.verified_source } : result;

  if (sliceBinding !== null) {
    if (attemptId !== null || detail !== null) return { ok: false, code: "attempt_detail_request_invalid" };
    const binding = selectProofVerificationAttempt({ repository: read.repository, subject,
      events: read.events, sliceBinding });
    if (!binding.ok) return binding;
    if (!sameTuple(binding.retained, binding.derived)) return { ok: false, code: "attempt_binding_mismatch" };
    const selected = selectManagedAttempt({ repository: read.repository, subject,
      events: read.events, attemptId: binding.retained.run_id });
    const assigned = selected.ok ? { ...selected.selected } : null;
    if (assigned !== null) {
      delete assigned.original_result;
      const request = completionObservations(read.events, assigned.dispatch_tuple)
        .find(item => item.alternative === "assignment_change_requested");
      if (request !== undefined) assigned.assignment_change = request;
    }
    return withSource(selected.ok ? { ok: true, selected: assigned }
      : { ok: false, code: selected.code, ...(selected.refusal ? { refusal: selected.refusal } : {}) });
  }
  if (detail !== null) {
    const page = pageManagedAttemptDetail({
      repository: read.repository,
      subject,
      events: read.events,
      attemptId,
      kind: detail.kind,
      cursor: detail.cursor ?? null,
      limit: detail.limit ?? 20,
      invocationId: detail.invocation_id ?? null,
      complete: detail.complete === true
    });
    return page.ok && includeVerifiedSource ? { ...page, verified_source: read.verified_source } : page;
  }
  let selected = selectManagedAttempt({ repository: read.repository, subject, events: read.events, attemptId });
  if (selected.ok) {
    const request = completionObservations(read.events, selected.selected.dispatch_tuple).find(item => item.alternative === "assignment_change_requested");
    if (request !== undefined) selected = { ...selected, selected: { ...selected.selected, assignment_change: request } };
  }
  if (!selected.ok || !includeProofSummary) return withSource(selected);
  const proof_detail = pageManagedAttemptDetail({ repository: read.repository, subject, events: read.events,
    attemptId: selected.selected.dispatch_tuple.run_id, kind: "proof_verification", limit: 1 });
  return withSource({ ...selected, proof_detail });
}

function appendManagedRunObservation({ mainRepo, subject, runId, kind, payload, predicate = null }) {
  const repository = mainRepo;
  const locked = withAttemptPartitionLock({ mainRepo, repository, subject }, () => {
    const read = readAttemptJournalEvents({ mainRepo, repository, subject });
    if (read.refusal !== null) return { ok: false, refusal: read.refusal };
    const selection = selectManagedAttempt({
      repository,
      subject,
      events: read.events,
      attemptId: runId
    });
    if (!selection.ok || selection.selected?.dispatch_tuple === null) {
      return {
        ok: false,
        code: selection.code ?? "attempt_binding_unavailable",
        refusal: selection.refusal ?? null
      };
    }
    const resolvedPayload = typeof payload === "function"
      ? payload(selection.selected.dispatch_tuple, selection.selected)
      : payload;
    if (resolvedPayload === null) return { ok: false, code: "attempt_binding_mismatch" };
    if (predicate !== null) {
      const verdict = predicate({ events: read.events, selected: selection.selected });
      if (!verdict.ok || !verdict.appended) return verdict;
    }
    const admitted = admitAttemptCommand({
      repository,
      subject,
      events: read.events,
      attempt: selection.selected.attempt,
      kind,
      payload: resolvedPayload
    });
    if (!admitted.admitted) return { ok: false, refusal: admitted.refusal };
    if (admitted.appended !== false) {
      publishAttemptJournalEvents({ mainRepo, repository, subject, events: admitted.events });
    }
    return { ok: true, appended: admitted.appended !== false, event: admitted.event };
  });
  if (!locked.acquired) return { ok: false, code: "attempt_partition_contended" };
  return locked.result;
}

export function recordManagedRunOriginal({ mainRepo, subject, dispatchTuple, result, originalResult }) {
  return appendManagedRunObservation({ mainRepo, subject, runId: dispatchTuple.run_id,
    kind: ATTEMPT_EVENT_KINDS.RUN_ORIGINAL_RECORDED,
    payload: (current, selected) => sameTuple(current, dispatchTuple) &&
      (selected.result === null || selected.result_digest === resultDigest(result)) ? {
      dispatch_tuple: dispatchTuple, result_digest: resultDigest(result), original_result: originalResult
    } : null });
}

export function reviewOriginalBindingFilePath(mainRepo, subject) {
  return path.join(path.dirname(attemptJournalFilePath(mainRepo, mainRepo, reviewOriginalPartitionSubject(subject))),
    "review-originals.jsonl");
}
const reviewOriginalPartition = (mainRepo, subject) => ({ mainRepo, repository: mainRepo,
  subject: reviewOriginalPartitionSubject(subject), filePath: reviewOriginalBindingFilePath(mainRepo, subject) });

export function recordManagedReviewOriginal({ mainRepo, subject, runId, role, originalResult }) {
  const partition = reviewOriginalPartition(mainRepo, subject);
  const locked = withAttemptPartitionLock(partition, () => {
    const read = readAttemptJournalEvents(partition);
    if (read.refusal !== null) return { ok: false, refusal: read.refusal };
    const admitted = admitReviewOriginalBinding({ repository: mainRepo, subject, events: read.events,
      binding: { run_id: runId, role, original_result: originalResult } });
    if (!admitted.admitted) return { ok: false, refusal: admitted.refusal };
    if (admitted.appended) publishAttemptJournalEvents({ ...partition, events: admitted.events });
    return { ok: true, appended: admitted.appended };
  });
  if (!locked.acquired) return { ok: false, code: "attempt_partition_contended" };
  return locked.result;
}

export function readManagedReviewOriginal({ mainRepo, subject, attemptId = null }) {
  const read = readAttemptJournalEvents(reviewOriginalPartition(mainRepo, subject));
  if (read.refusal !== null) return { ok: false, refusal: read.refusal };
  return selectReviewOriginalBinding({ repository: mainRepo, subject, events: read.events, attemptId });
}

export function recordManagedRunResult({ mainRepo, subject, dispatchTuple, result }) {
  return appendManagedRunObservation({
    mainRepo,
    subject,
    runId: dispatchTuple.run_id,
    kind: ATTEMPT_EVENT_KINDS.RUN_RESULT_RECORDED,
    payload: {
      dispatch_tuple: dispatchTuple,
      result_digest: resultDigest(result),
      result
    }
  });
}

export function assessManagedRunResultPublication({ mainRepo, subject, dispatchTuple, result }) {
  const read = readValidatedAttemptJournal(mainRepo, subject);
  if (!read.ok) return read;
  const selection = selectManagedAttempt({
    repository: read.repository,
    subject,
    events: read.events,
    attemptId: dispatchTuple.run_id
  });
  if (!selection.ok) return selection;
  const admitted = admitAttemptCommand({
    repository: read.repository,
    subject,
    events: read.events,
    attempt: selection.selected.attempt,
    kind: ATTEMPT_EVENT_KINDS.RUN_RESULT_RECORDED,
    payload: { dispatch_tuple: dispatchTuple, result_digest: resultDigest(result), result }
  });
  if (!admitted.admitted) return { ok: false, refusal: admitted.refusal };
  return { ok: true, state: admitted.appended === false ? "already_recorded" : "append_admissible" };
}

export function recordManagedLifecycleFailure({
  mainRepo,
  subject,
  dispatchTuple,
  invocationId,
  failure
}) {
  return appendManagedRunObservation({
    mainRepo,
    subject,
    runId: dispatchTuple.run_id,
    kind: ATTEMPT_EVENT_KINDS.LIFECYCLE_FAILURE_RECORDED,
    payload: {
      dispatch_tuple: dispatchTuple,
      invocation_id: invocationId,
      failure
    }
  });
}

function selectProofVerificationAttempt({ repository, subject, events, sliceBinding }) {
  const projected = projectManagedAttemptObservations({ repository, subject, events });
  if (!projected.ok) return { ok: false, refusal: projected.refusal };
  const matches = projected.attempts.filter((item) =>
    item.dispatch_tuple?.assigned_unit === subject &&
    item.dispatch_tuple.launch_ref === sliceBinding?.launch_ref);
  if (matches.length !== 1) {
    return { ok: false, code: matches.length === 0 ? "attempt_binding_unavailable" : "attempt_selection_ambiguous" };
  }
  const retained = matches[0].dispatch_tuple;
  let derived;
  try {
    derived = deriveManagedRunIdentityTupleFromBindingPair({
      assignedUnit: subject,
      launchRef: retained.launch_ref,

      wkBinding: {},
      sliceBinding,
      expectedRunId: retained.run_id
    });
  } catch (error) {
    return { ok: false, code: "attempt_binding_mismatch", cause_code: error?.code ?? null };
  }
  return { ok: true, retained, derived };
}

export function recordManagedProofVerification({
  mainRepo,
  subject,
  sliceBinding,
  invocationId,
  verification
}) {
  return recordManagedInvocationObservation({ mainRepo, subject, sliceBinding, invocationId,
    kind: ATTEMPT_EVENT_KINDS.PROOF_VERIFICATION_RECORDED, field: "verification", value: verification });
}

function recordManagedInvocationObservation({ mainRepo, subject, sliceBinding, invocationId, kind, field, value, predicate = null }) {
  const repository = mainRepo;
  const read = readAttemptJournalEvents({ mainRepo, repository, subject });
  if (read.refusal !== null) return { ok: false, refusal: read.refusal };
  const selected = selectProofVerificationAttempt({ repository, subject, events: read.events, sliceBinding });
  if (!selected.ok) return selected;
  const { retained, derived } = selected;
  return appendManagedRunObservation({
    mainRepo,
    subject,
    runId: retained.run_id,
    kind,
    predicate,
    payload: (current) => (sameTuple(current, derived)
      ? { dispatch_tuple: current, invocation_id: invocationId, [field]: value }
      : null)
  });
}

export function recordManagedDeliveryReceipt({ mainRepo, subject, sliceBinding, receipt }) {
  return recordManagedInvocationObservation({ mainRepo, subject, sliceBinding,
    invocationId: receipt.result.ref_id, kind: ATTEMPT_EVENT_KINDS.DELIVERY_RECEIPT_RECORDED,
    field: "receipt", value: receipt });
}

export function recordManagedCompletion({ mainRepo, subject, sliceBinding, completion }) {
  let recorded;
  try {
    recorded = recordManagedInvocationObservation({ mainRepo, subject, sliceBinding,
      invocationId: completion.intent_id, kind: COMPLETION_OBSERVATION_KIND, field: "completion", value: completion,
      predicate: ({ events, selected }) => ({ ...arbitrateCompletion({ events, selected, completion }),
        pending_termination: selected.result === null }) });
  } catch (error) {
    error.retained_completion = completion;
    throw error;
  }
  return recorded.ok && recorded.event !== undefined
    ? { ...recorded, completion: recorded.event.payload.completion } : recorded;
}

export function readManagedCompletion({ mainRepo, subject, attemptId = null, sliceBinding = null }) {
  const read = readValidatedAttemptJournal(mainRepo, subject);
  if (!read.ok) return read;
  if (read.events.length === 0 && sliceBinding === null) return { ok: true, dispatch_tuple: null, completion: null };
  if (sliceBinding !== null) {
    const binding = selectProofVerificationAttempt({ repository: mainRepo, subject, events: read.events, sliceBinding });
    if (!binding.ok) return binding;
    if (!sameTuple(binding.retained, binding.derived)) return { ok: false, code: "attempt_binding_mismatch" };
    attemptId = binding.retained.run_id;
  }
  const selected = selectManagedAttempt({ repository: mainRepo, subject, events: read.events, attemptId });
  if (!selected.ok) return selected;
  return { ok: true, dispatch_tuple: selected.selected.dispatch_tuple,
    completion: activeCompletion(completionObservations(read.events, selected.selected.dispatch_tuple)) };
}

export function reconcileManagedDeliveryCompletion({ mainRepo, subject, sliceBinding, original }) {
  const evidence = deliveryCompletionRelease({ subject, sliceBinding, original });
  if (!evidence.ok) return evidence;
  const { intent, completion } = evidence;
  return recordManagedInvocationObservation({ mainRepo, subject, sliceBinding,
    invocationId: completion.intent_id, kind: COMPLETION_OBSERVATION_KIND, field: "completion", value: completion,
    predicate: ({ events, selected }) => reconcileDeliveryCompletion({ events, selected, intent, completion }) });
}

export function findManagedDeliveryReceipt({ mainRepo, refId, subject = null, assignmentChange = false }) {
  const root = attemptJournalRootDir(mainRepo);
  let files;
  if (subject !== null) files = [attemptJournalFilePath(mainRepo, mainRepo, subject)];
  else {
    try { files = readdirSync(root).map(partition => path.join(root, partition, "journal.jsonl")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }
  const matches = [];
  for (const file of files) {
    let body;
    try { body = readFileSync(file, "utf8"); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (!body.includes(JSON.stringify(refId))) continue;
    const parsed = parseAttemptJournal(body);
    if (!parsed.ok) throw Object.assign(new Error(parsed.refusal.reason), { code: parsed.refusal.code, refusal: parsed.refusal });
    const selectedSubject = parsed.events[0]?.subject;
    if (typeof selectedSubject !== "string" ||
        file !== attemptJournalFilePath(mainRepo, mainRepo, selectedSubject) ||
        (subject !== null && selectedSubject !== subject)) {
      throw Object.assign(new Error("delivery receipt is in a foreign attempt partition"), { code: "attempt_binding_mismatch" });
    }
    if (assignmentChange) {
      const validated = validateAttemptJournal({ repository: mainRepo, subject: selectedSubject, events: parsed.events });
      if (!validated.valid) throw Object.assign(new Error(validated.refusal.reason), { code: validated.refusal.code });
      for (const event of parsed.events) if (event.kind === COMPLETION_OBSERVATION_KIND &&
          event.payload.completion.alternative === "assignment_change_requested" &&
          event.payload.completion.original.ref_id === refId) matches.push({ completion: event.payload.completion, dispatchTuple: event.payload.dispatch_tuple });
      continue;
    }
    const projected = projectManagedAttemptObservations({ repository: mainRepo, subject: selectedSubject, events: parsed.events });
    if (!projected.ok) throw Object.assign(new Error(projected.refusal.reason), { code: projected.refusal.code, refusal: projected.refusal });
    for (const attempt of projected.attempts) for (const { receipt } of attempt.delivery_receipts) {
      if (receipt.result.ref_id === refId) matches.push({ receipt, dispatchTuple: attempt.dispatch_tuple });
    }
  }
  if (matches.length > 1) throw Object.assign(new Error("delivery locator belongs to multiple attempts"), { code: "attempt_selection_ambiguous" });
  return matches[0] ?? null;
}

export function readManagedProofVerification({ mainRepo, subject, sliceBinding, invocationId }) {
  const read = readValidatedAttemptJournal(mainRepo, subject);
  if (!read.ok) return read;
  const selected = selectProofVerificationAttempt({ repository: read.repository, subject,
    events: read.events, sliceBinding });
  if (!selected.ok) return selected;
  if (!sameTuple(selected.retained, selected.derived)) return { ok: false, code: "attempt_binding_mismatch" };
  return pageManagedAttemptDetail({
    repository: read.repository,
    subject,
    events: read.events,
    attemptId: selected.retained.run_id,
    kind: "proof_verification",
    cursor: null,
    limit: 1,
    invocationId
  });
}

const PENDING_BRAND = Symbol("managed-run-process-identity.PendingPublication");

class PendingManagedRunIdentityPublication {
  constructor(brand, { mainRepo, tuple, filePath, record }) {
    if (brand !== PENDING_BRAND) {
      fail(
        MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG,
        "PendingManagedRunIdentityPublication is not externally constructible"
      );
    }
    this.mainRepo = mainRepo;
    this.tuple = tuple;
    this.filePath = filePath;
    this.record = record;
    Object.freeze(this);
  }
}

export function serializeRecord(record) {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export function writeExclusive(filePath, contents) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  let fd;
  try {
    fd = openSync(filePath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
  } catch (err) {
    if (err && err.code === "EEXIST") {
      fail(
        MANAGED_RUN_PROCESS_IDENTITY_CODES.STORE_COLLISION,
        `a managed-run identity record already exists for this exact tuple: ${filePath}`,
        { errno: err.code },
        err
      );
    }
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.STORE_WRITE_FAILED,
      `failed to create the managed-run identity record: ${filePath}`,
      { errno: err?.code ?? null },
      err
    );
  }
  try {
    writeSync(fd, contents);
  } catch (err) {
    try { closeSync(fd); } catch {   }
    try { unlinkSync(filePath); } catch {   }
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.STORE_WRITE_FAILED,
      `failed to write the managed-run identity record: ${filePath}`,
      { errno: err?.code ?? null },
      err
    );
  }
  try { closeSync(fd); } catch {   }
}

export function replaceAtomically(filePath, contents) {
  const temp = `${filePath}.publish-${process.pid}.tmp`;
  const result = runCrashDurablePlanSync(
    planReplacement({ targetPath: filePath, privatePath: temp, bytes: contents }),
    createSyncEffects({ mode: 0o600 })
  );
  if (result.classification !== CRASH_DURABLE_RESULTS.PUBLISHED) {
    const err = result.error;
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.STORE_WRITE_FAILED,
      `failed to atomically complete the managed-run identity record: ${filePath}`,
      { errno: err?.code ?? null },
      err
    );
  }
}

export function publishPendingManagedRunProcessIdentity({
  mainRepo,
  tuple,
  role,
  deps = defaultLivenessDeps
} = {}) {
  const normalized = normalizeManagedRunIdentityTuple(tuple);
  if (typeof role !== "string" || role.length === 0) {
    fail(MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG, "role must be a non-empty string");
  }
  let launcherIdentity;
  let publishedAt;
  try {
    launcherIdentity = captureProcessIdentity(process.pid, deps);
    publishedAt = readSystemMonotonic(deps);
  } catch (error) {
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.IDENTITY_CAPTURE_FAILED,
      "cannot capture the launcher's own non-reusable identity; refusing to publish (fail closed)",
      { source_code: error?.code ?? null },
      error
    );
  }
  const filePath = managedRunProcessIdentityFilePath(mainRepo, normalized);
  const record = {
    schema_version: MANAGED_RUN_PROCESS_IDENTITY_SCHEMA_VERSION,
    state: MANAGED_RUN_PROCESS_IDENTITY_STATES.PENDING,
    role,
    tuple: { ...normalized },
    launcher_identity: {
      pid: launcherIdentity.pid,
      starttime: launcherIdentity.starttime,
      boot_id: launcherIdentity.boot_id
    },
    published_at: { uptime: publishedAt.uptime, boot_id: publishedAt.boot_id },
    sandbox_identity: null,
    kill_shape: null,
    retirement: null
  };
  writeExclusive(filePath, serializeRecord(record));
  return new PendingManagedRunIdentityPublication(PENDING_BRAND, {
    mainRepo,
    tuple: normalized,
    filePath,
    record: Object.freeze(record)
  });
}

export function bindManagedRunSandboxProcessIdentity(pending, { pid, killShape, deps = defaultLivenessDeps } = {}) {
  if (!(pending instanceof PendingManagedRunIdentityPublication)) {
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.TOKEN_ORDER_VIOLATION,
      "binding the outer sandbox identity requires the token minted by the pending publication " +
      "(fixed order: publish pending -> spawn -> bind outer identity -> accept)"
    );
  }
  {
    if (!Number.isInteger(pid) || pid <= 0) {
      fail(
        MANAGED_RUN_PROCESS_IDENTITY_CODES.PUBLICATION_INCOMPLETE,
        `the accepted launch reported no usable outer sandbox pid, got: ${JSON.stringify(pid)}`
      );
    }
    assertKillShape(killShape);
    if (killShape.kind !== "process-group" && killShape.pid !== pid) {
      fail(
        MANAGED_RUN_PROCESS_IDENTITY_CODES.BINDING_MISMATCH,
        "the recorded kill shape does not address the exact outer sandbox pid",
        { kill_shape_pid: killShape.pid ?? null, outer_pid: pid }
      );
    }
    const sandboxIdentity = captureProcessIdentity(pid, deps);
    if (sandboxIdentity.boot_id !== pending.record.launcher_identity.boot_id) {

      fail(
        MANAGED_RUN_PROCESS_IDENTITY_CODES.BINDING_MISMATCH,
        "the outer sandbox boot_id disagrees with the launcher boot_id"
      );
    }
    const record = {
      ...pending.record,
      state: MANAGED_RUN_PROCESS_IDENTITY_STATES.BOUND,
      sandbox_identity: {
        pid: sandboxIdentity.pid,
        starttime: sandboxIdentity.starttime,
        boot_id: sandboxIdentity.boot_id
      },
      kill_shape: { ...killShape }
    };
    replaceAtomically(pending.filePath, serializeRecord(record));

    const readBack = readManagedRunProcessIdentity({ mainRepo: pending.mainRepo, tuple: pending.tuple });
    if (readBack === null || readBack.state !== MANAGED_RUN_PROCESS_IDENTITY_STATES.BOUND ||
        readBack.sandbox_identity?.pid !== sandboxIdentity.pid ||
        readBack.sandbox_identity?.starttime !== sandboxIdentity.starttime ||
        readBack.sandbox_identity?.boot_id !== sandboxIdentity.boot_id ||
        !sameTuple(normalizeManagedRunIdentityTuple(readBack.tuple), pending.tuple)) {
      fail(
        MANAGED_RUN_PROCESS_IDENTITY_CODES.PUBLICATION_INCOMPLETE,
        "the managed-run identity record did not round-trip as a complete bound publication"
      );
    }
    return Object.freeze(readBack);
  }
}

export function discardManagedRunProcessIdentity({ mainRepo, tuple } = {}) {
  const filePath = managedRunProcessIdentityFilePath(mainRepo, tuple);
  try {
    unlinkSync(filePath);
    return { discarded: true, file_path: filePath };
  } catch (err) {
    if (err && err.code === "ENOENT") return { discarded: false, file_path: filePath };
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.STORE_WRITE_FAILED,
      `failed to discard the managed-run identity record: ${filePath}`,
      { errno: err?.code ?? null },
      err
    );
    return null;
  }
}

const RECORD_TOP_LEVEL_KEYS_BY_STATE = Object.freeze({
  [MANAGED_RUN_PROCESS_IDENTITY_STATES.PENDING]: Object.freeze([
    "schema_version", "state", "role", "tuple", "launcher_identity",
    "published_at", "sandbox_identity", "kill_shape", "retirement"
  ]),
  [MANAGED_RUN_PROCESS_IDENTITY_STATES.BOUND]: Object.freeze([
    "schema_version", "state", "role", "tuple", "launcher_identity",
    "published_at", "sandbox_identity", "kill_shape", "retirement"
  ]),
  [MANAGED_RUN_PROCESS_IDENTITY_STATES.RETIRED]: Object.freeze([
    "schema_version", "state", "role", "tuple", "launcher_identity",
    "published_at", "sandbox_identity", "kill_shape", "retirement"
  ])
});

const IDENTITY_KEYS = Object.freeze(["pid", "starttime", "boot_id"]);
const PUBLISHED_AT_KEYS = Object.freeze(["uptime", "boot_id"]);
const KILL_SHAPE_KEYS = Object.freeze(["kind", "pid"]);
const RETIREMENT_KEYS = Object.freeze(["reason", "verdict", "retired_at", "evidence"]);

export function isValidProcessIdentity(value) {
  return hasExactKeys(value, IDENTITY_KEYS) &&
    Number.isInteger(value.pid) && value.pid > 0 &&
    typeof value.starttime === "string" && /^\d+$/.test(value.starttime) &&
    typeof value.boot_id === "string" && value.boot_id.length > 0;
}

export function isValidPublishedAt(value) {
  return hasExactKeys(value, PUBLISHED_AT_KEYS) &&
    typeof value.uptime === "number" && Number.isFinite(value.uptime) && value.uptime >= 0 &&
    typeof value.boot_id === "string" && value.boot_id.length > 0;
}

function isValidKillShapeFor(killShape, sandboxIdentity) {
  if (!hasExactKeys(killShape, KILL_SHAPE_KEYS)) return false;
  if (killShape.kind !== "bwrap-pid" && killShape.kind !== "interactive-pid") return false;
  try {
    assertKillShape(killShape);
  } catch {
    return false;
  }
  return killShape.pid === sandboxIdentity.pid;
}

export function isValidStoredTuple(tuple) {
  if (!hasExactKeys(tuple, ["assigned_unit", "launch_ref", "run_id", "retry_id"])) return false;
  try {
    normalizeManagedRunIdentityTuple(tuple);
    return true;
  } catch {
    return false;
  }
}

function isValidRetirement(retirement) {
  return hasExactKeys(retirement, RETIREMENT_KEYS) &&
    RETIREMENT_REASON_VALUES.has(retirement.reason) &&
    retirement.verdict === MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.PROVEN_DEAD &&
    isValidPublishedAt(retirement.retired_at) &&
    isPlainObject(retirement.evidence);
}

export function parseRecordBody(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed) ||
      parsed.schema_version !== MANAGED_RUN_PROCESS_IDENTITY_SCHEMA_VERSION ||
      typeof parsed.state !== "string") {
    return null;
  }
  const expectedKeys = RECORD_TOP_LEVEL_KEYS_BY_STATE[parsed.state];

  if (!expectedKeys || !hasExactKeys(parsed, expectedKeys)) return null;
  if (typeof parsed.role !== "string" || parsed.role.length === 0) return null;
  if (!isValidStoredTuple(parsed.tuple)) return null;
  if (!isValidProcessIdentity(parsed.launcher_identity)) return null;
  if (!isValidPublishedAt(parsed.published_at)) return null;
  if (parsed.state === MANAGED_RUN_PROCESS_IDENTITY_STATES.PENDING) {

    return parsed.sandbox_identity === null && parsed.kill_shape === null &&
      parsed.retirement === null
      ? parsed
      : null;
  }
  if (!isValidProcessIdentity(parsed.sandbox_identity)) return null;
  if (!isValidKillShapeFor(parsed.kill_shape, parsed.sandbox_identity)) return null;
  if (parsed.state === MANAGED_RUN_PROCESS_IDENTITY_STATES.BOUND) {
    return parsed.retirement === null ? parsed : null;
  }

  return isValidRetirement(parsed.retirement) ? parsed : null;
}

export function readManagedRunProcessIdentity({ mainRepo, tuple } = {}) {
  const filePath = managedRunProcessIdentityFilePath(mainRepo, tuple);
  let body;
  try {
    body = readFileSync(filePath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    return Object.freeze({ unreadable: true, file_path: filePath, errno: err?.code ?? null });
  }
  const parsed = parseRecordBody(body);
  if (parsed === null) return Object.freeze({ unreadable: true, file_path: filePath, errno: null });
  return Object.freeze({ ...parsed, file_path: filePath });
}

export function enumerateStoredRecords(mainRepo) {
  let entries;
  try {
    entries = readdirSync(managedRunProcessIdentityStoreDir(mainRepo));
  } catch (err) {
    if (err && err.code === "ENOENT") return { records: [], unreadable: [] };
    return { records: [], unreadable: [{ file_path: null, errno: err?.code ?? null }] };
  }
  const records = [];
  const unreadable = [];
  const storeDir = managedRunProcessIdentityStoreDir(mainRepo);
  for (const entry of entries) {
    if (!entry.startsWith("identity-") || !entry.endsWith(".json")) continue;
    const filePath = path.join(storeDir, entry);
    let body;
    try {
      body = readFileSync(filePath, "utf8");
    } catch (err) {
      unreadable.push({ file_path: filePath, errno: err?.code ?? null });
      continue;
    }
    const parsed = parseRecordBody(body);
    if (parsed === null) unreadable.push({ file_path: filePath, errno: null });
    else records.push(Object.freeze({ ...parsed, file_path: filePath }));
  }
  return { records, unreadable };
}
