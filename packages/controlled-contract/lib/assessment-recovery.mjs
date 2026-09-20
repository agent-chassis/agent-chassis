import {
  compareCodeUnits,
  deepFreeze,
  unsupportedObjectKeys
} from "./deterministic-projection-primitives.mjs";

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const WK_PATTERN = /^WK-[0-9]{4}$/u;
const FOCUS_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const RECOVERY = Object.freeze({
  controlled_contract_proof_plan_request_missing: Object.freeze({
    missing_carrier: "proof_plan_request"
  }),
  controlled_contract_evaluation_input_missing: Object.freeze({
    missing_carrier: "evaluation_input"
  }),
  controlled_contract_proof_plan_missing: Object.freeze({
    missing_carrier: "proof_plan"
  }),
  controlled_contract_proof_plan_stale: Object.freeze({
    stale_carrier: "proof_plan"
  })
});

export class ControlledContractAssessmentRecoveryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ControlledContractAssessmentRecoveryError";
    this.code = code;
  }
}

function invalid(message) {
  throw new ControlledContractAssessmentRecoveryError(
    "controlled_contract_assessment_recovery_invalid",
    message
  );
}

function exactObject(value, allowed, field) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${field} must be one plain object`);
  }
  const unsupported = unsupportedObjectKeys(value, allowed);
  if (unsupported.length > 0) {
    invalid(`${field} carries unsupported fields: ${unsupported.sort(compareCodeUnits).join(", ")}`);
  }
  return value;
}

function normalizedIdentity(value) {
  const identity = exactObject(
    value,
    ["carrier_kind", "wk_id", "focus", "content_digest"],
    "contractIdentity"
  );
  if (identity.carrier_kind !== "contract" ||
      typeof identity.wk_id !== "string" || !WK_PATTERN.test(identity.wk_id) ||
      typeof identity.content_digest !== "string" ||
      !DIGEST_PATTERN.test(identity.content_digest)) {
    invalid("contractIdentity must be one exact controlled-contract identity");
  }
  const focus = identity.focus ?? null;
  if (focus !== null && (typeof focus !== "string" || !FOCUS_PATTERN.test(focus))) {
    invalid("contractIdentity.focus must be null or one canonical focus slug");
  }
  return {
    carrier_kind: "contract",
    wk_id: identity.wk_id,
    focus,
    content_digest: identity.content_digest
  };
}

export function buildControlledContractAssessmentRecovery(input) {
  const supplied = exactObject(
    input,
    ["reasonCode", "contractIdentity", "staleContentDigest"],
    "input"
  );
  const recovery = RECOVERY[supplied.reasonCode];
  if (recovery === undefined) invalid("reasonCode is not a package-owned recovery state");
  const contractIdentity = normalizedIdentity(supplied.contractIdentity);
  const isStale = supplied.reasonCode === "controlled_contract_proof_plan_stale";
  if (isStale !== Object.hasOwn(supplied, "staleContentDigest")) {
    invalid("staleContentDigest is required only for stale proof-plan recovery");
  }
  if (isStale && (typeof supplied.staleContentDigest !== "string" ||
      !DIGEST_PATTERN.test(supplied.staleContentDigest))) {
    invalid("staleContentDigest must be one canonical content digest");
  }

  const expectedContentDigest = isStale ? supplied.staleContentDigest : null;
  return deepFreeze({
    status: "capability-incomplete",
    reason_code: supplied.reasonCode,
    contract_identity: contractIdentity,
    next_calls: [],
    recovery: null,
    ...(recovery.missing_carrier === undefined
      ? { stale_carrier: recovery.stale_carrier }
      : { missing_carrier: recovery.missing_carrier }),
    ...(isStale || recovery.missing_carrier === "proof_plan"
      ? { expected_content_digest: expectedContentDigest }
      : {})
  });
}
