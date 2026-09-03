import assert from "node:assert/strict";
import {
  appendFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  symlink,
  truncate,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canonicalDigest,
  canonicalJsonBytes,
  sha256,
  validators
} from "../lib/exact-binding-common.mjs";
import {
  assertCanonicalCertificationFile,
  loadExactBindingAdmissionV1
} from "../lib/exact-binding-admission.mjs";
import { assessExactBindingFilesV1 } from "../lib/exact-binding-assessment.mjs";
import {
  MAX_ARTIFACT_BYTES,
  PinnedCaptureRoot,
  assertDescriptorCapturePlatform,
  captureAndEvaluateExactBindingsV1,
  normalizeMutationSnapshot,
  normalizeReachabilitySnapshot,
  validateStableArtifactObservation
} from "../lib/exact-binding-capture.mjs";
import {
  evaluateExactBindingsV1,
  semanticDeclarationDiagnostics
} from "../lib/exact-binding.mjs";
import {
  assertBoundaryRequest,
  assertProxyDetectorAvailable,
  snapshotExactBindingAssessmentRequest
} from "../lib/exact-binding-plain-data.mjs";
import { profileDigestV034 } from "../lib/verification-profile-v034.mjs";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
const d = (character) => character.repeat(64);
const context = Object.freeze({
  contract_digest: d("1"),
  profile_digest: d("2"),
  evaluation_input_digest: d("3"),
  vocabulary_version: "0.34.0",
  vocabulary_complete_digest: d("4"),
  admission_digest: d("5"),
  exact_binding_declaration_digest: d("6"),
  exact_binding_certification_digest: d("7")
});
const evaluationInput = Object.freeze({
  reference_bindings: Object.freeze([
    Object.freeze({ role: "baseline_artifact", reference_ids: Object.freeze(["ref-baseline"]) }),
    Object.freeze({ role: "candidate_artifact", reference_ids: Object.freeze(["ref-candidate"]) })
  ]),
  delivered_evidence: Object.freeze([])
});
const declaration = Object.freeze({
  schema_version: "controlled-contract-exact-binding-declaration.v1",
  profile_id: "proof.compatibility.behavioral-preservation",
  profile_version: "1.0.0",
  profile_digest: d("2"),
  requirements: Object.freeze([
    Object.freeze({
      requirement_id: "baseline-artifact",
      binding_kind: "artifact_bytes",
      role_coverage: Object.freeze([Object.freeze({
        role: "baseline_artifact", coverage: "exact", projection: "artifact_subject"
      })])
    }),
    Object.freeze({
      requirement_id: "candidate-artifact",
      binding_kind: "artifact_bytes",
      role_coverage: Object.freeze([Object.freeze({
        role: "candidate_artifact", coverage: "exact", projection: "artifact_subject"
      })])
    })
  ]),
  relations: Object.freeze([
    Object.freeze({
      relation_id: "baseline-matches-candidate",
      operator: "same_content_sha256",
      requirement_ids: Object.freeze(["baseline-artifact", "candidate-artifact"])
    }),
    Object.freeze({
      relation_id: "independent-captures",
      operator: "distinct_capture_id",
      requirement_ids: Object.freeze(["baseline-artifact", "candidate-artifact"])
    })
  ])
});

function binding(requirementId, role, referenceId, content = d("a"), captureId) {
  return {
    binding_id: `binding-${requirementId}`,
    requirement_id: requirementId,
    capture_id: captureId ?? `capture-${requirementId}`,
    binding_kind: "artifact_bytes",
    media_type: "application/octet-stream",
    content_sha256: content,
    byte_length: 1,
    role_coverage: [{
      role,
      coverage: "exact",
      projection: "artifact_subject",
      reference_ids: [referenceId]
    }]
  };
}

function direct(bindings, values = {}) {
  return evaluateExactBindingsV1({
    declaration: values.declaration ?? declaration,
    evaluationInput: values.evaluationInput ?? evaluationInput,
    context: values.context ?? context,
    expectedContext: values.expectedContext ?? context,
    bindings
  });
}

function baseRequest(sources = {
  "baseline-artifact": { kind: "artifact_file", relative_path: "baseline.bin" },
  "candidate-artifact": { kind: "artifact_file", relative_path: "candidate.bin" }
}) {
  return {
    contractPath: "contract.json",
    evaluationInputPath: "evaluation.json",
    profileId: "proof.compatibility.behavioral-preservation",
    exactBindingSources: sources
  };
}

function graphRequest(nodes = [{ reference_id: "ref-node" }]) {
  return baseRequest({
    "production-graph": {
      kind: "complete_reachability_snapshot",
      snapshot: {
        complete: true,
        subject_reference_id: "ref-graph",
        nodes,
        edges: []
      }
    }
  });
}

async function createAdmissionPack(root, declarationValue = null) {
  const sourceDirectory = path.join(
    PACKAGE_ROOT,
    "profiles/proof.completeness.lossless-projection/1.0.0"
  );
  const profile = JSON.parse(await readFile(path.join(sourceDirectory, "profile.json"), "utf8"));
  const admissionV1 = JSON.parse(
    await readFile(path.join(sourceDirectory, "admission.json"), "utf8")
  );
  const profileDigest = profileDigestV034(profile);
  const exactDeclaration = declarationValue ?? {
    schema_version: "controlled-contract-exact-binding-declaration.v1",
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: profileDigest,
    requirements: [{
      requirement_id: "artifact",
      binding_kind: "artifact_bytes",
      role_coverage: [{
        role: "artifact_subject", coverage: "exact", projection: "artifact_subject"
      }]
    }],
    relations: []
  };
  const declarationBytes = canonicalJsonBytes(exactDeclaration, { file: true });
  const declarationDigest = sha256(declarationBytes);
  const passed = ["capture-stable", "declaration-bound"];
  const certification = {
    schema_version: "controlled-contract-exact-binding-certification-result.v1",
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: profileDigest,
    exact_binding_declaration_digest: declarationDigest,
    corpus: {
      corpus_id: "exact-binding-adequacy",
      corpus_version: "1.0.0",
      corpus_digest: d("8"),
      executable_control_count: passed.length
    },
    result: { status: "passed", passed_control_ids: passed, failed_control_ids: [] }
  };
  const certificationBytes = canonicalJsonBytes(certification, { file: true });
  const admission = {
    ...admissionV1,
    schema_version: "controlled-contract-admitted-proof-pack.v2",
    exact_binding: {
      declaration_digest: declarationDigest,
      certification_result_digest: sha256(certificationBytes),
      executable_control_count: passed.length,
      binding_kinds: [...new Set(exactDeclaration.requirements.map(
        ({ binding_kind: kind }) => kind
      ))].sort(),
      relation_operators: [...new Set(exactDeclaration.relations.map(
        ({ operator }) => operator
      ))].sort(),
      corpus_id: certification.corpus.corpus_id,
      corpus_version: certification.corpus.corpus_version,
      corpus_digest: certification.corpus.corpus_digest,
      passed_control_ids: passed
    }
  };
  await mkdir(root, { recursive: true });
  await Promise.all([
    writeFile(path.join(root, "profile.json"), `${JSON.stringify(profile, null, 2)}\n`),
    writeFile(path.join(root, "admission.json"), `${JSON.stringify(admission, null, 2)}\n`),
    writeFile(path.join(root, "exact-binding.json"), declarationBytes),
    writeFile(path.join(root, "exact-binding-certification.json"), certificationBytes)
  ]);
  return { profile, admission, declaration: exactDeclaration, certification };
}

async function rewriteCertification(directory, mutate, canonical = true) {
  const file = path.join(directory, "exact-binding-certification.json");
  const value = JSON.parse(await readFile(file, "utf8"));
  mutate(value);
  await writeFile(file, canonical
    ? canonicalJsonBytes(value, { file: true })
    : `${JSON.stringify(value, null, 2)}\n`);
}

test("schemas compile strictly and the ordinary direct result is unadmitted", () => {
  assert.equal(Object.values(validators).every((validator) => typeof validator === "function"), true);
  const result = direct([
    binding("baseline-artifact", "baseline_artifact", "ref-baseline"),
    binding("candidate-artifact", "candidate_artifact", "ref-candidate")
  ]);
  assert.equal(result.satisfaction, "satisfied");
  assert.deepEqual(result.provenance, {
    kind: "unadmitted_direct",
    capture_verified: false,
    filesystem_paths_authoritative: false,
    snapshot_completeness_authoritative: false,
    caller_values_authoritative: false,
    runtime_truth_authoritative: false
  });
  assert.equal(Object.isFrozen(result), true);
});

test("ordinary malformed stale swapped and deterministic cases fail closed", () => {
  const left = binding("baseline-artifact", "baseline_artifact", "ref-baseline");
  const right = binding("candidate-artifact", "candidate_artifact", "ref-candidate");
  const malformed = structuredClone(left);
  malformed.callback = "run";
  assert.equal(direct([malformed, right]).satisfaction, "invalid");
  assert.equal(direct([left]).satisfaction, "indeterminate");
  assert.equal(direct([left, { ...right, content_sha256: d("b") }]).satisfaction,
    "unsatisfied");
  const stale = { ...context, contract_digest: d("9") };
  assert.equal(direct([left, right], { context: stale }).satisfaction, "invalid");
  const first = direct([right, left]);
  const second = direct([left, right]);
  assert.equal(first.binding_set_sha256, second.binding_set_sha256);
  assert.deepEqual(first, second);
});

test("distinct-source relation compares captured source descriptors, not requirement ids", () => {
  const value = structuredClone(declaration);
  value.relations = [{
    relation_id: "distinct-source-descriptors",
    operator: "distinct_source_descriptor",
    requirement_ids: ["baseline-artifact", "candidate-artifact"]
  }];
  const left = {
    ...binding("baseline-artifact", "baseline_artifact", "ref-baseline"),
    source_descriptor_sha256: d("a")
  };
  const right = {
    ...binding("candidate-artifact", "candidate_artifact", "ref-candidate"),
    source_descriptor_sha256: d("b")
  };
  assert.equal(direct([left, right], { declaration: value }).satisfaction, "satisfied");
  const reused = direct([
    left, { ...right, source_descriptor_sha256: left.source_descriptor_sha256 }
  ], { declaration: value });
  assert.equal(reused.satisfaction, "unsatisfied");
  assert.equal(reused.relation_results[0].status, "unsatisfied");
  const ungrounded = direct([
    left, { ...right, source_descriptor_sha256: undefined }
  ], { declaration: value });
  assert.equal(ungrounded.satisfaction, "invalid");
  assert.ok(ungrounded.diagnostics.some(
    ({ code }) => code === "source_descriptor_digest_missing"
  ));
});

test("distinct-content relation requires pairwise-distinct captured content digests", () => {
  const value = structuredClone(declaration);
  value.relations = [{
    relation_id: "captured-version-content-distinct",
    operator: "distinct_content_sha256",
    requirement_ids: ["baseline-artifact", "candidate-artifact"]
  }];
  const left = {
    ...binding("baseline-artifact", "baseline_artifact", "ref-baseline", d("a")),
    source_descriptor_sha256: d("1")
  };
  const right = {
    ...binding("candidate-artifact", "candidate_artifact", "ref-candidate", d("b")),
    source_descriptor_sha256: d("2")
  };
  const satisfied = direct([left, right], { declaration: value });
  assert.equal(satisfied.satisfaction, "satisfied");
  assert.deepEqual(satisfied.relation_results[0], {
    relation_id: "captured-version-content-distinct",
    operator: "distinct_content_sha256",
    requirement_ids: ["baseline-artifact", "candidate-artifact"],
    status: "satisfied",
    observed_content_sha256: [d("a"), d("b")]
  });
  const reused = direct([
    left,
    {
      ...right,
      content_sha256: left.content_sha256,
      capture_id: "capture-still-distinct",
      source_descriptor_sha256: d("3")
    }
  ], { declaration: value });
  assert.equal(reused.satisfaction, "unsatisfied");
  assert.equal(reused.relation_results[0].status, "unsatisfied");
});

test("EBPR-001 relation-id-duplicate", () => {
  const value = structuredClone(declaration);
  value.relations[1].relation_id = value.relations[0].relation_id;
  assert.ok(semanticDeclarationDiagnostics(value).some(({ code }) =>
    code === "relation_id_duplicate"));
});
for (const [name, operator, requirementId] of [
  ["same-content-repeated-requirement", "same_content_sha256", "baseline-artifact"],
  ["distinct-content-repeated-requirement", "distinct_content_sha256", "baseline-artifact"],
  ["distinct-capture-repeated-requirement", "distinct_capture_id", "candidate-artifact"]
]) test(`EBPR-001 ${name}`, () => {
  const value = structuredClone(declaration);
  value.relations = [{ relation_id: "repeated-operands", operator,
    requirement_ids: [requirementId, requirementId] }];
  assert.ok(semanticDeclarationDiagnostics(value).some(({ code }) =>
    code === "exact_binding_declaration_schema_invalid"));
});
test("EBPR-001 relation-operand-dangling", () => {
  const value = structuredClone(declaration);
  value.relations[0].requirement_ids[1] = "undeclared-artifact";
  assert.ok(semanticDeclarationDiagnostics(value).some(({ code }) =>
    code === "relation_operand_undeclared"));
});
test("EBPR-001 relation-operand-order", () => {
  const value = structuredClone(declaration);
  value.relations[0].requirement_ids.reverse();
  assert.ok(semanticDeclarationDiagnostics(value).some(({ code }) =>
    code === "relation_operand_order_noncanonical"));
});

test("EBPR-002 capture-root-rename-replacement", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "eb-root-replace-"));
  const root = path.join(parent, "root");
  await mkdir(root);
  await writeFile(path.join(root, "artifact.bin"), "original");
  const pinned = await PinnedCaptureRoot.open(root);
  await rename(root, path.join(parent, "moved"));
  await mkdir(root);
  await writeFile(path.join(root, "artifact.bin"), "replacement");
  assert.equal((await pinned.captureArtifact("artifact.bin")).toString(), "original");
  await pinned.close();
});
test("EBPR-002 capture-root-reopen-forbidden", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "eb-root-reopen-"));
  const root = path.join(parent, "root");
  await mkdir(root);
  await writeFile(path.join(root, "artifact.bin"), "retained");
  const pinned = await PinnedCaptureRoot.open(root);
  await rename(root, path.join(parent, "gone"));
  assert.equal((await pinned.captureArtifact("artifact.bin")).toString(), "retained");
  await pinned.close();
});
test("EBPR-002 descriptor-relative-parent-traversal", () => {
  const request = baseRequest();
  request.exactBindingSources["baseline-artifact"].relative_path = "../outside.bin";
  assert.throws(() => snapshotExactBindingAssessmentRequest(request), {
    code: "exact_binding_assessment_request_invalid"
  });
});
test("EBPR-002 descriptor-relative-intermediate-swap", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "eb-intermediate-"));
  const root = path.join(parent, "root");
  await mkdir(path.join(root, "nested"), { recursive: true });
  await writeFile(path.join(root, "nested", "artifact.bin"), "original");
  const pinned = await PinnedCaptureRoot.open(root);
  const nested = await pinned.pinDirectory("nested");
  await rename(path.join(root, "nested"), path.join(root, "moved"));
  await mkdir(path.join(root, "nested"));
  await writeFile(path.join(root, "nested", "artifact.bin"), "replacement");
  assert.equal((await nested.captureArtifact("artifact.bin")).toString(), "original");
  await nested.close();
  await pinned.close();
});
test("EBPR-002 capture-primitive-unavailable", () => {
  assert.throws(() => assertDescriptorCapturePlatform("unsupported"), {
    code: "descriptor_capture_primitive_unavailable"
  });
});
test("EBPR-002 capture-enforces-the-per-source-byte-bound", async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "eb-source-bound-"));
  const root = path.join(parent, "root");
  await mkdir(root);
  const artifact = path.join(root, "artifact.bin");
  await writeFile(artifact, Buffer.alloc(MAX_ARTIFACT_BYTES, 0x5a));
  const pinned = await PinnedCaptureRoot.open(root);
  const captured = await pinned.captureArtifact("artifact.bin");
  assert.equal(captured.byteLength, MAX_ARTIFACT_BYTES);
  assert.equal(captured[0], 0x5a);
  await pinned.close();

  await writeFile(artifact, Buffer.alloc(MAX_ARTIFACT_BYTES + 1, 0x5a));
  const sample = await open(artifact, "r");
  const fileHandlePrototype = Object.getPrototypeOf(sample);
  await sample.close();
  let oversizedReadCount = 0;
  const originalRead = fileHandlePrototype.read;
  t.mock.method(fileHandlePrototype, "read", async function (...args) {
    oversizedReadCount += 1;
    return Reflect.apply(originalRead, this, args);
  });
  const oversized = await PinnedCaptureRoot.open(root);
  await assert.rejects(oversized.captureArtifact("artifact.bin"), {
    code: "artifact_capture_source_too_large"
  });
  await oversized.close();
  assert.equal(oversizedReadCount, 0);
});
test("EBPR-002 capture-accepts-stable-under-bound-content", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "eb-source-stable-"));
  const root = path.join(parent, "root");
  await mkdir(root);
  await writeFile(path.join(root, "artifact.bin"), Buffer.from([0x5a]));
  const pinned = await PinnedCaptureRoot.open(root);
  assert.deepEqual(await pinned.captureArtifact("artifact.bin"), Buffer.from([0x5a]));
  await pinned.close();
});
test("EBPR-002 capture-classifies-under-bound-growth-as-change", async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "eb-source-small-growth-"));
  const root = path.join(parent, "root");
  await mkdir(root);
  const artifact = path.join(root, "artifact.bin");
  await writeFile(artifact, Buffer.from([0x5a]));
  const sample = await open(artifact, "r");
  const fileHandlePrototype = Object.getPrototypeOf(sample);
  await sample.close();
  const originalRead = fileHandlePrototype.read;
  const readRequests = [];
  let appended = false;
  t.mock.method(fileHandlePrototype, "read", async function (...args) {
    const [, offset, length, position] = args;
    readRequests.push({ offset, length, position });
    if (!appended) {
      appended = true;
      await appendFile(artifact, Buffer.from([0x59]));
    }
    return Reflect.apply(originalRead, this, args);
  });
  const pinned = await PinnedCaptureRoot.open(root);
  await assert.rejects(pinned.captureArtifact("artifact.bin"), {
    code: "artifact_capture_changed_during_read"
  });
  await pinned.close();
  assert.deepEqual(readRequests, [
    { offset: 0, length: 1, position: 0 },
    { offset: 0, length: 1, position: 1 }
  ]);
});
test("EBPR-002 capture-classifies-under-bound-shrinkage-as-change", async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "eb-source-shrink-"));
  const root = path.join(parent, "root");
  await mkdir(root);
  const artifact = path.join(root, "artifact.bin");
  await writeFile(artifact, Buffer.from([0x5a, 0x59]));
  const sample = await open(artifact, "r");
  const fileHandlePrototype = Object.getPrototypeOf(sample);
  await sample.close();
  const originalRead = fileHandlePrototype.read;
  let shrunk = false;
  t.mock.method(fileHandlePrototype, "read", async function (...args) {
    if (!shrunk) {
      shrunk = true;
      await truncate(artifact, 1);
    }
    return Reflect.apply(originalRead, this, args);
  });
  const pinned = await PinnedCaptureRoot.open(root);
  await assert.rejects(pinned.captureArtifact("artifact.bin"), {
    code: "artifact_capture_changed_during_read"
  });
  await pinned.close();
});
test("EBPR-002 capture-classifies-under-bound-replacement-as-change", async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "eb-source-replace-"));
  const root = path.join(parent, "root");
  await mkdir(root);
  const artifact = path.join(root, "artifact.bin");
  const displaced = path.join(root, "displaced.bin");
  await writeFile(artifact, Buffer.from([0x5a]));
  const sample = await open(artifact, "r");
  const fileHandlePrototype = Object.getPrototypeOf(sample);
  await sample.close();
  const originalRead = fileHandlePrototype.read;
  let replaced = false;
  t.mock.method(fileHandlePrototype, "read", async function (...args) {
    if (!replaced) {
      replaced = true;
      await rename(artifact, displaced);
      await writeFile(artifact, Buffer.from([0x59]));
    }
    return Reflect.apply(originalRead, this, args);
  });
  const pinned = await PinnedCaptureRoot.open(root);
  await assert.rejects(pinned.captureArtifact("artifact.bin"), {
    code: "artifact_capture_changed_during_read"
  });
  await pinned.close();
});
test("EBPR-002 capture-detects-growth-before-exposing-oversized-content", async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "eb-source-growth-"));
  const root = path.join(parent, "root");
  await mkdir(root);
  const artifact = path.join(root, "artifact.bin");
  await writeFile(artifact, Buffer.alloc(MAX_ARTIFACT_BYTES, 0x5a));

  const sample = await open(artifact, "r");
  const fileHandlePrototype = Object.getPrototypeOf(sample);
  await sample.close();
  const originalRead = fileHandlePrototype.read;
  const readRequests = [];
  let appended = false;
  t.mock.method(fileHandlePrototype, "read", async function (...args) {
    const [, offset, length, position] = args;
    readRequests.push({ offset, length, position });
    if (!appended) {
      appended = true;
      await appendFile(artifact, Buffer.from([0x59]));
    }
    return Reflect.apply(originalRead, this, args);
  });

  const pinned = await PinnedCaptureRoot.open(root);
  await assert.rejects(pinned.captureArtifact("artifact.bin"), {
    code: "artifact_capture_source_too_large"
  });
  await pinned.close();
  assert.equal(appended, true);
  assert.ok(readRequests.every(({ length }) => length <= MAX_ARTIFACT_BYTES));
  assert.deepEqual(readRequests.at(-1), {
    offset: 0, length: 1, position: MAX_ARTIFACT_BYTES
  });
});

function fileStat(overrides = {}) {
  return {
    dev: 1n, ino: 2n, mode: 0o100644n, size: 4n,
    mtimeNs: 5n, ctimeNs: 6n, ...overrides
  };
}

test("EBPR-003 same-inode-write-restored-mtime", () => {
  assert.throws(() => validateStableArtifactObservation(
    fileStat(), fileStat({ ctimeNs: 7n }), 4
  ), { code: "artifact_capture_changed_during_read" });
});
test("EBPR-003 capture-ctime-unavailable", () => {
  assert.throws(() => validateStableArtifactObservation(
    { ...fileStat(), ctimeNs: undefined }, fileStat(), 4
  ), { code: "capture_change_metadata_unavailable" });
});
test("EBPR-003 capture-ctime-changed-only", () => {
  assert.throws(() => validateStableArtifactObservation(
    fileStat(), fileStat({ ctimeNs: 99n }), 4
  ), { code: "artifact_capture_changed_during_read" });
});
test("EBPR-003 capture-byte-length-stat-consistency", () => {
  assert.throws(() => validateStableArtifactObservation(fileStat(), fileStat(), 3), {
    code: "artifact_capture_byte_length_mismatch"
  });
});

test("EBPR-004 certification-carrier-missing", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "eb-cert-missing-"));
  const { profile } = await createAdmissionPack(directory);
  await rm(path.join(directory, "exact-binding-certification.json"));
  await assert.rejects(loadExactBindingAdmissionV1(directory, profile.profile_id), {
    code: "exact_binding_admitted_carrier_missing"
  });
});
test("EBPR-004 certification-carrier-byte-edit", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "eb-cert-edit-"));
  const { profile } = await createAdmissionPack(directory);
  await rewriteCertification(directory, (value) => { value.corpus.corpus_digest = d("9"); });
  await assert.rejects(loadExactBindingAdmissionV1(directory, profile.profile_id), {
    code: "exact_binding_admission_binding_mismatch"
  });
});
test("EBPR-004 certification-carrier-noncanonical", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "eb-cert-format-"));
  const { profile } = await createAdmissionPack(directory);
  await rewriteCertification(directory, () => {}, false);
  await assert.rejects(loadExactBindingAdmissionV1(directory, profile.profile_id), {
    code: "exact_binding_certification_noncanonical"
  });
});
test("EBPR-004 certification-profile-splice", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "eb-cert-profile-"));
  const { profile } = await createAdmissionPack(directory);
  await rewriteCertification(directory, (value) => { value.profile_id = "proof.swapped"; });
  await assert.rejects(loadExactBindingAdmissionV1(directory, profile.profile_id), {
    code: "exact_binding_admission_binding_mismatch"
  });
});
test("EBPR-004 certification-declaration-splice", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "eb-cert-declaration-"));
  const { profile } = await createAdmissionPack(directory);
  await rewriteCertification(directory, (value) => {
    value.exact_binding_declaration_digest = d("9");
  });
  await assert.rejects(loadExactBindingAdmissionV1(directory, profile.profile_id), {
    code: "exact_binding_admission_binding_mismatch"
  });
});
test("EBPR-004 certification-corpus-splice", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "eb-cert-corpus-"));
  const { profile } = await createAdmissionPack(directory);
  await rewriteCertification(directory, (value) => {
    value.corpus.executable_control_count += 1;
  });
  await assert.rejects(loadExactBindingAdmissionV1(directory, profile.profile_id), {
    code: "exact_binding_certification_population_invalid"
  });
});
test("EBPR-004 certification-status-or-failure-splice", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "eb-cert-status-"));
  const { profile } = await createAdmissionPack(directory);
  await rewriteCertification(directory, (value) => {
    value.result.status = "failed";
    value.result.failed_control_ids = ["failed-control"];
  });
  await assert.rejects(loadExactBindingAdmissionV1(directory, profile.profile_id), {
    code: "exact_binding_certification_schema_invalid"
  });
});
test("EBPR-004 certification-external-substitute", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "eb-cert-external-"));
  const { profile, certification } = await createAdmissionPack(directory);
  await rewriteCertification(directory, (value) => { value.corpus.corpus_digest = d("9"); });
  await assert.rejects(
    loadExactBindingAdmissionV1(directory, profile.profile_id, certification),
    { code: "exact_binding_admission_binding_mismatch" }
  );
});

test("EBPR-005 sources-accessor-rejected", () => {
  let calls = 0;
  const root = baseRequest();
  Object.defineProperty(root, "callback", { enumerable: true, get() { calls += 1; } });
  assert.throws(() => snapshotExactBindingAssessmentRequest(root), {
    code: "plain_data_accessor_refused"
  });
  const nested = baseRequest();
  Object.defineProperty(nested.exactBindingSources["baseline-artifact"], "relative_path", {
    enumerable: true, get() { calls += 1; }
  });
  assert.throws(() => snapshotExactBindingAssessmentRequest(nested), {
    code: "plain_data_accessor_refused"
  });
  assert.equal(calls, 0);
});
test("EBPR-005 sources-proxy-rejected", () => {
  let traps = 0;
  const proxied = new Proxy(baseRequest(), {
    ownKeys(target) { traps += 1; return Reflect.ownKeys(target); }
  });
  assert.throws(() => snapshotExactBindingAssessmentRequest(proxied), {
    code: "plain_data_proxy_refused"
  });
  const nested = baseRequest();
  nested.exactBindingSources["baseline-artifact"] = new Proxy(
    nested.exactBindingSources["baseline-artifact"], {
      getOwnPropertyDescriptor(target, key) {
        traps += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      }
    }
  );
  assert.throws(() => snapshotExactBindingAssessmentRequest(nested), {
    code: "plain_data_proxy_refused"
  });
  const { proxy, revoke } = Proxy.revocable(baseRequest(), {});
  revoke();
  assert.throws(() => snapshotExactBindingAssessmentRequest(proxy), {
    code: "plain_data_proxy_refused"
  });
  assert.equal(traps, 0);
});
test("EBPR-005 sources-custom-array-method", () => {
  const request = graphRequest();
  Object.defineProperty(request.exactBindingSources["production-graph"].snapshot.nodes,
    "map", { value() {}, enumerable: true });
  assert.throws(() => snapshotExactBindingAssessmentRequest(request), {
    code: "plain_data_array_shape_refused"
  });
});
test("EBPR-005 sources-sparse-array", () => {
  assert.throws(() => snapshotExactBindingAssessmentRequest(graphRequest(new Array(1))), {
    code: "plain_data_array_shape_refused"
  });
});
test("EBPR-005 sources-symbol-function-bigint", () => {
  for (const mutate of [
    (request) => { request[Symbol("secret")] = "value"; },
    (request) => { request.callback = () => {}; },
    (request) => { request.callback = Symbol("value"); },
    (request) => { request.callback = 1n; }
  ]) {
    const request = baseRequest();
    mutate(request);
    assert.throws(() => snapshotExactBindingAssessmentRequest(request));
  }
});
test("EBPR-005 sources-cycle", () => {
  const request = baseRequest();
  request.loop = request;
  assert.throws(() => snapshotExactBindingAssessmentRequest(request), {
    code: "plain_data_cycle_refused"
  });
});
test("EBPR-005 sources-validate-then-mutate", () => {
  const request = baseRequest();
  const snapshot = snapshotExactBindingAssessmentRequest(request);
  request.exactBindingSources["baseline-artifact"].relative_path = "changed.bin";
  assert.equal(snapshot.exactBindingSources["baseline-artifact"].relative_path,
    "baseline.bin");
  assert.equal(Object.isFrozen(snapshot.exactBindingSources["baseline-artifact"]), true);
});
test("EBPR-005 sources-single-snapshot", () => {
  const snapshot = snapshotExactBindingAssessmentRequest(baseRequest());
  assert.equal(assertBoundaryRequest(snapshot), snapshot);
  assert.equal(assertBoundaryRequest(snapshot).exactBindingSources,
    snapshot.exactBindingSources);
  assert.throws(() => assertBoundaryRequest(baseRequest()), {
    code: "exact_binding_boundary_bypassed"
  });
});
test("EBPR-005 sources-proxy-detector-unavailable", () => {
  assert.throws(() => assertProxyDetectorAvailable({}), {
    code: "plain_data_proxy_detector_unavailable"
  });
});

test("snapshot encodings and capture results are order-stable", async () => {
  const graphA = { complete: true, subject_reference_id: "ref-graph",
    nodes: [{ reference_id: "ref-z" }, { reference_id: "ref-a" }],
    edges: [{ from_reference_id: "ref-z", to_reference_id: "ref-a" }] };
  const graphB = { ...graphA, nodes: [...graphA.nodes].reverse() };
  assert.equal(canonicalDigest(normalizeReachabilitySnapshot(graphA)),
    canonicalDigest(normalizeReachabilitySnapshot(graphB)));
  const mutationsA = { complete: true, subject_reference_id: "ref-execution",
    mutations: [
      { mutation_id: "z", operation: "write", target_reference_id: "ref-z",
        before_sha256: d("1"), after_sha256: d("2") },
      { mutation_id: "a", operation: "delete", target_reference_id: "ref-a",
        before_sha256: d("3") }
    ] };
  const mutationsB = { ...mutationsA, mutations: [...mutationsA.mutations].reverse() };
  assert.equal(canonicalDigest(normalizeMutationSnapshot(mutationsA)),
    canonicalDigest(normalizeMutationSnapshot(mutationsB)));
  const unicodeA = { complete: true, subject_reference_id: "ref-é",
    nodes: [{ reference_id: "ref-é" }], edges: [] };
  const unicodeB = { complete: true, subject_reference_id: "ref-e\u0301",
    nodes: [{ reference_id: "ref-e\u0301" }], edges: [] };
  assert.equal(canonicalDigest(normalizeReachabilitySnapshot(unicodeA)),
    canonicalDigest(normalizeReachabilitySnapshot(unicodeB)));

  const root = await mkdtemp(path.join(os.tmpdir(), "eb-determinism-"));
  await writeFile(path.join(root, "baseline.bin"), "same");
  await writeFile(path.join(root, "candidate.bin"), "same");
  const request = snapshotExactBindingAssessmentRequest(baseRequest());
  const pinned = await PinnedCaptureRoot.open(root);
  const run = () => captureAndEvaluateExactBindingsV1({
    request, declaration, evaluationInput, context, pinnedRoot: pinned
  });
  const first = await run();
  const second = await run();
  assert.deepEqual(first, second);
  assert.equal(first.satisfaction, "satisfied");
  assert.equal(first.provenance.kind, "local_deterministic_capture");
  await pinned.close();
});

test("symlinks and special files fail closed without verified provenance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "eb-symlink-"));
  await writeFile(path.join(root, "outside.bin"), "outside");
  await symlink("outside.bin", path.join(root, "baseline.bin"));
  await writeFile(path.join(root, "candidate.bin"), "outside");
  const request = snapshotExactBindingAssessmentRequest(baseRequest());
  const pinned = await PinnedCaptureRoot.open(root);
  const result = await captureAndEvaluateExactBindingsV1({
    request, declaration, evaluationInput, context, pinnedRoot: pinned
  });
  assert.equal(result.satisfaction, "invalid");
  assert.equal(result.provenance.capture_verified, false);
  await pinned.close();
});

test("atomic loader returns the exact frozen certification object it digested", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "eb-loader-"));
  const { profile } = await createAdmissionPack(directory);
  const loaded = await loadExactBindingAdmissionV1(directory, profile.profile_id);
  const raw = await readFile(path.join(directory, "exact-binding-certification.json"));
  assert.equal(loaded.exact_binding_certification_digest, sha256(raw));
  assert.equal(Object.isFrozen(loaded.certification), true);
  assert.deepEqual(assertCanonicalCertificationFile(raw), loaded.certification);
});

test("v2 admissions distinguish semantic controls from legacy generated corpora", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "eb-admission-method-"));
  try {
    const { admission } = await createAdmissionPack(directory);
    const validate = validators[
      "controlled-contract-admitted-proof-pack.v2.schema.json"
    ];
    const semantic = structuredClone(admission);
    semantic.certification.method = "executable_semantic_adequacy";
    semantic.certification.negative_fixture_count = 0;
    semantic.certification.coverage_witness_count = 0;
    assert.equal(validate(semantic), true);

    semantic.certification.negative_fixture_count = 1;
    assert.equal(validate(semantic), false);

    const legacy = structuredClone(admission);
    legacy.certification.method = "executable_adequacy_full_negative_corpus";
    legacy.certification.negative_fixture_count = 0;
    legacy.certification.coverage_witness_count = 0;
    assert.equal(validate(legacy), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("separate assessment entrypoint snapshots once and captures internally", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "eb-assessment-"));
  const packDirectory = path.join(parent, "pack");
  const captureRoot = path.join(parent, "capture");
  await mkdir(captureRoot);
  const fixture = await createAdmissionPack(packDirectory);
  await writeFile(path.join(captureRoot, "contract.json"), "{}\n");
  await writeFile(path.join(captureRoot, "evaluation.json"), JSON.stringify({
    reference_bindings: [{ role: "artifact_subject", reference_ids: ["ref-artifact"] }]
  }));
  await writeFile(path.join(captureRoot, "artifact.bin"), "captured");
  const request = {
    contractPath: "contract.json",
    evaluationInputPath: "evaluation.json",
    profileId: fixture.profile.profile_id,
    exactBindingSources: {
      artifact: { kind: "artifact_file", relative_path: "artifact.bin" }
    }
  };
  const pending = assessExactBindingFilesV1(request, {
    captureRoot,
    packDirectory,
    vocabularyIdentity: { version: "0.34.0", complete_digest: d("a") }
  });
  request.exactBindingSources.artifact.relative_path = "missing.bin";
  const result = await pending;
  assert.equal(result.satisfaction, "satisfied");
  assert.equal(result.provenance.capture_verified, true);
});
