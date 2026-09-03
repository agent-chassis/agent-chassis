import { canonicalJsonBytes } from "../../lib/exact-binding-common.mjs";
import {
  OBSERVATION_VERSION,
  POLICY_VERSION,
  SUBJECTS_VERSION,
  boundaryGraph,
  deriveDeclaredBoundaryRecordConsistency
} from "../../lib/declared-boundary-record-consistency.mjs";
import {
  deriveDeclaredLimitGuidancePropagation,
  guidanceGraph
} from "../../lib/declared-limit-guidance-propagation.mjs";
import { buildEvaluationInput } from "./bounded-policy-v1-profile.mjs";

const baseLimits = Object.freeze([
  {
    bound_direction: "maximum", bound_inclusivity: "inclusive", limit_key: "bytes",
    limit_value: 4, measurement_class: "utf8_byte_measurement", normalization: "none",
    overflow_disposition: "refuse", unit: "utf8_byte_count"
  },
  {
    bound_direction: "maximum", bound_inclusivity: "inclusive", limit_key: "empty",
    limit_value: 0, measurement_class: "unicode_scalar_measurement", normalization: "none",
    overflow_disposition: "refuse", unit: "unicode_scalar_count"
  },
  {
    bound_direction: "maximum", bound_inclusivity: "exclusive", limit_key: "scalar",
    limit_value: 2, measurement_class: "unicode_scalar_measurement", normalization: "nfc",
    overflow_disposition: "truncate", unit: "unicode_scalar_count"
  },
  {
    bound_direction: "minimum", bound_inclusivity: "inclusive", limit_key: "utf16",
    limit_value: 2, measurement_class: "utf16_code_unit_measurement", normalization: "none",
    overflow_disposition: "refuse", unit: "utf16_code_unit_count"
  }
]);

function expectedDisposition(limit, position) {
  const within = limit.bound_direction === "maximum"
    ? position === "below" || (position === "at" && limit.bound_inclusivity === "inclusive")
    : position === "above" || (position === "at" && limit.bound_inclusivity === "inclusive");
  return within ? "accepted" : limit.overflow_disposition === "truncate"
    ? "truncated" : "refused";
}
function textFor(limit, measurement) {
  if (limit.unit === "utf8_byte_count") return "a".repeat(measurement);
  if (limit.unit === "unicode_scalar_count") return "é".repeat(measurement);
  if (limit.unit === "utf16_code_unit_count") {
    if (measurement === 1) return "a";
    if (measurement === 2) return "😀";
    return `😀${"a".repeat(measurement - 2)}`;
  }
  throw new Error(`unsupported unit ${limit.unit}`);
}

function buildPolicy(limits = baseLimits) {
  return { schema_version: POLICY_VERSION, limits: structuredClone(limits) };
}

function contractFromGraph(graph) {
  return {
    schema_version: "controlled-acceptance-contract.v1",
    vocabulary_version: "controlled-contract-vocabulary.v1",
    profile_id: "acceptance-contract.standard.v1",
    references: structuredClone(graph.references),
    propositions: structuredClone(graph.propositions),
    claims: structuredClone(graph.claims),
    relations: structuredClone(graph.relations),
    collections: structuredClone(graph.collections),
    residue: [],
    annotations: [], test_proof_version: "controlled-contract-test-proof.v1", test_proofs: []
  };
}

function buildBoundaryFixture({ limits = baseLimits, provenance = "caller_asserted" } = {}) {
  const policy = buildPolicy(limits);
  const cases = [];
  const subjects = [];
  for (const limit of policy.limits) {
    const positions = limit.limit_value === 0 ? ["at", "above"] : ["below", "at", "above"];
    for (const position of positions) {
      const offset = position === "below" ? -1 : position === "above" ? 1 : 0;
      const caseId = `${limit.limit_key}-${position}`;
      const subjectId = `subject-${caseId}`;
      const disposition = expectedDisposition(limit, position);
      cases.push({
        boundary_position: position,
        case_id: caseId,
        limit_key: limit.limit_key,
        observed_disposition: disposition,
        subject_id: subjectId,
        ...(disposition === "truncated" ? { observed_truncated_measure: limit.limit_value } : {})
      });
      subjects.push({
        content_base64: Buffer.from(textFor(limit, limit.limit_value + offset), "utf8")
          .toString("base64"),
        content_encoding: "utf8_base64",
        subject_id: subjectId
      });
    }
  }
  cases.sort((a, b) => a.case_id < b.case_id ? -1 : 1);
  subjects.sort((a, b) => a.subject_id < b.subject_id ? -1 : 1);
  const observation = { schema_version: OBSERVATION_VERSION, cases, provenance };
  const subjectDocument = { schema_version: SUBJECTS_VERSION, subjects };
  const policyBytes = canonicalJsonBytes(policy, { file: true });
  const observationBytes = canonicalJsonBytes(observation, { file: true });
  const subjectsBytes = canonicalJsonBytes(subjectDocument, { file: true });
  const reportBytes = deriveDeclaredBoundaryRecordConsistency({
    policyBytes, observationBytes, subjectsBytes
  });
  const report = JSON.parse(reportBytes);
  const contract = contractFromGraph(boundaryGraph(report));
  return {
    kind: "boundary", policy, observation, subjects: subjectDocument,
    policyBytes, observationBytes, subjectsBytes, reportBytes, report, contract,
    evaluationInput: buildEvaluationInput("boundary", report)
  };
}

function guidanceText(policy, { punctuation = " = ", unicode = false, unrelated = false } = {}) {
  const heading = unicode ? "限界 guidance — naïve façade\n" : "Declared limits\n";
  const lines = policy.limits.map((limit) =>
    `${limit.limit_key}${punctuation}${limit.limit_value} ${limit.unit};`);
  return `${heading}${lines.join("\n")}${unrelated ? "\nrevision 7" : ""}\n`;
}

function buildGuidanceFixture({ limits = baseLimits, guidance = null, guidanceOptions = {} } = {}) {
  const policy = buildPolicy(limits);
  const policyBytes = canonicalJsonBytes(policy, { file: true });
  const guidanceBytes = Buffer.from(guidance ?? guidanceText(policy, guidanceOptions), "utf8");
  const reportBytes = deriveDeclaredLimitGuidancePropagation({ policyBytes, guidanceBytes });
  const report = JSON.parse(reportBytes);
  const contract = contractFromGraph(guidanceGraph(report));
  return {
    kind: "guidance", policy, policyBytes, guidanceBytes, reportBytes, report, contract,
    evaluationInput: buildEvaluationInput("guidance", report)
  };
}

export {
  baseLimits,
  buildBoundaryFixture,
  buildGuidanceFixture,
  buildPolicy,
  guidanceText
};
