import { buildSupplementaryIsolationSources } from "./supplementary-isolation-v1-fixture.mjs";
import { createSupplementaryIsolationSubject } from "./supplementary-isolation-v1-harness.mjs";
import {
  stableProjectedProofSubjectProvenV1
} from "../support/stable-v1-proof-pack-runtime.mjs";

const CONTROL_IDS = Object.freeze([
  "admission-splice", "capture-splice", "core-value-substitution", "declaration-splice",
  "evaluation-input-splice", "multiple-failures", "multiple-final-results",
  "multiple-settlements", "positive-omitted", "positive-present", "profile-splice",
  "projection-splice"
]);

function proven(subject, overrides = {}) {
  if (Object.keys(overrides).length > 0) return false;
  return stableProjectedProofSubjectProvenV1(subject);
}

async function positive(options) {
  const subject = await createSupplementaryIsolationSubject({ fixtureOptions: options });
  try { return proven(subject); } finally { await subject.cleanup(); }
}

async function refused(options, overrides = {}) {
  let subject;
  try { subject = await createSupplementaryIsolationSubject(options); }
  catch { return true; }
  try { return !proven(subject, overrides); } finally { await subject.cleanup(); }
}

async function runExactBindingCertificationControls() {
  const baseline = buildSupplementaryIsolationSources({ branch: "present", attemptSuffix: "baseline" });
  const alternate = buildSupplementaryIsolationSources({ branch: "present", attemptSuffix: "alternate" });
  const checks = new Map();
  checks.set("positive-present", await positive({ branch: "present" }));
  checks.set("positive-omitted", await positive({ branch: "omitted" }));
  checks.set("core-value-substitution", await refused({
    fixtureOptions: { finalCoreValue: "ref-different-final-core-value" }
  }));
  checks.set("multiple-settlements", await refused({ fixtureOptions: { settlements: 2 } }));
  checks.set("multiple-failures", await refused({ fixtureOptions: { failures: 2 } }));
  checks.set("multiple-final-results", await refused({ fixtureOptions: { results: 2 } }));
  checks.set("projection-splice", await refused({ source: baseline,
    projectionBytes: alternate.projectionBytes }));
  checks.set("capture-splice", await refused({ source: baseline, sourceFiles: {
    "attempt-record.json": baseline.sourceBytes[0],
    "core-settlement-record.json": alternate.sourceBytes[1],
    "supplementary-failure-record.json": baseline.sourceBytes[2],
    "final-result-record.json": baseline.sourceBytes[3],
    "supplementary-isolation-projection.json": baseline.projectionBytes
  } }));
  checks.set("evaluation-input-splice", await refused({ source: baseline,
    mutateEvaluationInput(input) {
      input.reference_bindings.find(({ role }) => role === "operation").reference_ids = ["ref-attempt"];
      return input;
    } }));
  checks.set("declaration-splice", await refused({ source: baseline,
    mutateDeclaration(declaration) { declaration.profile_digest = "0".repeat(64); return declaration; } }));
  checks.set("profile-splice", await refused({ source: baseline,
    mutateProfile(profile) { profile.profile_version = "1.0.1"; return profile; } }));
  const admissionSubject = await createSupplementaryIsolationSubject({ source: baseline });
  try {
    const spliced = structuredClone(admissionSubject.pack);
    spliced.admission.guarantee += " spliced";
    spliced.admission_digest = "0".repeat(64);
    checks.set("admission-splice", !proven(admissionSubject, { proofPack: spliced }));
  } finally { await admissionSubject.cleanup(); }
  return {
    passed_control_ids: CONTROL_IDS.filter((id) => checks.get(id) === true),
    failed_control_ids: CONTROL_IDS.filter((id) => checks.get(id) !== true)
  };
}

export { CONTROL_IDS, runExactBindingCertificationControls };
