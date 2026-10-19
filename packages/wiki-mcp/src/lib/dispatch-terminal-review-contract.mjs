

import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  computeWorkRecordSourceDigest,
  projectSliceReviewReceiptContracts
} from "../../../wiki-core/src/lib/work-record-schema.mjs";
import {
  projectWorkRecordTestProofValidation
} from "../../../wiki-core/src/lib/work-record-test-proof-bindings.mjs";
import {
  constructTerminalReviewContractBinding,
  terminalReviewContractBindingIdentity
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-review-contract-binding.mjs";
import {
  evaluateWorkRecordParentLifecycleContract,
  PARENT_LIFECYCLE_CONTRACT_FACTS
} from "../../../wiki-core/src/lib/work-record-parent-lifecycle-contract.mjs";
import {
  defaultTerminalCandidateRunGit
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";

export const TERMINAL_REVIEW_UNIT_PROJECTION_CODES = Object.freeze({
  PARENT_LIFECYCLE_CONTRACT_INCOMPLETE: "parent_lifecycle_contract_incomplete",
  SLICE_REVIEW_CONTRACT_ABSENT: "slice_review_contract_absent"
});

const PARENT_LIFECYCLE_CONTRACT_FACT_ORDER = Object.freeze(
  Object.values(PARENT_LIFECYCLE_CONTRACT_FACTS)
);

const NO_LIFECYCLE_FACTS = Object.freeze([]);

function closedLifecycleFacts(facts) {
  if (!Array.isArray(facts) || facts.length === 0) return NO_LIFECYCLE_FACTS;
  const present = new Set(facts);
  const closed = PARENT_LIFECYCLE_CONTRACT_FACT_ORDER.filter((fact) => present.has(fact));
  return closed.length === 0 ? NO_LIFECYCLE_FACTS : Object.freeze(closed);
}

function terminalReviewUnitProjectionFailure(code, parentLifecycle = null) {
  return Object.freeze({
    ok: false,
    cause: Object.freeze({
      code,
      missing_facts: closedLifecycleFacts(parentLifecycle?.missing_facts),
      ambiguous_facts: closedLifecycleFacts(parentLifecycle?.ambiguous_facts)
    })
  });
}

export function projectTerminalReviewUnit(record) {
  const parentLifecycle = evaluateWorkRecordParentLifecycleContract(record);
  if (parentLifecycle.complete !== true) {
    return terminalReviewUnitProjectionFailure(
      TERMINAL_REVIEW_UNIT_PROJECTION_CODES.PARENT_LIFECYCLE_CONTRACT_INCOMPLETE,
      parentLifecycle
    );
  }
  const slice = parentLifecycle.terminal_review_contract_unit;
  const contracts = projectSliceReviewReceiptContracts(record, slice.id);
  if (contracts.slice_review_contract === null) {
    return terminalReviewUnitProjectionFailure(
      TERMINAL_REVIEW_UNIT_PROJECTION_CODES.SLICE_REVIEW_CONTRACT_ABSENT
    );
  }
  return Object.freeze({ ok: true, slice_id: slice.id, contracts });
}

export async function exactWkBoundContract({
  recordId,
  initiative = null,
  mainRepo,
  wkSha,
  runGit = defaultTerminalCandidateRunGit
}) {
  let record;
  try {
    const result = await runGit({
      repo: mainRepo,
      args: ["show", `${wkSha}:wiki/work-records/${recordId}.json`],
      env: null
    });
    if (!result || result.ok !== true) {
      throw new Error("exact WK record blob is unavailable");
    }
    record = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`terminal candidate exact WK-bound contract is not parseable: ${error?.message ?? String(error)}`,
      { cause: error });
  }
  if (record?.id !== recordId || !/^IN-\d{4}$/u.test(record?.initiative ?? "") ||
      (initiative !== null && record.initiative !== initiative)) {
    throw new Error("terminal candidate exact WK-bound contract identity disagrees");
  }
  const validationProjection = projectWorkRecordTestProofValidation({ selectedUnit: record });
  if (validationProjection.status !== "valid") {
    throw new Error("terminal candidate exact WK-bound validation declarations are invalid");
  }
  const projected = projectTerminalReviewUnit(record);
  const reviewUnit = projected.ok !== true ? null : Object.freeze({
    record_id: recordId,
    slice_id: projected.slice_id,
    subject: `${recordId}#${projected.slice_id}`,
    initiative: record.initiative,
    parent_status: record.status ?? null,

    contract_source: "exact_candidate_tree",
    canonical_parent_wk_contract: projected.contracts.canonical_parent_wk_contract,
    review_unit_contract: projected.contracts.slice_review_contract
  });
  return Object.freeze({
    initiative: record.initiative,
    digest: computeWorkRecordSourceDigest(record),
    targets: validationProjection.targets,
    validation_bindings: validationProjection.validation_bindings,
    review_unit: reviewUnit,

    review_unit_absence: projected.ok === true ? null : projected.cause
  });
}

export const CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES = Object.freeze({
  REPOSITORY_ROOT_NOT_CANONICAL: "canonical_repository_root_not_canonical",
  RECORD_UNREADABLE: "canonical_record_unreadable",
  RECORD_ABSENT: "canonical_record_absent",
  RECORD_MALFORMED: "canonical_record_malformed",
  RECORD_IDENTITY_DISAGREES: "canonical_record_identity_disagrees",
  TERMINAL_REVIEW_UNIT_UNPROJECTABLE: "terminal_review_unit_unprojectable",
  REVIEW_SUBJECT_MOVED: "canonical_review_subject_moved",
  REVIEW_CONTRACT_DIGEST_MOVED: "canonical_review_contract_digest_moved"
});

function canonicalCurrentTerminalReviewFailure(code, projectionCause = null, failure = null) {
  return Object.freeze({
    ok: false,
    cause: Object.freeze({
      code,
      projection_code: projectionCause?.code ?? null,
      missing_facts: projectionCause?.missing_facts ?? NO_LIFECYCLE_FACTS,
      ambiguous_facts: projectionCause?.ambiguous_facts ?? NO_LIFECYCLE_FACTS,
      ...(failure === null ? {} : { failure })
    })
  });
}

export function canonicalWorkRecordIdentity({ mainRepo, recordId }) {
  let requested;
  try {
    requested = path.resolve(mainRepo);

    if (realpathSync(requested) !== requested) {
      return canonicalCurrentTerminalReviewFailure(
        CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.REPOSITORY_ROOT_NOT_CANONICAL);
    }
  } catch (error) {
    return canonicalCurrentTerminalReviewFailure(
      CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.REPOSITORY_ROOT_NOT_CANONICAL, null,
      { code: error.code, message: error.message, path: error.path, operation: error.syscall });
  }
  let text;
  try {
    text = readFileSync(
      path.join(requested, "wiki", "work-records", `${recordId}.json`),
      "utf8"
    );
  } catch (error) {
    return canonicalCurrentTerminalReviewFailure(
      error.code === "ENOENT" ? CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.RECORD_ABSENT
        : CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.RECORD_UNREADABLE, null,
      { code: error.code, message: error.message, path: error.path, operation: error.syscall });
  }
  let record;
  try { record = JSON.parse(text); }
  catch (error) {
    return canonicalCurrentTerminalReviewFailure(
      CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.RECORD_MALFORMED, null,
      { name: error.name, message: error.message, path: `wiki/work-records/${recordId}.json`, operation: "JSON.parse" });
  }
  if (record?.id !== recordId || !/^IN-\d{4}$/u.test(record?.initiative ?? "")) {
    return canonicalCurrentTerminalReviewFailure(
      CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.RECORD_IDENTITY_DISAGREES, null,
      { expected_id: recordId, observed_id: record?.id ?? null, initiative: record?.initiative ?? null });
  }
  return Object.freeze({ ok: true, record, initiative: record.initiative });
}

export function canonicalCurrentTerminalReviewContract({ mainRepo, recordId }) {
  const identity = canonicalWorkRecordIdentity({ mainRepo, recordId });
  if (identity.ok !== true) return identity;
  const record = identity.record;
  const projected = projectTerminalReviewUnit(record);
  if (projected.ok !== true) {
    return canonicalCurrentTerminalReviewFailure(
      CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.TERMINAL_REVIEW_UNIT_UNPROJECTABLE,
      projected.cause);
  }
  const subject = `${recordId}#${projected.slice_id}`;

  const binding = constructTerminalReviewContractBinding({
    recordId,
    initiative: record.initiative,
    reviewSliceId: projected.slice_id,
    reviewSubject: subject,
    reviewUnitContract: projected.contracts.slice_review_contract
  });
  const bindingIdentity = terminalReviewContractBindingIdentity(binding);
  const contract = Object.freeze({
    initiative: record.initiative,
    digest: computeWorkRecordSourceDigest(record),
    targets: projectWorkRecordTestProofValidation({ selectedUnit: record }).targets,
    validation_bindings: projectWorkRecordTestProofValidation({ selectedUnit: record })
      .validation_bindings,
    review_subject: subject,
    review_contract_digest: bindingIdentity.review_contract_digest,
    review_unit: Object.freeze({
      record_id: recordId,
      slice_id: projected.slice_id,
      subject,
      initiative: record.initiative,
      parent_status: record.status ?? null,

      contract_source: "canonical_current_record",
      canonical_parent_wk_contract: projected.contracts.canonical_parent_wk_contract,
      review_unit_contract: projected.contracts.slice_review_contract
    })
  });
  return Object.freeze({ ok: true, contract });
}

export function canonicalRecordInitiative({ mainRepo, recordId }) {
  const identity = canonicalWorkRecordIdentity({ mainRepo, recordId });
  return identity.ok === true ? identity.initiative : null;
}
