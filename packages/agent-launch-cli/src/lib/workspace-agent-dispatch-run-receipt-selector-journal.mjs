

import path from "node:path";
import { mkdir, open, readFile, readdir } from "node:fs/promises";

import {
  EXACT_REVIEW_RECEIPT_SELECTOR_CONFLICT_CODE,
  EXACT_REVIEW_RECEIPT_SELECTOR_INDEX_UNUSABLE_CODE,
  inject,
  parseSelectorIndex,
  receiptSelectorDigests,
  recordSelectorEntry,
  selectorIndexLine,
  serializeSelectorIndex,
  syncDirectory,
  typedRefusal,
  unitPartitionDigest,
  writeAtomicImmutable,
  writeAtomicPublished
} from "./workspace-agent-dispatch-run-receipt-store-io.mjs";
import {
  EVENT_FILE_RE,
  EXACT_REVIEW_RECEIPT_PARTITION_BINDING_CODE,
  EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V4,
  LAYOUT_MARKER_FILE,
  LAYOUT_MARKER_SCHEMA_VERSION,
  PARTITION_DIRECTORY,
  PARTITION_DIR_RE,
  SELECTOR_INDEX_FILE,
  STORE_EVENT_SCHEMA_VERSION
} from "./workspace-agent-dispatch-run-receipt-schema.mjs";
import {
  canonicalize,
  digestTrustedExactReviewEvidence,
  hasExactKeys,
  validateExactSliceReviewReceipt
} from "./workspace-agent-dispatch-run-receipt-validation.mjs";
import {
  assertMonotonicIdentityTransition,
  assertMonotonicTransition,
  identityDigest
} from "./workspace-agent-dispatch-run-receipt-transitions.mjs";

export const ATTEMPT_RETIREMENT_DIRECTORY = "reviewer-attempt-retirements";
export const ATTEMPT_RETIREMENT_SCHEMA_VERSION =
  "workspace-agent-reviewer-attempt-retirement.v1";
export const GENERATION_CORRECTION_DECISION_SCHEMA_VERSION =
  "workspace-agent-reviewer-generation-correction-decision.v1";

export const EXACT_REVIEW_RECEIPT_SELECTOR_ORPHAN_REPAIRED_CODE =
  "exact_slice_review_receipt_selector_orphan_repaired";
export const EXACT_REVIEW_RECEIPT_SELECTOR_EVENT_INCONSISTENT_CODE =
  "exact_slice_review_receipt_selector_event_inconsistent";
export const SELECTOR_JOURNAL_RECONCILIATION_SCHEMA_VERSION =
  "workspace-agent-exact-slice-review-selector-journal-reconciliation.v1";

export function retirementBody(prior, replacement, processEvidence) {
  return canonicalize({
    schema_version: ATTEMPT_RETIREMENT_SCHEMA_VERSION,
    unit_address: prior.unit_address,
    review_dispatch_id: prior.review_dispatch_identity.review_dispatch_id,
    prior_attempt_id: prior.attempt_lineage_identity.attempt_id,
    prior_run_id: prior.review_run_id,
    prior_monitor_handle: prior.review_monitor_handle,
    prior_identity_digest: identityDigest(prior),
    replacement_identity_digest: identityDigest(replacement),
    process_evidence: processEvidence,
    transition_identity: replacement.recovery_transition_identity,
    replacement_receipt: replacement
  });
}

export function isGenerationCorrectionDecision(value) {
  return value?.schema_version === GENERATION_CORRECTION_DECISION_SCHEMA_VERSION;
}

function stableCorrectionTarget(target) {
  const { committed_target_digest: _contractDigest, ...stable } = target;
  return canonicalize(stable);
}

export function validateGenerationCorrectionDecision(decision, prior, replacement) {
  const fields = [
    "schema_version", "decision", "owner", "authority", "prior_identity_digest",
    "replacement_identity_digest", "lifecycle_facts"
  ];
  const lifecycleFields = [
    "launch_state", "reviewer_child_created", "terminal_child_fact",
    "settled_result", "downstream_authority_granted"
  ];
  if (!hasExactKeys(decision, fields) ||
      decision.schema_version !== GENERATION_CORRECTION_DECISION_SCHEMA_VERSION ||
      decision.decision !== "eligible" || decision.owner !== "reviewerLineageBinder" ||
      decision.authority !== "launcher_authenticated_lifecycle_facts" ||
      !hasExactKeys(decision.lifecycle_facts, lifecycleFields) ||
      decision.lifecycle_facts.launch_state !== "not_started" ||
      decision.lifecycle_facts.reviewer_child_created !== false ||
      decision.lifecycle_facts.terminal_child_fact !== false ||
      decision.lifecycle_facts.settled_result !== false ||
      decision.lifecycle_facts.downstream_authority_granted !== false ||
      decision.prior_identity_digest !== identityDigest(prior) ||
      decision.replacement_identity_digest !== identityDigest(replacement)) {
    throw new Error("reviewer generation correction decision is malformed or unbound");
  }
  const priorAttempt = prior.attempt_lineage_identity;
  const replacementAttempt = replacement.attempt_lineage_identity;
  if (prior.review_dispatch_identity.review_dispatch_id ===
        replacement.review_dispatch_identity.review_dispatch_id ||
      replacementAttempt.attempt_number !== 1 ||
      replacement.recovery_transition_identity !== null ||
      prior.reviewer_role !== replacement.reviewer_role ||
      JSON.stringify(stableCorrectionTarget(priorAttempt.target)) !==
        JSON.stringify(stableCorrectionTarget(replacementAttempt.target))) {
    throw new Error("reviewer generation correction crosses target");
  }
  return Object.freeze(canonicalize(decision));
}

export function generationCorrectionContractMoved(state) {
  const error = typedRefusal(
    "reviewer generation correction contract moved",
    "contract_moved"
  );
  error.contract_moved_state = state;
  return error;
}

export function validateAttemptRetirementEvidence(evidence, prior = null) {
  const fields = [
    "schema_version", "unit_address", "review_dispatch_id", "prior_attempt_id",
    "prior_run_id", "prior_monitor_handle", "prior_identity_digest",
    "replacement_identity_digest", "process_evidence", "transition_identity",
    "replacement_receipt", "evidence_digest"
  ];
  if (!hasExactKeys(evidence, fields) ||
      evidence.schema_version !== ATTEMPT_RETIREMENT_SCHEMA_VERSION ||
      typeof evidence.evidence_digest !== "string") {
    throw new Error("reviewer attempt retirement evidence is malformed");
  }
  const { evidence_digest: _digest, ...body } = evidence;
  if (digestTrustedExactReviewEvidence(body) !== evidence.evidence_digest) {
    throw new Error("reviewer attempt retirement evidence digest mismatch");
  }
  const replacement = validateExactSliceReviewReceipt(evidence.replacement_receipt);
  const processEvidence = evidence.process_evidence;
  const generationCorrection = isGenerationCorrectionDecision(processEvidence);
  if (generationCorrection) {
    validateGenerationCorrectionDecision(processEvidence, prior, replacement);
  } else if (!hasExactKeys(processEvidence, [
    "schema_version", "verdict", "role", "tuple", "launcher_identity",
    "published_at", "sandbox_identity", "kill_shape", "liveness"
  ]) || processEvidence.schema_version !== "launcher-reviewer-process-death-evidence.v1" ||
      processEvidence.verdict !== "proven_dead" ||
      processEvidence.role !== replacement.reviewer_role ||
      processEvidence.tuple?.assigned_unit !== evidence.unit_address ||
      processEvidence.tuple?.launch_ref !== evidence.prior_monitor_handle ||
      processEvidence.tuple?.run_id !== evidence.prior_run_id ||
      processEvidence.tuple?.retry_id !== 0 ||
      !Number.isInteger(processEvidence.launcher_identity?.pid) ||
      typeof processEvidence.launcher_identity?.starttime !== "string" ||
      typeof processEvidence.launcher_identity?.boot_id !== "string" ||
      typeof processEvidence.published_at?.uptime !== "number" ||
      processEvidence.published_at?.boot_id !== processEvidence.launcher_identity.boot_id ||
      !Number.isInteger(processEvidence.sandbox_identity?.pid) ||
      typeof processEvidence.sandbox_identity?.starttime !== "string" ||
      typeof processEvidence.sandbox_identity?.boot_id !== "string" ||
      processEvidence.sandbox_identity.boot_id !== processEvidence.launcher_identity.boot_id ||
      !new Set(["bwrap-pid", "interactive-pid"]).has(processEvidence.kill_shape?.kind) ||
      processEvidence.kill_shape?.pid !== processEvidence.sandbox_identity.pid ||
      processEvidence.liveness?.sandbox !== "dead") {
    throw new Error("reviewer attempt retirement lacks exact launcher process evidence");
  }
  const transitionBound = generationCorrection
    ? evidence.transition_identity === null && replacement.recovery_transition_identity === null
    : replacement.recovery_transition_identity !== null &&
      JSON.stringify(evidence.transition_identity) ===
        JSON.stringify(replacement.recovery_transition_identity);
  if (evidence.replacement_identity_digest !== identityDigest(replacement) || !transitionBound) {
    throw new Error("reviewer attempt retirement replacement binding mismatch");
  }
  if (prior !== null) {
    validateExactSliceReviewReceipt(prior);
    if (prior.schema_version !== EXACT_SLICE_REVIEW_RECEIPT_SCHEMA_VERSION_V4 ||
        prior.reviewer_role !== replacement.reviewer_role ||
        (!generationCorrection && processEvidence.role !== prior.reviewer_role) ||
        evidence.unit_address !== prior.unit_address ||
        evidence.review_dispatch_id !== prior.review_dispatch_identity.review_dispatch_id ||
        evidence.prior_attempt_id !== prior.attempt_lineage_identity.attempt_id ||
        evidence.prior_run_id !== prior.review_run_id ||
        evidence.prior_monitor_handle !== prior.review_monitor_handle ||
        evidence.prior_identity_digest !== identityDigest(prior)) {
      throw new Error("reviewer attempt retirement prior-lineage binding mismatch");
    }
    if (!generationCorrection) {
      assertMonotonicIdentityTransition(
        prior.attempt_lineage_identity,
        replacement.attempt_lineage_identity,
        replacement.recovery_transition_identity
      );
    }
  }
  return Object.freeze(canonicalize(evidence));
}

export function validateStoreEvent(event, fileName) {
  if (!hasExactKeys(event, ["schema_version", "generation", "identity_digest", "receipt"]) ||
      event.schema_version !== STORE_EVENT_SCHEMA_VERSION ||
      !Number.isInteger(event.generation) || event.generation < 1 ||
      typeof event.identity_digest !== "string" || !/^[0-9a-f]{64}$/u.test(event.identity_digest)) {
    throw new Error(`exact slice review receipt event is malformed: ${fileName}`);
  }
  const receipt = validateExactSliceReviewReceipt(event.receipt);
  if (event.identity_digest !== identityDigest(receipt)) {
    throw new Error(`exact slice review receipt event identity digest mismatch: ${fileName}`);
  }
  const fileMatch = EVENT_FILE_RE.exec(fileName);
  if (!fileMatch || Number(fileMatch[1]) !== event.generation ||
      fileMatch[2] !== event.identity_digest ||
      fileMatch[3] !== receipt.receipt_digest.slice("sha256:".length)) {
    throw new Error(`exact slice review receipt event filename binding mismatch: ${fileName}`);
  }
  return Object.freeze({ ...event, receipt });
}

export function assertConsistentEventHistory(events) {
  const generations = new Set();
  const histories = new Map();
  for (const event of [...events].sort((left, right) => left.generation - right.generation)) {
    if (generations.has(event.generation)) {
      throw new Error("exact slice review receipt store carries a duplicate generation");
    }
    generations.add(event.generation);
    const history = histories.get(event.identity_digest) ?? [];
    const prior = history.at(-1) ?? null;
    if (prior !== null) assertMonotonicTransition(prior.receipt, event.receipt);
    history.push(event);
    histories.set(event.identity_digest, history);
  }
  const latest = [...histories.values()].map((history) => history.at(-1));
  for (let leftIndex = 0; leftIndex < latest.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < latest.length; rightIndex += 1) {
      const left = latest[leftIndex].receipt;
      const right = latest[rightIndex].receipt;
      if (left.review_run_id === right.review_run_id ||
          left.review_monitor_handle === right.review_monitor_handle) {
        throw new Error("exact slice review receipt store carries conflicting selector histories");
      }
    }
  }
}

export function eventFileName(generation, identity, receipt) {
  return `event-${String(generation).padStart(16, "0")}-${identity}-${receipt.receipt_digest.slice("sha256:".length)}.json`;
}

export function latestByIdentity(events) {
  const latest = new Map();
  for (const event of events) {
    const prior = latest.get(event.identity_digest);
    if (!prior || event.generation > prior.generation) latest.set(event.identity_digest, event);
  }
  return [...latest.values()];
}

export function createExactSliceReviewReceiptSelectorJournal({ faultInjector = null } = {}) {

  async function readFlatEvents(dir) {
    const names = (await readdir(dir)).filter((name) => EVENT_FILE_RE.test(name)).sort();
    const events = [];
    for (const name of names) {
      const parsed = JSON.parse(await readFile(path.join(dir, name), "utf8"));
      events.push(validateStoreEvent(parsed, name));
    }
    assertConsistentEventHistory(events);
    return events;
  }

  async function readEventDirectory(directory) {
    let names;
    try {
      names = await readdir(directory);
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
    const events = [];
    for (const name of names.filter((entry) => EVENT_FILE_RE.test(entry)).sort()) {
      const parsed = JSON.parse(await readFile(path.join(directory, name), "utf8"));
      events.push(validateStoreEvent(parsed, name));
    }
    return events;
  }

  async function readPartitionEvents(dir, unitAddress) {
    const digest = unitPartitionDigest(unitAddress);
    const events = await readEventDirectory(path.join(dir, PARTITION_DIRECTORY, digest));
    for (const event of events) {
      if (unitPartitionDigest(event.receipt.unit_address) !== digest) {
        throw typedRefusal(
          "exact slice review receipt event is stored outside its unit partition",
          EXACT_REVIEW_RECEIPT_PARTITION_BINDING_CODE
        );
      }
    }
    assertConsistentEventHistory(events);
    return events;
  }

  async function ensurePartitionDirectory(dir, unitAddress) {
    const root = path.join(dir, PARTITION_DIRECTORY);
    const partition = path.join(root, unitPartitionDigest(unitAddress));
    await mkdir(partition, { recursive: true, mode: 0o700 });

    await syncDirectory(partition);
    await syncDirectory(root);
    return partition;
  }

  async function derivePublishedSelectorEntries(dir) {
    const root = path.join(dir, PARTITION_DIRECTORY);
    let partitions = [];
    try {
      partitions = (await readdir(root)).filter((name) => PARTITION_DIR_RE.test(name)).sort();
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const entries = new Map();
    for (const partition of partitions) {
      for (const event of await readEventDirectory(path.join(root, partition))) {
        for (const selector of receiptSelectorDigests(event.receipt)) {
          recordSelectorEntry(entries, selector, event.identity_digest);
        }
      }
    }
    return entries;
  }

  async function rebuildSelectorIndex(dir) {
    const entries = await derivePublishedSelectorEntries(dir);
    await writeAtomicPublished(
      path.join(dir, SELECTOR_INDEX_FILE),
      serializeSelectorIndex(entries),
      faultInjector,
      "selector_index_rebuild"
    );
    return entries;
  }

  async function loadSelectorIndex(dir) {
    try {
      return parseSelectorIndex(await readFile(path.join(dir, SELECTOR_INDEX_FILE)));
    } catch (error) {
      if (error?.code === EXACT_REVIEW_RECEIPT_SELECTOR_CONFLICT_CODE) throw error;
      try {
        await rebuildSelectorIndex(dir);
      } catch (rebuildError) {
        throw typedRefusal(
          "exact slice review receipt selector index is unusable and could not be rebuilt from partitions",
          EXACT_REVIEW_RECEIPT_SELECTOR_INDEX_UNUSABLE_CODE,
          rebuildError
        );
      }
      throw typedRefusal(
        "exact slice review receipt selector index was unusable and has been rebuilt from partitions",
        EXACT_REVIEW_RECEIPT_SELECTOR_INDEX_UNUSABLE_CODE,
        error
      );
    }
  }

  async function ensurePartitionedLayout(dir) {
    const markerPath = path.join(dir, LAYOUT_MARKER_FILE);
    try {
      const marker = JSON.parse(await readFile(markerPath, "utf8"));
      if (marker?.schema_version === LAYOUT_MARKER_SCHEMA_VERSION) return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const flat = await readFlatEvents(dir);
    for (const event of flat) {
      const partition = await ensurePartitionDirectory(dir, event.receipt.unit_address);
      await writeAtomicPublished(
        path.join(partition, eventFileName(event.generation, event.identity_digest, event.receipt)),
        `${JSON.stringify({
          schema_version: event.schema_version,
          generation: event.generation,
          identity_digest: event.identity_digest,
          receipt: event.receipt
        }, null, 2)}\n`,
        faultInjector,
        "migration_event"
      );
    }

    await rebuildSelectorIndex(dir);
    await writeAtomicPublished(
      markerPath,
      `${JSON.stringify({ schema_version: LAYOUT_MARKER_SCHEMA_VERSION }, null, 2)}\n`,
      faultInjector,
      "migration_marker"
    );
  }

  async function appendSelectorIndexEntries(dir, lines) {
    if (lines.length === 0) return;
    const handle = await open(path.join(dir, SELECTOR_INDEX_FILE), "a", 0o600);
    try {
      await handle.writeFile(lines.join(""), "utf8");
      await inject(faultInjector, "selector_index_appended");
      await handle.sync();
      await inject(faultInjector, "selector_index_append_synced");
    } finally {
      await handle.close();
    }
  }

  async function reconcileSelectorJournal(dir) {
    await ensurePartitionedLayout(dir);
    const published = await derivePublishedSelectorEntries(dir);
    let index;
    try {
      index = await loadSelectorIndex(dir);
    } catch (error) {
      if (error?.code !== EXACT_REVIEW_RECEIPT_SELECTOR_INDEX_UNUSABLE_CODE) throw error;

      index = published;
    }
    let orphanSelectorCount = 0;
    for (const [selector, identity] of index) {
      const owner = published.get(selector) ?? null;
      if (owner === null) {
        orphanSelectorCount += 1;
        continue;
      }
      if (owner !== identity) {
        throw typedRefusal(
          "exact slice review receipt selector index contradicts its published event",
          EXACT_REVIEW_RECEIPT_SELECTOR_EVENT_INCONSISTENT_CODE
        );
      }
    }
    const repaired = orphanSelectorCount > 0 || index.size !== published.size;
    if (repaired) {
      await writeAtomicPublished(
        path.join(dir, SELECTOR_INDEX_FILE),
        serializeSelectorIndex(published),
        faultInjector,
        "selector_journal_reconciliation"
      );
    }
    return Object.freeze({
      schema_version: SELECTOR_JOURNAL_RECONCILIATION_SCHEMA_VERSION,
      repaired,
      orphan_selector_count: orphanSelectorCount
    });
  }

  async function claimSelectors(dir, receipt, identity) {
    const selectors = receiptSelectorDigests(receipt);
    for (let attempt = 0; ; attempt += 1) {
      const index = await loadSelectorIndex(dir);
      const pending = [];
      let contested = false;
      for (const selector of selectors) {
        const held = index.get(selector) ?? null;
        if (held === null) pending.push(selectorIndexLine(selector, identity));
        else if (held !== identity) contested = true;
      }
      if (!contested) return pending;
      if (attempt > 0) {
        throw typedRefusal(
          "exact slice review receipt conflicts with an existing immutable selector binding",
          EXACT_REVIEW_RECEIPT_SELECTOR_CONFLICT_CODE
        );
      }
      await reconcileSelectorJournal(dir);
    }
  }

  async function publishEvent(dir, validated, identity, generation, pending) {
    const event = {
      schema_version: STORE_EVENT_SCHEMA_VERSION,
      generation,
      identity_digest: identity,
      receipt: validated
    };
    const partition = await ensurePartitionDirectory(dir, validated.unit_address);

    await appendSelectorIndexEntries(dir, pending);
    await writeAtomicImmutable(
      path.join(partition, eventFileName(generation, identity, validated)),
      `${JSON.stringify(event, null, 2)}\n`,
      faultInjector
    );
    return validated;
  }

  function nextGeneration(events) {
    return events.reduce((max, event) => Math.max(max, event.generation), 0) + 1;
  }

  async function persistUnderStoreLock(dir, validated, { guardTransition = null } = {}) {
    await ensurePartitionedLayout(dir);
    const identity = identityDigest(validated);

    const pending = await claimSelectors(dir, validated, identity);
    const events = await readPartitionEvents(dir, validated.unit_address);
    const exact = latestByIdentity(events)
      .find((event) => event.identity_digest === identity) ?? null;
    if (exact !== null) {
      if (exact.receipt.receipt_digest === validated.receipt_digest) return validated;
      if (guardTransition !== null) await guardTransition(exact.receipt);
      assertMonotonicTransition(exact.receipt, validated);
    }

    return publishEvent(dir, validated, identity, nextGeneration(events), pending);
  }

  return Object.freeze({
    appendSelectorIndexEntries,
    claimSelectors,
    ensurePartitionDirectory,
    ensurePartitionedLayout,
    latestByIdentity,
    loadSelectorIndex,
    nextGeneration,
    persistUnderStoreLock,
    publishEvent,
    readPartitionEvents,
    rebuildSelectorIndex,
    reconcileSelectorJournal
  });
}
