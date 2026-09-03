import { createHash } from "node:crypto";

import { validateTestProofRuntimeEvidenceV2 } from "./test-proof-runtime-evidence-v2.mjs";

const KERNEL_SCHEMA_VERSION = "controlled-contract-test-proof-semantic-facts.v1";

class TestProofEvidenceSemanticKernelError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "TestProofEvidenceSemanticKernelError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

const compare = (left, right) => String(left).localeCompare(String(right));

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort(compare).map((key) => [key, canonicalValue(value[key])])
  );
  return value;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(
    `${JSON.stringify(canonicalValue(value), null, 2)}\n`
  ).digest("hex")}`;
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function mismatch(field, expected, actual, index) {
  throw new TestProofEvidenceSemanticKernelError(
    "verify_proof.evidence_cross_bound.v1",
    "authenticated evidence is bound to a different proof instance",
    { field, expected, actual, receipt_index: index }
  );
}

function expectedEvidenceIdentity(resolution, expected) {
  return {
    controlled_contract_generation: resolution.contract_generation,
    verification_id: resolution.verification_id,
    command_target: resolution.declared_target.target,
    ...(expected?.wk_id === undefined ? {} : { wk_id: expected.wk_id }),
    ...(expected?.selected_unit === undefined ? {} : { selected_unit: expected.selected_unit }),
    ...(expected?.source_snapshot_digest === undefined
      ? {} : { source_snapshot_digest: expected.source_snapshot_digest }),
    ...(expected?.test_id === undefined ? {} : { test_id: expected.test_id })
  };
}

function normalizedFacts(evidence, binding) {
  const expectedFalsifiers = [...binding.falsifiers].map(({ falsifier_id: id }) => id)
    .sort(compare);
  const observedFalsifiers = evidence.falsifier_executions.map((entry) => ({
    falsifier_id: entry.falsifier_id,
    status: entry.status,
    detected: entry.status === "detected"
  })).sort((left, right) => compare(left.falsifier_id, right.falsifier_id));
  const traversals = evidence.boundary_traversals.map((entry) => ({
    boundary_id: entry.boundary_id,
    observable_id: entry.observable_id,
    provider_support: entry.provider_support,
    status: entry.status,
    proven: entry.status === "proven"
  })).sort((left, right) => compare(left.boundary_id, right.boundary_id));
  const selectedTestId = evidence.evidence_identity.test_id;
  const selected = (field) => evidence.test_inventory[field].includes(selectedTestId)
    ? [selectedTestId] : [];
  const inventory = {
    declared_test_ids: [selectedTestId],
    discovered_test_ids: selected("discovered_test_ids"),
    executed_test_ids: selected("executed_test_ids"),
    skipped_test_ids: selected("skipped_test_ids"),
    newly_skipped_test_ids: selected("newly_skipped_test_ids"),
    unexpected_test_ids: []
  };
  const selectedPassObserved = evidence.execution_result.structured_result.pass_events.some(
    ({ test_id: testId, status }) => testId === selectedTestId && status === "passed"
  );
  return {
    candidate: {
      status: selectedPassObserved ? "passed" : "failed",
      passed: selectedPassObserved
    },
    inventory,
    falsifiers: {
      expected_ids: expectedFalsifiers,
      observations: observedFalsifiers,
      complete: expectedFalsifiers.length === observedFalsifiers.length &&
        expectedFalsifiers.every((id, index) => observedFalsifiers[index]?.falsifier_id === id),
      all_detected: observedFalsifiers.length > 0 &&
        observedFalsifiers.every(({ detected }) => detected)
    },
    traversal: {
      observations: traversals,
      complete: traversals.length === 1,
      all_proven: traversals.length > 0 && traversals.every(({ proven }) => proven)
    },
    prohibited_shortcuts: {
      observed: [...evidence.observed_shortcuts],
      violated: binding.prohibited_shortcuts.filter((shortcut) =>
        evidence.observed_shortcuts.includes(shortcut)).sort(compare)
    }
  };
}

function evaluateTestProofEvidenceSemantics({ resolution, receipts, expected = {} }) {
  if (resolution?.status !== "executable") throw new TestProofEvidenceSemanticKernelError(
    "verify_proof.resolution_not_executable.v1",
    "semantic evidence requires one executable obligation resolution"
  );
  if (receipts === undefined || receipts === null || receipts.length === 0) return deepFreeze({
    schema_version: KERNEL_SCHEMA_VERSION,
    status: "not_executable",
    authority: "non_authoritative",
    reason_code: "verify_proof.complete_receipts_unavailable.v1",
    obligation_id: resolution.obligation_id
  });
  if (!Array.isArray(receipts)) throw new TestProofEvidenceSemanticKernelError(
    "verify_proof.evidence_population_malformed.v1", "receipts must be an array"
  );
  const seenEvidenceIds = new Set();
  const seenReceiptDigests = new Set();
  const identity = expectedEvidenceIdentity(resolution, expected);
  const bound = [];
  receipts.forEach((receipt, index) => {
    const validation = validateTestProofRuntimeEvidenceV2(receipt);
    if (!validation.valid) throw new TestProofEvidenceSemanticKernelError(
      "verify_proof.evidence_invalid.v1",
      "runtime evidence is malformed, corrupted, or unauthenticated",
      { receipt_index: index, schema_valid: validation.schema_valid,
        diagnostics: validation.diagnostics }
    );
    const evidenceId = receipt.evidence_identity.evidence_id;
    if (seenEvidenceIds.has(evidenceId)) throw new TestProofEvidenceSemanticKernelError(
      "verify_proof.evidence_population_duplicate.v1",
      "runtime evidence population contains a duplicate evidence identity",
      { evidence_id: evidenceId }
    );
    seenEvidenceIds.add(evidenceId);
    const receiptDigest = digest(receipt);
    if (seenReceiptDigests.has(receiptDigest)) throw new TestProofEvidenceSemanticKernelError(
      "verify_proof.evidence_population_duplicate.v1",
      "runtime evidence population contains duplicate content",
      { receipt_digest: receiptDigest }
    );
    seenReceiptDigests.add(receiptDigest);
    for (const [field, expectedValue] of Object.entries(identity)) {
      const actual = receipt.evidence_identity[field];
      if (actual !== expectedValue) mismatch(`evidence_identity.${field}`, expectedValue, actual,
        index);
    }
    const contractBindings = {
      contract_digest: resolution.contract_digest,
      verification_claim_id: resolution.verification_id,
      test_proof_id: resolution.test_proof.test_proof_id
    };
    for (const [field, expectedValue] of Object.entries(contractBindings)) {
      const actual = receipt.contract_binding[field];
      if (actual !== expectedValue) mismatch(`contract_binding.${field}`, expectedValue, actual,
        index);
    }
    bound.push({ receipt, receipt_digest: receiptDigest });
  });
  if (bound.length !== 1) throw new TestProofEvidenceSemanticKernelError(
    "verify_proof.evidence_population_contradictory.v1",
    "v1 obligation evidence must contain exactly one authenticated receipt",
    { expected_count: 1, actual_count: bound.length }
  );
  const [{ receipt, receipt_digest: receiptDigest }] = bound;
  const facts = normalizedFacts(receipt, resolution.test_proof);
  return deepFreeze({
    schema_version: KERNEL_SCHEMA_VERSION,
    status: "facts",
    authority: "non_authoritative",
    obligation_id: resolution.obligation_id,
    execution_identity: {
      run_id: receipt.evidence_identity.run_id,
      attempt: receipt.evidence_identity.attempt,
      candidate: expected.candidate ?? {
        source_snapshot_digest: receipt.evidence_identity.source_snapshot_digest
      },
      source_snapshot_digest: receipt.evidence_identity.source_snapshot_digest
    },
    receipt_population: {
      count: 1,
      receipt_digests: [receiptDigest],
      digest: digest([receiptDigest])
    },
    facts,
    facts_digest: digest(facts)
  });
}

export {
  KERNEL_SCHEMA_VERSION as TEST_PROOF_EVIDENCE_SEMANTIC_FACTS_VERSION,
  TestProofEvidenceSemanticKernelError,
  evaluateTestProofEvidenceSemantics
};
