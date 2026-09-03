import { createHash } from "node:crypto";

import {
  ControlledContractToolError,
  assertControlledContractOperationInput,
  withCanonicalControlledContractSourceLease
} from "../../lib/controlled-contract-tools.mjs";
import {
  getControlledContractRefactorContinuation,
  updateControlledContractRefactorContinuation
} from "../../lib/controlled-contract-authoring-continuations.mjs";
import {
  prepareControlledContractRefactorCarrierSettlement,
  settleControlledContractRefactorTransaction
} from "../../lib/controlled-contract-carrier-set-publication.mjs";
import { prepareControlledContractRefactorCoverageReconciliation,
  prepareControlledContractRefactorCoverageSettlement } from
  "./acceptance-coverage-operations.mjs";
import { controlledContractOperation } from "./refusal.mjs";
import { CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS } from
  "./semantic-projection-bounds.mjs";

const RECEIPT_SCHEMA_VERSION = "controlled-contract-refactor-receipt.v1";
const RECEIPT_PAGE_SCHEMA_VERSION = "controlled-contract-refactor-receipt-page.v1";
const RECEIPT_SELECTORS = Object.freeze(["carrier_change", "correspondence",
  "coverage_change", "derived_invalidation", "proof_gap"]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonical(value[key])])
  );
  return value;
}
function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}
function fail(code, message, details = {}) {
  throw new ControlledContractToolError(code, message, { changed: false,
    limb: "mechanical_failure", owner: "workspace_controlled_contract_refactor_apply",
    ...details });
}
function generationIdentity(canonicalSet) {
  return typeof canonicalSet.generation === "string" ? canonicalSet.generation
    : canonicalSet.generation?.id ?? null;
}
function receiptBody(record, publication, coverageReceipt) {
  const result = record.refactor.package_result;
  const carrierChanges = result.carriers.filter(({ filename, changed }) =>
    filename !== null && changed === true).map(({ carrier_kind, filename,
      source_content_digest, prospective_content_digest }) => ({ carrier_kind,
      filename, source_content_digest, prospective_content_digest }));
  const coverageChanges = Object.entries(coverageReceipt ?? {}).map(([family, row]) =>
    ({ family, ...row }));
  const body = {
    schema_version: RECEIPT_SCHEMA_VERSION,
    source: structuredClone(record.refactor.source),
    target: { generation: publication.generation,
      manifest_digest: publication.manifest_content_digest },
    mode: result.mode, classification: result.classification,
    correspondence: structuredClone(result.correspondence),
    reason: result.reason,
    carrier_changes: carrierChanges,
    coverage_changes: coverageChanges,
    invalidated_derived: structuredClone(result.invalidated_derived),
    proof_gaps: structuredClone(result.proof_gaps),
    package: { schema_version: result.schema_version,
      result_digest: result.result_digest,
      package_generation: record.package_generation },
    outcome: publication.no_op === true ? "no_op" : "written",
    counts: { carrier_changes: carrierChanges.length,
      coverage_changes: coverageChanges.length,
      correspondence: result.correspondence.length,
      invalidated_derived: result.invalidated_derived.length,
      proof_gaps: result.proof_gaps.length }
  };
  return Object.freeze({ ...body, snapshot_digest: digest(body) });
}

function canonicalMembers(record, source) {
  const result = record.refactor.package_result;
  const members = structuredClone(source.canonical_members);
  for (const carrier of result.carriers) {
    if (carrier.filename === null || !Object.hasOwn(members, carrier.filename)) continue;
    if (carrier.carrier_kind === "proof_plan") {
      delete members[carrier.filename];
    } else members[carrier.filename] = structuredClone(carrier.content);
  }
  return members;
}

function assertInterruptedRefactorTarget(record, source) {
  const expected = record.refactor.package_result.carriers.filter(
    ({ filename }) => filename !== null);
  const observed = source.canonical_set.members_by_basename;
  const expectedNames = expected.filter(({ carrier_kind: kind }) => kind !== "proof_plan")
    .map(({ filename }) => filename).sort();
  const observedNames = source.canonical_set.members.map(({ filename }) => filename).sort();
  if (JSON.stringify(expectedNames) !== JSON.stringify(observedNames)) fail(
    "controlled_contract_refactor_plan_stale",
    "visible generation member population differs from the interrupted settlement", {
      expected_filenames: expectedNames, actual_filenames: observedNames,
      would_break: "restart reconciliation could settle a partial or unrelated generation"
    });
  for (const carrier of expected) {
    const actual = observed[carrier.filename] ?? null;
    const matches = carrier.carrier_kind === "proof_plan" ? actual === null
      : actual !== null && JSON.stringify(canonical(actual.content)) ===
        JSON.stringify(canonical(carrier.content));
    if (!matches) fail(
      "controlled_contract_refactor_plan_stale",
      "visible generation does not match the interrupted refactor settlement", {
        carrier_kind: carrier.carrier_kind, filename: carrier.filename,
        expected_content_digest: carrier.carrier_kind === "proof_plan"
          ? null : carrier.prospective_content_digest,
        actual_content_digest: actual?.content_digest ?? null,
        would_break: "restart reconciliation could settle unrelated canonical work"
      });
  }
}

async function reconcileInterruptedRefactorSettlement({ input, record, source }) {
  assertInterruptedRefactorTarget(record, source);
  let coverageReceipt = null;
  let publishedRecord = null;
  const publication = { generation: generationIdentity(source.canonical_set),
    manifest_content_digest: source.manifest_content_digest, no_op: false };
  const settlement = await settleControlledContractRefactorTransaction({
    assertSourceLease: async () => {
      if (generationIdentity(source.canonical_set) !== publication.generation ||
          source.manifest_content_digest !== publication.manifest_content_digest) fail(
        "controlled_contract_refactor_source_lease_stale",
        "interrupted refactor target changed during receipt reconciliation");
    }, participants: [
      { name: "coverage", prepare: async () => {
        const prepared = await prepareControlledContractRefactorCoverageReconciliation({
          input: { repoRoot: input.repoRoot, wkId: record.wk_id, focus: record.focus },
          coverage: record.refactor.coverage
        });
        return Object.freeze({ ...prepared, commit: async () => {
          coverageReceipt = await prepared.commit();
          return coverageReceipt;
        } });
      } },
      { name: "receipt_transition", terminal: true, prepare: async () => ({
        terminal: true,
        commit: async () => {
          const receipt = receiptBody(record, publication, coverageReceipt);
          publishedRecord = await updateControlledContractRefactorContinuation({
            repoRoot: input.repoRoot, wkId: record.wk_id, focus: record.focus,
            identity: record.identity, changes: { status: "published", receipt }
          });
          return { continuation: publishedRecord.identity,
            snapshot_digest: receipt.snapshot_digest };
        }, compensate: async () => {}
      }) }
    ]
  });
  return Object.freeze({ changed: true, replay: false, reconciled: true,
    resource_kind: "receipt", resource_identity: publishedRecord.identity,
    receipt: publishedRecord.refactor.receipt, settlement: settlement.status });
}

export async function applyControlledContractRefactorOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, ["repoRoot", "continuation"]);
    if (typeof input.continuation !== "string") fail(
      "controlled_contract_refactor_continuation_invalid",
      "apply requires exactly one opaque server-issued continuation");
    const record = await getControlledContractRefactorContinuation({
      repoRoot: input.repoRoot, identity: input.continuation
    });
    if (record === null) fail("controlled_contract_refactor_continuation_unknown",
      "refactor continuation is unknown, expired, or belongs to another repository");
    if (record.refactor.status === "published") return Object.freeze({
      changed: false, replay: true, resource_kind: "receipt",
      resource_identity: record.identity, receipt: record.refactor.receipt
    });
    if (record.refactor.status !== "planned") fail(
      "controlled_contract_refactor_continuation_stale",
      "refactor continuation is not in one replayable state", {
        recovery: { operation: "workspace_controlled_contract_refactor_plan",
          arguments: { wk_id: record.wk_id, focus: record.focus } }
      });
    return withCanonicalControlledContractSourceLease({ repoRoot: input.repoRoot,
      wkId: record.wk_id, focus: record.focus,
      mutation: { carrierKind: "contract" }
    }, async (source) => {
      const currentGeneration = generationIdentity(source.canonical_set);
      if (currentGeneration !== record.refactor.source.generation ||
          source.manifest_content_digest !== record.refactor.source.manifest_digest) {
        const reconciled = await getControlledContractRefactorContinuation({
          repoRoot: input.repoRoot, identity: record.identity
        });
        if (reconciled?.refactor.status === "published") return Object.freeze({
          changed: false, replay: true, resource_kind: "receipt",
          resource_identity: reconciled.identity,
          receipt: reconciled.refactor.receipt
        });
        return reconcileInterruptedRefactorSettlement({ input, record, source });
      }
      let carrierReceipt = null;
      let coverageReceipt = null;
      let publishedRecord = null;
      const settlement = await settleControlledContractRefactorTransaction({
        assertSourceLease: async () => {
          if (generationIdentity(source.canonical_set) !==
              record.refactor.source.generation) fail(
            "controlled_contract_refactor_source_lease_stale",
            "refactor source lease no longer binds its planned generation");
        },
        participants: [
          { name: "coverage", prepare: async () => {
            const prepared = await prepareControlledContractRefactorCoverageSettlement({
              input: { repoRoot: input.repoRoot, wkId: record.wk_id,
                focus: record.focus }, coverage: record.refactor.coverage
            });
            return Object.freeze({ ...prepared, commit: async () => {
              coverageReceipt = await prepared.commit();
              return coverageReceipt;
            } });
          } },
          { name: "canonical_generation", prepare: async () => {
            const prepared = await prepareControlledContractRefactorCarrierSettlement({
              repoRoot: input.repoRoot, repository: source.record.repo,
              wkId: record.wk_id, focus: record.focus,
              profile: "canonical_authoring",
              expected_manifest_digest: source.manifest_content_digest,
              sourceLease: source.lease,
              canonical_members: canonicalMembers(record, source)
            });
            return Object.freeze({ ...prepared, commit: async () => {
              carrierReceipt = await prepared.commit();
              return carrierReceipt;
            } });
          } },
          { name: "receipt_transition", terminal: true, prepare: async () => ({
            terminal: true,
            commit: async () => {
              const receipt = receiptBody(record, carrierReceipt, coverageReceipt);
              try {
                publishedRecord = await updateControlledContractRefactorContinuation({
                  repoRoot: input.repoRoot, wkId: record.wk_id, focus: record.focus,
                  identity: record.identity, changes: { status: "published", receipt }
                });
              } catch (error) {
                const reconciled = await getControlledContractRefactorContinuation({
                  repoRoot: input.repoRoot, identity: record.identity
                });
                if (reconciled?.refactor.status !== "published" ||
                    JSON.stringify(reconciled.refactor.receipt) !== JSON.stringify(receipt)) {
                  throw error;
                }
                publishedRecord = reconciled;
              }
              return { continuation: publishedRecord.identity,
                snapshot_digest: receipt.snapshot_digest };
            },
            compensate: async () => {}
          }) }
        ]
      });
      return Object.freeze({ changed: carrierReceipt.no_op !== true,
        replay: false, resource_kind: "receipt",
        resource_identity: publishedRecord.identity,
        receipt: publishedRecord.refactor.receipt,
        settlement: settlement.status });
    });
  });
}

function receiptItems(receipt) {
  const rows = [];
  for (const value of receipt.carrier_changes) rows.push({ kind: "carrier_change",
    stable_id: digest(value), value });
  for (const value of receipt.coverage_changes) rows.push({ kind: "coverage_change",
    stable_id: digest(value), value });
  for (const value of receipt.correspondence) rows.push({ kind: "correspondence",
    stable_id: digest(value), value });
  for (const value of receipt.invalidated_derived) rows.push({
    kind: "derived_invalidation", stable_id: digest(value), value });
  for (const value of receipt.proof_gaps) rows.push({ kind: "proof_gap",
    stable_id: digest(value), value });
  return rows.sort((a, b) => `${a.kind}\0${a.stable_id}`.localeCompare(
    `${b.kind}\0${b.stable_id}`));
}

export async function queryControlledContractRefactorReceipt(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, ["repoRoot", "resourceIdentity",
      "selector", "authenticatedCursorPayload"]);
    const record = await getControlledContractRefactorContinuation({
      repoRoot: input.repoRoot, identity: input.resourceIdentity
    });
    if (record?.refactor.status !== "published" || record.refactor.receipt === null) fail(
      "controlled_contract_refactor_receipt_unknown",
      "receipt identity is unknown, incomplete, or belongs to another repository");
    const receipt = record.refactor.receipt;
    const selector = input.selector ?? null;
    if (selector !== null && (typeof selector !== "object" || Array.isArray(selector) ||
        !RECEIPT_SELECTORS.includes(selector.kind) ||
        (selector.stable_id !== null && typeof selector.stable_id !== "string"))) fail(
      "controlled_contract_refactor_selector_invalid",
      "receipt selector is not one supported semantic selector");
    const payload = input.authenticatedCursorPayload ?? {
      resource_kind: "receipt", resource_identity: input.resourceIdentity,
      snapshot_digest: receipt.snapshot_digest, selector,
      offset: 0, page_size: CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.page_items
    };
    if (!payload || payload.resource_kind !== "receipt" ||
        payload.resource_identity !== input.resourceIdentity ||
        payload.snapshot_digest !== receipt.snapshot_digest ||
        JSON.stringify(payload.selector) !== JSON.stringify(selector) ||
        !Number.isSafeInteger(payload.offset) || payload.offset < 0 ||
        !Number.isSafeInteger(payload.page_size) || payload.page_size < 1 ||
        payload.page_size > CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS.page_items) fail(
      "controlled_contract_refactor_cursor_stale",
      "authenticated receipt cursor does not bind this exact immutable receipt");
    const all = receiptItems(receipt).filter((item) => selector === null ||
      item.kind === selector.kind && (selector.stable_id === null ||
        item.stable_id === selector.stable_id));
    const items = all.slice(payload.offset, payload.offset + payload.page_size);
    const remaining = all.length - payload.offset - items.length;
    return Object.freeze({ schema_version: RECEIPT_PAGE_SCHEMA_VERSION,
      resource_kind: "receipt", resource_identity: input.resourceIdentity,
      snapshot_digest: receipt.snapshot_digest, selector,
      source: receipt.source, target: receipt.target, mode: receipt.mode,
      outcome: receipt.outcome,
      counts: Object.freeze({ complete: all.length, returned: items.length,
        omitted: all.length - items.length, remaining }),
      items: Object.freeze(items),
      next_cursor_binding: remaining > 0 ? Object.freeze({ resource_kind: "receipt",
        resource_identity: input.resourceIdentity,
        snapshot_digest: receipt.snapshot_digest, selector,
        offset: payload.offset + items.length, page_size: payload.page_size }) : null,
      final_action: remaining === 0 ? Object.freeze({ status: "complete" }) : null,
      authority: Object.freeze({ authoritative: false, read_only: true,
        grants: Object.freeze([]) }) });
  });
}

export { RECEIPT_PAGE_SCHEMA_VERSION, RECEIPT_SCHEMA_VERSION, RECEIPT_SELECTORS };
