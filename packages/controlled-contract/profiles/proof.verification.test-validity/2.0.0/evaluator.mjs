import { createHash } from "node:crypto";

import PROFILE from "./profile.json" with { type: "json" };
import {
  StableVerificationError,
  evaluateVerificationProfileV1
} from "../../../lib/verification-profile-v1.mjs";

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])])
  );
  return value;
}

function canonicalDigest(value) {
  return createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex");
}

function evaluateTestValidity({ contract, evaluation_input }) {
  const { input_version: _inputVersion, ...testValidity } = evaluation_input;
  const payload = {
    contract,
    profile: PROFILE,
    evaluation_input: {
      input_version: "controlled-contract-verification-profile-input.v1",
      evaluation_stage: "pre_dispatch",
      reference_bindings: [
        { role: "component", reference_ids: ["ref-component"] },
        { role: "suite", reference_ids: ["ref-suite"] }
      ],
      number_bindings: [],
      claim_pattern_bindings: [],
      resolver_facts: [],
      delivered_evidence: [],
      stable_evaluation: { test_validity: [testValidity] }
    }
  };
  try {
    const result = evaluateVerificationProfileV1(payload);
    return {
      ...result,
      semantic_judgment: "not_performed_coordinator_owned"
    };
  } catch (error) {
    if (!(error instanceof StableVerificationError)) throw error;
    return {
      satisfaction: "unsatisfied",
      diagnostics: error.details?.diagnostics?.diagnostics ?? [],
      semantic_judgment: "not_performed_coordinator_owned"
    };
  }
}

export { canonicalDigest, evaluateTestValidity };
