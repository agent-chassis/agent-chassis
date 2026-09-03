

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile
} from "node:fs/promises";
import { rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  COMMON_PROOF_CAPTURE_CURRENTNESS_RESULTS,
  COMMON_PROOF_CAPTURE_FAMILIES,
  COMMON_PROOF_CAPTURE_FAMILY_IDS,
  COMMON_PROOF_CAPTURE_LAUNCHER_FAMILY_IDS,
  COMMON_PROOF_CAPTURE_LAUNCHER_READ_ONLY_REASON,
  COMMON_PROOF_CAPTURE_LIFECYCLE_STATES,
  COMMON_PROOF_CAPTURE_REPOSITORY_FAMILY_IDS,
  COMMON_PROOF_CAPTURE_OBSERVATION_SCHEMA_VERSION,
  COMMON_PROOF_CAPTURE_REFUSAL_CODES,
  COMMON_PROOF_CAPTURE_REQUEST_KEYS,
  COMMON_PROOF_CAPTURE_SCHEMA_VERSION,
  COMMON_PROOF_CAPTURE_STORES,
  commonProofCaptureObservation,
  commonProofCaptureOperation,
  createCommonProofCaptureOperation
} from "@agent-chassis/wiki-core";
import {
  createCommonProofCaptureSelection,
  resolveAndPersistCommonProofCapture
} from "../../packages/wiki-core/src/lib/common-proof-capture-tools.mjs";
import {
  CONTROLLED_CONTRACT_MAX_JSON_BYTES,
  assertControlledContractCarrierExpectedDigest,
  controlledContractCarrierFilename,
  controlledContractPackCarrierFilename,
  resolveCanonicalControlledContractCarrierSet,
  resolveControlledContractTestProofRuntimeBindings
} from "../../packages/wiki-core/src/lib/controlled-contract-tools.mjs";
import {
  setCanonicalAuthoringPublisherHookForTest
} from "../../packages/wiki-core/src/lib/controlled-contract-carrier-set-tools.mjs";
import * as controlledContract from "@agent-chassis/controlled-contract";
import {
  baseLimits,
  buildBoundaryFixture
} from "../../packages/controlled-contract/test/proof-packs/bounded-policy-v1-fixture.mjs";

import { migrateControlledAcceptanceContractV02ToV1 } from
  "../../packages/controlled-contract/lib/stable-v1-migration.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CODES = COMMON_PROOF_CAPTURE_REFUSAL_CODES;
const digestOf = (text) =>
  `sha256:${createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex")}`;

const SLICE = Object.freeze({
  id: "SLICE-001",
  title: "capture fixture slice",
  work_kind: "implementation",
  status: "todo",
  priority: "medium",
  owner: "unassigned",
  depends_on: [],
  read_scope: [],
  docs: [],
  repo_paths: [],
  write_scope: [],
  dispatch_intent: {
    intended_agent_role: "worker", target_unit: "slice",
    requires_graph_impact: false, requires_escalation: false
  },
  acceptance: { criteria: ["fixture"], validation: ["fixture"] }
});

async function canonicalFixture(t) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "wk-2107-capture-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const contracts = path.join(repoRoot, "wiki", "contracts");
  await mkdir(contracts, { recursive: true });
  await mkdir(path.join(repoRoot, "wiki", "work-records"), { recursive: true });
  for (const relative of [
    "wiki/work-records/WK-2092.json",
    "wiki/contracts/WK-2092.controlled-acceptance.json",
    "wiki/contracts/WK-2092.proof-plan-request.json",
    "wiki/contracts/WK-2092.evaluation-input.json"
  ]) await copyFile(path.join(ROOT, relative), path.join(repoRoot, relative));

  const recordPath = path.join(repoRoot, "wiki/work-records/WK-2092.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  record.acceptance.validation = [];
  record.slices = [structuredClone(SLICE)];
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);

  const requestPath = path.join(contracts, "WK-2092.proof-plan-request.json");
  const request = JSON.parse(await readFile(requestPath, "utf8"));
  request.selected_packs = request.selected_packs.slice(0, 1);
  request.requested_intents = ["controlled-proof-intent.atomic-failure-boundary"];
  await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`);
  return { repoRoot, contracts, wkId: "WK-2092", unit: "WK-2092#SLICE-001" };
}

async function withBoundarySlots(setup, { policy, observation, subjects, limits } = {}) {
  const base = buildBoundaryFixture(limits === undefined ? {} : { limits });

  const directory = setup.contracts;
  for (const [suffix, bytes] of [
    ["declared-boundary-policy.json", policy ?? base.policyBytes],
    ["declared-boundary-observations.json", observation ?? base.observationBytes],
    ["declared-boundary-subjects.json", subjects ?? base.subjectsBytes]
  ]) await writeFile(path.join(directory, `${setup.wkId}.${suffix}`), bytes);
  return base;
}

const VARIED_BOUNDARY_LIMITS = Object.freeze(structuredClone(baseLimits).slice(0, 3));

async function treeSnapshot(root) {
  const files = [];
  const walk = async (dir, prefix) => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(full, relative);
      else files.push([relative, createHash("sha256")
        .update(await readFile(full)).digest("hex")]);
    }
  };
  await walk(root, "");
  return Object.fromEntries(files.sort(([left], [right]) => left.localeCompare(right)));
}

async function manifestState(setup) {
  const manifestPath = path.join(setup.contracts, `${setup.wkId}.carrier-set-manifest.json`);
  const names = (await readdir(setup.contracts)).sort();
  let manifest = null;
  try {
    manifest = await readFile(manifestPath, "utf8");
  } catch { manifest = null; }
  let generations = [];
  if (names.includes(".carrier-generations")) {
    generations = (await readdir(path.join(setup.contracts, ".carrier-generations"))).sort();
  }
  return { manifest, generations, staging: names.filter((n) => n.startsWith(".carrier-set-")) };
}

async function assertNoPartialWrite(setup, before) {
  const after = await manifestState(setup);
  assert.equal(after.manifest, before.manifest, "visible manifest moved");
  assert.deepEqual(after.generations, before.generations, "generation population moved");
  assert.deepEqual(after.staging, [], "a staging or temporary manifest artifact survived");
}

function writeConfinementEvidence(overrides = {}) {
  return {
    schema_version: "workspace-agent-write-confinement-evidence.v1",
    authority: "authenticated_observation_only",
    observation_boundary: "base_to_delivery_tree_delta",
    not_covered: ["transient_worktree_state", "causal_attribution"],
    repository: "/srv/agent-chassis",
    run_id: "wkdb_6a3c707d1f9b4999",
    attempt: 0,
    record_id: "WK-2092",
    unit_address: "WK-2092#SLICE-001",
    selected_unit: {
      kind: "slice", address: "WK-2092#SLICE-001", record_id: "WK-2092",
      slice_id: "SLICE-001", repo: null
    },
    frozen_write_scope: ["src"],
    base_commit: "b".repeat(40),
    delivery_commit: "c".repeat(40),
    delivery_tree: "d".repeat(40),
    contained: true,
    changed_paths: ["src/a.mjs", "src/b.mjs"],
    outside_write_scope_paths: [],
    inside_write_scope_paths: ["src/a.mjs", "src/b.mjs"],
    changed_path_count: 2,
    outside_write_scope_path_count: 0,
    inside_write_scope_path_count: 2,
    populations_complete: true,
    source_digest: `sha256:${"a".repeat(64)}`,
    result_digest: `sha256:${"e".repeat(64)}`,
    observed_at: "2026-08-18T09:15:22.481Z",
    admission_effect: "none",
    review_effect: "none",
    integration_effect: "none",
    publication_effect: "none",
    closure_effect: "none",
    proof_pack_applicability: "none",
    cce_effect: "none",
    semantic_judgment: "not_performed_coordinator_owned",
    ...overrides
  };
}

function writeConfinementProjection(evidenceOverrides = {}, envelopeOverrides = {}) {
  const evidence = writeConfinementEvidence(evidenceOverrides);
  return {
    schema_version: "workspace-agent-write-confinement-evidence.v1",
    projected: true,
    evidence,
    evidence_digest: digestOf(JSON.stringify(evidence)),
    state_changed: false,
    authority: "authenticated_observation_only",
    refusal: null,
    ...envelopeOverrides
  };
}

const OBSERVABLES = Object.freeze([
  { observable_id: "id", observable_type: "string", canonical_value: "p-1" },
  { observable_id: "total", observable_type: "decimal", canonical_value: "42" }
]);

function observableReportBytes(observables = OBSERVABLES) {
  return JSON.stringify({
    schema_version: controlledContract.BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION,
    observables: structuredClone(observables),
    observable_count: observables.length,
    selected_observable_id: "total"
  });
}

function pairSide(position) {
  return {
    position,
    run_id: `run-${position}`,
    attempt: 1,
    source_snapshot_digest: digestOf(`snapshot-${position}`),
    test_id: `sha256:${"1".repeat(64)}`,
    command_target: "tests/x.test.mjs",
    evidence_id: `test-proof-evidence-${position}`,
    evidence_digest: digestOf(`evidence-${position}`),
    inventory_change_count: 0,
    artifacts: []
  };
}

function pairReceipt({ sides = null, overrides = {} } = {}) {
  const body = {
    schema_version: "workspace-agent-behavioral-preservation-pair-evidence.v1",
    authority: "advisory_paired_evidence_facts",
    repository: "/srv/agent-chassis",
    shared_invariants: {
      wk_id: "WK-2092",
      selected_unit: "WK-2092#SLICE-001",
      controlled_contract_generation: digestOf("generation"),
      verification_id: "claim-x",
      command_id: "command-abc"
    },
    sides: sides ?? [pairSide("baseline"), pairSide("candidate")]
  };
  const pairEvidence = { ...body, pair_identity: { pair_id: "pair-one" } };
  const bodyBytes = JSON.stringify(pairEvidence);
  return {
    schema_version: "workspace-agent-behavioral-preservation-pair-receipt.v1",
    pair_id: "pair-one",
    pair_evidence: pairEvidence,
    body_bytes: bodyBytes,
    body_digest: digestOf(bodyBytes),
    produced_at: "2026-08-18T09:15:22.481Z",
    produced_by: "launcher",
    semantic_judgment: "not_performed_coordinator_owned",
    advisory: true,
    admission_effect: "none",
    review_effect: "none",
    integration_effect: "none",
    publication_effect: "none",
    proof_credit_effect: "none",
    applicability_effect: "none",
    behavioral_equivalence_effect: "none",
    business_semantic_effect: "none",
    policy_effect: "none",
    authority_effect: "none",
    ...overrides
  };
}

function behavioralResolver({ receipt = pairReceipt(), reportFor = null } = {}) {
  return async (identity) => {
    if (identity.artifact === "behavioral_preservation_pair_receipt") return receipt;
    if (identity.artifact === "behavioral_preservation_observable_report") {
      if (reportFor) return reportFor(identity);
      const side = receipt.pair_evidence.sides.find((s) => s.position === identity.side);
      const bytes = observableReportBytes();
      return {
        evidence_id: side.evidence_id,
        evidence_digest: side.evidence_digest,
        relative_path: `reports/${identity.side}-report.json`,
        report_bytes: bytes,
        report_digest: digestOf(bytes)
      };
    }
    return null;
  };
}

function spyCapabilities(calls, mutate = (surface) => surface) {
  return async () => {
    const surface = { ...controlledContract };
    for (const [name, value] of Object.entries(surface)) {
      if (typeof value !== "function") continue;
      surface[name] = (...args) => {
        calls.push({ name, args });
        return value(...args);
      };
    }
    return mutate(surface);
  };
}

function stepClock(onCall = () => {}) {
  let tick = 0;
  return () => {
    tick += 1;
    onCall(tick);
    return new Date(Date.UTC(2026, 7, 18, 0, 0, tick));
  };
}

function operationFor(setup, extra = {}) {
  return createCommonProofCaptureOperation({
    repositories: { fixture: setup.repoRoot },
    ...extra
  });
}

const WRITE_CONFINEMENT_REQUEST = Object.freeze({
  family: "write_confinement",
  profileId: controlledContract.WRITE_CONFINEMENT_PROFILE_ID,
  profileVersion: controlledContract.WRITE_CONFINEMENT_PROFILE_VERSION
});
const DECLARED_BOUNDARY_REQUEST = Object.freeze({
  family: "declared_boundary_consistency",
  profileId: controlledContract.DECLARED_BOUNDARY_PROFILE_ID,
  profileVersion: controlledContract.DECLARED_BOUNDARY_PROFILE_VERSION
});
const BEHAVIORAL_REQUEST = Object.freeze({
  family: "behavioral_preservation",
  profileId: controlledContract.BEHAVIORAL_PRESERVATION_PROFILE_ID,
  profileVersion: controlledContract.BEHAVIORAL_PRESERVATION_PROFILE_VERSION
});

function request(setup, overrides) {
  return { repository: "fixture", wkId: setup.wkId, unit: setup.unit, ...overrides };
}

async function refusal(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return assert.fail("expected a typed refusal");
}

test("the capture operation and its shared owners are public wiki-core exports",
  async () => {
    assert.equal(typeof createCommonProofCaptureOperation, "function");
    assert.equal(typeof commonProofCaptureOperation, "function");
    assert.equal(typeof commonProofCaptureObservation, "function");
    assert.equal(COMMON_PROOF_CAPTURE_SCHEMA_VERSION, "wiki-core-common-proof-capture.v1");
    assert.deepEqual([...COMMON_PROOF_CAPTURE_FAMILY_IDS], [
      "behavioral_preservation", "declared_boundary_consistency",
      "integration_prefix_safety", "test_verification_validity", "write_confinement"
    ]);

    assert.deepEqual([...COMMON_PROOF_CAPTURE_REPOSITORY_FAMILY_IDS],
      ["declared_boundary_consistency", "integration_prefix_safety"]);
    assert.deepEqual([...COMMON_PROOF_CAPTURE_LAUNCHER_FAMILY_IDS],
      ["behavioral_preservation", "test_verification_validity", "write_confinement"]);

    assert.deepEqual([...COMMON_PROOF_CAPTURE_REPOSITORY_FAMILY_IDS,
      ...COMMON_PROOF_CAPTURE_LAUNCHER_FAMILY_IDS].sort(),
    [...COMMON_PROOF_CAPTURE_FAMILY_IDS].sort());
    assert.deepEqual(COMMON_PROOF_CAPTURE_REPOSITORY_FAMILY_IDS.filter(
      (id) => COMMON_PROOF_CAPTURE_LAUNCHER_FAMILY_IDS.includes(id)), []);
    for (const id of COMMON_PROOF_CAPTURE_FAMILY_IDS) {
      const descriptor = COMMON_PROOF_CAPTURE_FAMILIES[id];
      const repositoryDerived = COMMON_PROOF_CAPTURE_REPOSITORY_FAMILY_IDS.includes(id);
      assert.equal(descriptor.evidence_store, repositoryDerived ? "repository" : "launcher", id);
      assert.equal(descriptor.launcher_derived, !repositoryDerived, id);
      assert.equal(descriptor.persists_canonical_carrier, repositoryDerived, id);
    }
    assert.equal(COMMON_PROOF_CAPTURE_LAUNCHER_READ_ONLY_REASON, "launcher_receipt_read_only");

    const surface = await import("@agent-chassis/wiki-core");
    assert.deepEqual(Object.keys(surface).filter((name) =>
      /^COMMON_PROOF_CAPTURE_(CURSOR|PAGE|CONTENT_REFERENCE)/u.test(name)), []);
  });

test("the public request surface is selector-only", async (t) => {
  const setup = await canonicalFixture(t);
  assert.deepEqual([...COMMON_PROOF_CAPTURE_REQUEST_KEYS], [
    "family", "focus", "profileId", "profileVersion", "repository", "unit",
    "verificationId", "wkId"
  ]);
  const operation = operationFor(setup, {
    resolveLauncherReceipt: async () => writeConfinementProjection()
  });

  for (const [field, value] of [
    ["repoRoot", setup.repoRoot],
    ["root", setup.repoRoot],
    ["contractsDir", setup.contracts],
    ["receipt", writeConfinementProjection()],
    ["evidence", writeConfinementEvidence()],
    ["policy", { limits: [] }],
    ["report", { observables: [] }],
    ["sourceBytes", "{}"],
    ["commit", "c".repeat(40)],
    ["baseCommit", "b".repeat(40)],
    ["continuation", `sha256:${"a".repeat(64)}`],
    ["executor", () => {}],
    ["resolveLauncherReceipt", async () => null],
    ["expectedContentDigest", `sha256:${"a".repeat(64)}`],
    ["expected_manifest_digest", `sha256:${"a".repeat(64)}`],
    ["canonicalMembers", {}],
    ["pack", { profileId: "x", profileVersion: "1.0.0" }]
  ]) {
    const error = await refusal(operation(
      request(setup, { ...WRITE_CONFINEMENT_REQUEST, [field]: value })));
    assert.equal(error.code, "controlled_contract_request_field_forbidden", field);
    assert.deepEqual(error.details.fields, [field], field);
  }
});

test("the repository root is a private construction dependency, never a selector",
  async (t) => {
    const setup = await canonicalFixture(t);
    const operation = operationFor(setup);

    const unknown = await refusal(operation(
      request(setup, { ...DECLARED_BOUNDARY_REQUEST, repository: "somewhere-else" })));
    assert.equal(unknown.code, "common_proof_capture_repository_alias_unresolved");
    assert.equal(unknown.details.repository, "somewhere-else");

    const unbound = await refusal(commonProofCaptureOperation(
      request(setup, DECLARED_BOUNDARY_REQUEST)));
    assert.equal(unbound.code, "common_proof_capture_repository_alias_unresolved");

    const other = createCommonProofCaptureOperation({ repositories: { other: setup.repoRoot } });
    const wrongAlias = await refusal(other(request(setup, DECLARED_BOUNDARY_REQUEST)));
    assert.equal(wrongAlias.code, "common_proof_capture_repository_alias_unresolved");
  });

test("the shared resolver accepts only server-minted selections and dependencies",
  async (t) => {
    const setup = await canonicalFixture(t);
    const dependencies = { resolveLauncherReceipt: null, loadPackageCapabilities: async () => ({}),
      now: () => new Date() };
    const forged = {
      schema_version: "wiki-core-common-proof-capture-selection.v1",
      repository_alias: "fixture", repoRoot: setup.repoRoot, wkId: setup.wkId,
      unitAddress: setup.unit, focus: null, family: "declared_boundary_consistency",
      profileId: DECLARED_BOUNDARY_REQUEST.profileId,
      profileVersion: DECLARED_BOUNDARY_REQUEST.profileVersion, verificationId: null
    };
    const untrustedSelection = await refusal(
      resolveAndPersistCommonProofCapture({ selection: forged, dependencies }));
    assert.equal(untrustedSelection.code, CODES.SELECTION_UNTRUSTED);

    const selection = createCommonProofCaptureSelection({
      repositoryAlias: "fixture", repoRoot: setup.repoRoot, wkId: setup.wkId,
      unitAddress: setup.unit, family: "declared_boundary_consistency",
      profileId: DECLARED_BOUNDARY_REQUEST.profileId,
      profileVersion: DECLARED_BOUNDARY_REQUEST.profileVersion
    });
    const untrustedDeps = await refusal(
      resolveAndPersistCommonProofCapture({ selection, dependencies }));
    assert.equal(untrustedDeps.code, CODES.DEPENDENCIES_UNTRUSTED);
  });

test("canonical selection refuses an unsupported family, unit, or focus", async (t) => {
  const setup = await canonicalFixture(t);
  const operation = operationFor(setup);
  const badFamily = await refusal(operation(
    request(setup, { ...DECLARED_BOUNDARY_REQUEST, family: "made_up_family" })));
  assert.equal(badFamily.code, CODES.FAMILY_UNSUPPORTED);
  assert.deepEqual(badFamily.details.supported, [...COMMON_PROOF_CAPTURE_FAMILY_IDS]);

  const crossWk = await refusal(operation(
    request(setup, { ...DECLARED_BOUNDARY_REQUEST, unit: "WK-9999#SLICE-001" })));
  assert.equal(crossWk.code, CODES.UNIT_UNRESOLVED);

  const missingSlice = await refusal(operation(
    request(setup, { ...DECLARED_BOUNDARY_REQUEST, unit: "WK-2092#SLICE-404" })));
  assert.equal(missingSlice.code, CODES.UNIT_UNRESOLVED);
  const badFocus = await refusal(operation(
    request(setup, { ...DECLARED_BOUNDARY_REQUEST, focus: "WK-0001" })));
  assert.equal(badFocus.code, "controlled_contract_focus_identity_invalid");
});

test("declared-boundary capture delegates to the package mapper and persists", async (t) => {
  const setup = await canonicalFixture(t);
  const fixtureCorpus = await withBoundarySlots(setup);
  const calls = [];
  const operation = operationFor(setup, {
    loadPackageCapabilities: spyCapabilities(calls),
    now: stepClock()
  });
  const result = await operation(request(setup, DECLARED_BOUNDARY_REQUEST));

  assert.equal(result.schema_version, COMMON_PROOF_CAPTURE_SCHEMA_VERSION);
  assert.equal(result.family, "declared_boundary_consistency");
  assert.equal(result.launcher_derived, false);
  assert.equal(result.unit, setup.unit);
  assert.equal(result.unit_kind, "slice");

  const mapperCalls = calls.filter(({ name }) => name === "mapDeclaredBoundaryCapture");
  assert.equal(mapperCalls.length, 1);
  assert.equal(mapperCalls[0].args.length, 1);
  assert.deepEqual(Object.keys(mapperCalls[0].args[0]).sort(), ["capture"]);
  const capture = mapperCalls[0].args[0].capture;
  assert.deepEqual(Object.keys(capture).sort(),
    ["observation", "policy", "report", "schema_version", "subjects"]);

  assert.equal(capture.observation.record_id, `${setup.unit}/boundary-observation-record`);
  assert.ok(capture.policy.bytes.equals(fixtureCorpus.policyBytes));
  assert.ok(capture.subjects.bytes.equals(fixtureCorpus.subjectsBytes));

  const owned = await controlledContract.mapDeclaredBoundaryCapture({ capture });
  assert.equal(result.capture.report_bytes_sha256, owned.source.report_bytes_sha256);
  assert.equal(result.capture.declared_limit_count, owned.source.declared_limit_count);
  assert.equal(result.capture.measured_subject_count, owned.source.measured_subject_count);

  const published = await resolveCanonicalControlledContractCarrierSet({
    repoRoot: setup.repoRoot, wkId: setup.wkId
  });
  assert.equal(published.source, "manifest");
  assert.equal(published.generation, result.capture.generation);
  const target = controlledContractPackCarrierFilename({
    wkId: setup.wkId,
    profileId: DECLARED_BOUNDARY_REQUEST.profileId,
    profileVersion: DECLARED_BOUNDARY_REQUEST.profileVersion
  });
  assert.equal(result.capture.target_filename, target);
  assert.deepEqual(published.members_by_basename[target].content, owned.evaluation_input);
  for (const carrierKind of ["contract", "proof_plan_request"]) {
    const name = controlledContractCarrierFilename({ wkId: setup.wkId, carrierKind });
    assert.ok(Object.hasOwn(published.members_by_basename, name), name);
  }
});

test("an incomplete canonical boundary population refuses without writing", async (t) => {
  const setup = await canonicalFixture(t);
  const base = buildBoundaryFixture();

  await writeFile(path.join(setup.contracts, `${setup.wkId}.declared-boundary-policy.json`),
    base.policyBytes);
  await writeFile(path.join(setup.contracts, `${setup.wkId}.declared-boundary-subjects.json`),
    base.subjectsBytes);
  const before = await manifestState(setup);
  const error = await refusal(operationFor(setup)(request(setup, DECLARED_BOUNDARY_REQUEST)));
  assert.equal(error.code, CODES.CANONICAL_POPULATION_INCOMPLETE);
  assert.deepEqual(error.details.missing_basenames,
    [`${setup.wkId}.declared-boundary-observations.json`]);
  await assertNoPartialWrite(setup, before);
});

test("a package mapper refusal is a typed no-state-changed outcome", async (t) => {
  const setup = await canonicalFixture(t);

  const base = buildBoundaryFixture();
  const corrupt = structuredClone(base.policy);
  corrupt.limits = [];
  await withBoundarySlots(setup, {
    policy: Buffer.from(`${JSON.stringify(corrupt)}\n`, "utf8")
  });
  const before = await manifestState(setup);
  const error = await refusal(operationFor(setup)(request(setup, DECLARED_BOUNDARY_REQUEST)));
  assert.equal(error.code, CODES.PACKAGE_MAPPER_REFUSED);
  assert.equal(typeof error.details.refusal_code, "string");
  await assertNoPartialWrite(setup, before);
});

test("write-confinement maps the authenticated projection and publishes nothing",
  async (t) => {
    const setup = await canonicalFixture(t);
    const before = await treeSnapshot(setup.repoRoot);
    const calls = [];
    const identities = [];
    const projection = writeConfinementProjection();
    const operation = operationFor(setup, {
      loadPackageCapabilities: spyCapabilities(calls),
      resolveLauncherReceipt: async (identity) => {
        identities.push(identity);
        return projection;
      },
      now: stepClock()
    });
    const result = await operation(request(setup, WRITE_CONFINEMENT_REQUEST));

    assert.equal(identities.length, 1);
    assert.deepEqual(Object.keys(identities[0]).sort(), [
      "artifact", "family", "focus", "profile_id", "profile_version", "repository_alias",
      "schema_version", "side", "unit_address", "verification_id", "wk_id"
    ]);
    assert.equal(identities[0].repository_alias, "fixture");
    assert.equal(identities[0].unit_address, setup.unit);
    assert.equal(identities[0].artifact, "write_confinement_evidence_projection");

    const mapperCalls = calls.filter(({ name }) => name === "mapWriteConfinementCapture");
    assert.equal(mapperCalls.length, 1);
    assert.deepEqual(mapperCalls[0].args[0], { projection });
    assert.equal(mapperCalls[0].args[0].projection, projection);

    assert.equal(result.launcher_derived, true);
    assert.equal(result.evidence_store, "launcher");
    assert.equal(result.launcher_store_mutated, false);
    assert.equal(result.capture.run_id, projection.evidence.run_id);
    assert.equal(result.capture.evidence_digest, projection.evidence_digest);

    assert.equal(result.capture.receipt_identity,
      `write_confinement_evidence:${projection.evidence.run_id}:${projection.evidence.attempt}`);

    const owned = await controlledContract.mapWriteConfinementCapture({ projection });
    assert.deepEqual(result.mapping.evaluation_input, owned.evaluation_input);
    assert.deepEqual(result.mapping.references, owned.references);
    assert.equal(result.mapping.durable, false);
    assert.equal(result.mapping.persisted, false);

    assert.equal(result.persisted, false);
    assert.equal(result.repository_store_mutated, false);
    assert.equal(result.capture.persisted, false);
    assert.equal(result.capture.persistence_skipped_reason,
      COMMON_PROOF_CAPTURE_LAUNCHER_READ_ONLY_REASON);
    assert.equal(Object.hasOwn(result.capture, "generation"), false);
    assert.equal(Object.hasOwn(result.capture, "target_filename"), false);

    assert.deepEqual(await treeSnapshot(setup.repoRoot), before);
  });

test("every launcher-derived family is read-only and leaves the repository untouched",
  async (t) => {
    const setup = await canonicalFixture(t);

    await withBoundarySlots(setup);
    const seeded = await operationFor(setup)(request(setup, DECLARED_BOUNDARY_REQUEST));
    assert.equal(seeded.persisted, true);
    const before = await treeSnapshot(setup.repoRoot);

    const validity = await testValidityFixture(t);
    const runs = [
      ["write_confinement", operationFor(setup, {
        resolveLauncherReceipt: async () => writeConfinementProjection(), now: stepClock()
      }), request(setup, WRITE_CONFINEMENT_REQUEST), setup.repoRoot],
      ["behavioral_preservation", operationFor(setup, {
        resolveLauncherReceipt: behavioralResolver(), now: stepClock()
      }), request(setup, BEHAVIORAL_REQUEST), setup.repoRoot],
      ["test_verification_validity", createCommonProofCaptureOperation({
        repositories: { fixture: validity.repoRoot },
        resolveLauncherReceipt: async () => testProofReceipt(validity),
        now: stepClock()
      }), {
        repository: "fixture", wkId: validity.wkId, unit: validity.unit,
        family: "test_verification_validity", verificationId: validity.verificationId,
        profileId: validity.profile.profileId, profileVersion: validity.profile.profileVersion
      }, validity.repoRoot]
    ];
    const validityBefore = await treeSnapshot(validity.repoRoot);
    for (const [family, operation, payload] of runs) {
      const result = await operation(payload);
      assert.equal(result.family, family);
      assert.equal(result.evidence_store, "launcher", family);
      assert.equal(result.persisted, false, family);
      assert.equal(result.repository_store_mutated, false, family);
      assert.equal(result.launcher_store_mutated, false, family);
      assert.equal(result.capture.persisted, false, family);
      assert.equal(result.capture.persistence_skipped_reason,
        COMMON_PROOF_CAPTURE_LAUNCHER_READ_ONLY_REASON, family);

      assert.equal(Object.hasOwn(result.capture, "generation"), false, family);
      assert.equal(Object.hasOwn(result.capture, "target_filename"), false, family);
      assert.equal(typeof result.capture.receipt_identity, "string", family);
    }
    assert.deepEqual(await treeSnapshot(setup.repoRoot), before);
    assert.deepEqual(await treeSnapshot(validity.repoRoot), validityBefore);
  });

test("containment is the launcher owner's decision and refuses before any write",
  async (t) => {
    const setup = await canonicalFixture(t);
    const before = await manifestState(setup);
    const operation = operationFor(setup, {
      resolveLauncherReceipt: async () => writeConfinementProjection({
        contained: false,
        changed_paths: ["src/a.mjs", "docs/x.md"],
        outside_write_scope_paths: ["docs/x.md"],
        inside_write_scope_paths: ["src/a.mjs"],
        outside_write_scope_path_count: 1,
        inside_write_scope_path_count: 1
      })
    });
    const error = await refusal(operation(request(setup, WRITE_CONFINEMENT_REQUEST)));
    assert.equal(error.code, CODES.CONTAINMENT_FAILED);
    assert.equal(error.details.outside_write_scope_path_count, 1);
    await assertNoPartialWrite(setup, before);
  });

test("launcher receipts bound to another identity, or unauthenticated, are refused",
  async (t) => {
    const setup = await canonicalFixture(t);
    const before = await manifestState(setup);
    const cases = [
      [{ record_id: "WK-3333", unit_address: "WK-3333#SLICE-001" }, {},
        CODES.RECEIPT_IDENTITY_MISMATCH],
      [{ unit_address: "WK-2092#SLICE-002" }, {}, CODES.RECEIPT_IDENTITY_MISMATCH],
      [{}, { evidence_digest: "not-a-digest" }, CODES.RECEIPT_UNAUTHENTICATED],
      [{}, { authority: "caller_asserted" }, CODES.RECEIPT_UNAUTHENTICATED],
      [{}, { refusal: { code: "write_confinement_evidence.unavailable.v1" } },
        CODES.RECEIPT_UNAVAILABLE],
      [{}, { evidence: undefined }, CODES.LAUNCHER_PROJECTION_INCOMPLETE]
    ];
    for (const [evidenceOverrides, envelopeOverrides, code] of cases) {
      const operation = operationFor(setup, {
        resolveLauncherReceipt: async () =>
          writeConfinementProjection(evidenceOverrides, envelopeOverrides)
      });
      const error = await refusal(operation(request(setup, WRITE_CONFINEMENT_REQUEST)));
      assert.equal(error.code, code, JSON.stringify({ evidenceOverrides, envelopeOverrides }));
    }

    for (const [resolver, code] of [
      [async () => null, CODES.RECEIPT_ABSENT],
      [async () => "not-an-object", CODES.RECEIPT_CORRUPT],
      [async () => { throw Object.assign(new Error("gone"), { code: "receipt_gone" }); },
        "receipt_gone"]
    ]) {
      const error = await refusal(operationFor(setup, { resolveLauncherReceipt: resolver })(
        request(setup, WRITE_CONFINEMENT_REQUEST)));
      assert.equal(error.code, code);
    }
    await assertNoPartialWrite(setup, before);
  });

test("an unbound launcher resolver is a required-prerequisite refusal, not a search",
  async (t) => {
    const setup = await canonicalFixture(t);
    await withBoundarySlots(setup);
    const before = await manifestState(setup);
    const operation = operationFor(setup);
    for (const overrides of [WRITE_CONFINEMENT_REQUEST, BEHAVIORAL_REQUEST]) {
      const error = await refusal(operation(request(setup, overrides)));
      assert.equal(error.code, CODES.LAUNCHER_RESOLVER_UNAVAILABLE);
      assert.equal(error.details.required_prerequisite, "launcher_receipt_resolver");
      assert.equal(error.details.family, overrides.family);
    }
    await assertNoPartialWrite(setup, before);

    const ok = await operation(request(setup, DECLARED_BOUNDARY_REQUEST));
    assert.equal(ok.family, "declared_boundary_consistency");
  });

test("closed launcher-store failures retain distinct top-level public refusal codes",
  async (t) => {
    const setup = await canonicalFixture(t);
    const cases = [
      ["common_proof_receipt_unavailable", CODES.RECEIPT_UNAVAILABLE],
      ["common_proof_receipt_absent", CODES.RECEIPT_ABSENT],
      ["common_proof_receipt_conflict", CODES.RECEIPT_CONFLICT],
      ["common_proof_receipt_stale", CODES.RECEIPT_STALE],
      ["common_proof_receipt_corrupt", CODES.RECEIPT_CORRUPT],
      ["common_proof_receipt_layout_unsupported", CODES.RECEIPT_LAYOUT_UNSUPPORTED],
      ["common_proof_receipt_selector_mismatch", CODES.RECEIPT_SELECTOR_MISMATCH],
      ["common_proof_receipt_return_overflow", CODES.RECEIPT_OVER_BOUND],
      ["common_proof_receipt_incomplete_behavioral_group",
        CODES.BEHAVIORAL_GROUP_INCOMPLETE],
      ["common_proof_resolver_capability_failed", CODES.LAUNCHER_CAPABILITY_FAILED]
    ];
    for (const [launcherCode, publicCode] of cases) {
      const operation = operationFor(setup, {
        resolveLauncherReceipt: async () => {
          throw Object.assign(new Error(launcherCode), { code: launcherCode });
        }
      });
      const error = await refusal(operation(request(setup, WRITE_CONFINEMENT_REQUEST)));
      assert.equal(error.code, publicCode, launcherCode);
      assert.equal(Object.hasOwn(error.details, "cause_code"), false,
        "closed failures are top-level codes, not generic refusals with causes");
    }
  });

test("a missing required exported package capability refuses by name", async (t) => {
  const setup = await canonicalFixture(t);
  const before = await manifestState(setup);
  const operation = operationFor(setup, {
    resolveLauncherReceipt: async () => writeConfinementProjection(),
    loadPackageCapabilities: spyCapabilities([], (surface) => {
      delete surface.mapWriteConfinementCapture;
      return surface;
    })
  });
  const error = await refusal(operation(request(setup, WRITE_CONFINEMENT_REQUEST)));
  assert.equal(error.code, CODES.PACKAGE_CAPABILITY_MISSING);
  assert.deepEqual(error.details.missing_capabilities, ["mapWriteConfinementCapture"]);
  assert.equal(error.details.family, "write_confinement");
  await assertNoPartialWrite(setup, before);
});

test("the selected profile must be the identity this family's owner is written for",
  async (t) => {
    const setup = await canonicalFixture(t);
    await withBoundarySlots(setup);
    const before = await manifestState(setup);
    for (const overrides of [
      { ...DECLARED_BOUNDARY_REQUEST, profileVersion: "9.9.9" },
      { ...DECLARED_BOUNDARY_REQUEST, profileId: "proof.scope.write-confinement" }
    ]) {
      const error = await refusal(operationFor(setup)(request(setup, overrides)));
      assert.equal(error.code, CODES.PROFILE_INCOMPATIBLE);
      assert.equal(error.details.owner_profile_id,
        controlledContract.DECLARED_BOUNDARY_PROFILE_ID);
    }
    await assertNoPartialWrite(setup, before);
  });

test("behavioral-preservation capture consumes the ordered pair and its side reports",
  async (t) => {
    const setup = await canonicalFixture(t);
    const calls = [];
    const identities = [];
    const receipt = pairReceipt();
    const resolve = behavioralResolver({ receipt });
    const operation = operationFor(setup, {
      loadPackageCapabilities: spyCapabilities(calls),
      resolveLauncherReceipt: async (identity) => {
        identities.push(identity);
        return resolve(identity);
      },
      now: stepClock()
    });
    const result = await operation(request(setup, BEHAVIORAL_REQUEST));

    assert.deepEqual(identities.map(({ artifact, side }) => `${artifact}:${side}`), [
      "behavioral_preservation_pair_receipt:null",
      "behavioral_preservation_observable_report:baseline",
      "behavioral_preservation_observable_report:candidate"
    ]);
    const mapperCalls = calls.filter(({ name }) => name === "mapBehavioralPreservationCapture");
    assert.equal(mapperCalls.length, 1);
    const capture = mapperCalls[0].args[0].capture;
    assert.deepEqual(Object.keys(capture).sort(),
      ["baseline", "candidate", "pair", "schema_version"]);

    assert.deepEqual(capture.pair,
      { pair_id: receipt.pair_id, pair_digest: receipt.body_digest });
    for (const position of controlledContract.BEHAVIORAL_PRESERVATION_SIDES) {
      const side = receipt.pair_evidence.sides.find((s) => s.position === position);
      assert.equal(capture[position].evidence_id, side.evidence_id);
      assert.equal(capture[position].evidence_digest, side.evidence_digest);
    }
    assert.equal(result.capture.pair_id, receipt.pair_id);
    assert.equal(result.capture.member_count, OBSERVABLES.length);
    assert.equal(result.capture.selected_observable_id, "total");
    assert.equal(result.capture.receipt_identity,
      `behavioral_preservation_pair:${receipt.pair_id}`);

    const owned = await controlledContract.mapBehavioralPreservationCapture({ capture });
    assert.equal(owned.mapped, true);
    assert.deepEqual(result.mapping.evaluation_input, owned.evaluation_input);
    assert.deepEqual(result.mapping.references, owned.references);
    assert.equal(result.mapping.durable, false);
    assert.equal(result.persisted, false);
    assert.equal(result.repository_store_mutated, false);
    assert.equal(Object.hasOwn(result.capture, "generation"), false);
    assert.equal(Object.hasOwn(result.capture, "target_filename"), false);
  });

test("every launcher refusal leaves both stores exactly as they were", async (t) => {
  const setup = await canonicalFixture(t);

  await withBoundarySlots(setup);
  await operationFor(setup)(request(setup, DECLARED_BOUNDARY_REQUEST));
  const before = await treeSnapshot(setup.repoRoot);

  const refusals = [

    [WRITE_CONFINEMENT_REQUEST, async () => writeConfinementProjection({
      contained: false, outside_write_scope_paths: ["docs/x.md"],
      outside_write_scope_path_count: 1
    }), CODES.CONTAINMENT_FAILED],
    [WRITE_CONFINEMENT_REQUEST, async () => writeConfinementProjection(
      { record_id: "WK-3333", unit_address: "WK-3333#SLICE-001" }),
    CODES.RECEIPT_IDENTITY_MISMATCH],
    [WRITE_CONFINEMENT_REQUEST, async () => writeConfinementProjection({},
      { authority: "caller_asserted" }), CODES.RECEIPT_UNAUTHENTICATED],
    [WRITE_CONFINEMENT_REQUEST, async () => null, CODES.RECEIPT_ABSENT],

    [BEHAVIORAL_REQUEST, behavioralResolver({
      receipt: pairReceipt({ sides: [pairSide("baseline")] })
    }), CODES.BEHAVIORAL_PAIR_INCOMPLETE],
    [BEHAVIORAL_REQUEST, behavioralResolver({
      reportFor: (identity) => {
        const side = pairSide(identity.side);
        return { evidence_id: side.evidence_id, evidence_digest: side.evidence_digest,
          relative_path: "reports/x.json", report_bytes: observableReportBytes(),
          report_digest: digestOf("something-else") };
      }
    }), CODES.REPORT_BYTES_MISMATCH]
  ];
  for (const [overrides, resolver, code] of refusals) {
    const error = await refusal(operationFor(setup, { resolveLauncherReceipt: resolver })(
      request(setup, overrides)));
    assert.equal(error.code, code);

    assert.deepEqual(await treeSnapshot(setup.repoRoot), before, code);
  }
});

test("behavioral-preservation refuses an incomplete pair, a mismatched or corrupt report",
  async (t) => {
    const setup = await canonicalFixture(t);
    const before = await manifestState(setup);
    const oneSided = pairReceipt({ sides: [pairSide("baseline")] });
    const cases = [
      [behavioralResolver({ receipt: oneSided }), CODES.BEHAVIORAL_PAIR_INCOMPLETE],
      [behavioralResolver({ receipt: pairReceipt({ overrides: { advisory: false } }) }),
        CODES.RECEIPT_UNAUTHENTICATED],
      [behavioralResolver({ receipt: pairReceipt({ overrides: { body_bytes: "{}" } }) }),
        CODES.REPORT_BYTES_MISMATCH],
      [behavioralResolver({ receipt: pairReceipt({ overrides: { pair_evidence: {} } }) }),
        CODES.BEHAVIORAL_PAIR_INCOMPLETE],

      [behavioralResolver({
        reportFor: (identity) => {
          const side = pairSide(identity.side);
          return { evidence_id: side.evidence_id, evidence_digest: side.evidence_digest,
            relative_path: "reports/x.json", report_bytes: observableReportBytes(),
            report_digest: digestOf("something-else") };
        }
      }), CODES.REPORT_BYTES_MISMATCH],

      [behavioralResolver({
        reportFor: (identity) => {
          const bytes = observableReportBytes();
          return { evidence_id: "test-proof-evidence-elsewhere",
            evidence_digest: digestOf("elsewhere"), relative_path: "reports/x.json",
            report_bytes: bytes, report_digest: digestOf(bytes) };
        }
      }), CODES.RECEIPT_IDENTITY_MISMATCH],

      [behavioralResolver({
        reportFor: (identity) => {
          const side = pairSide(identity.side);
          return { evidence_id: side.evidence_id, evidence_digest: side.evidence_digest,
            relative_path: "reports/x.json", report_bytes: "not json",
            report_digest: digestOf("not json") };
        }
      }), CODES.RECEIPT_CORRUPT],

      [async (identity) => identity.artifact === "behavioral_preservation_pair_receipt"
        ? pairReceipt() : { relative_path: "reports/x.json" },
        CODES.LAUNCHER_PROJECTION_INCOMPLETE]
    ];
    for (const [resolver, code] of cases) {
      const error = await refusal(operationFor(setup, { resolveLauncherReceipt: resolver })(
        request(setup, BEHAVIORAL_REQUEST)));
      assert.equal(error.code, code);
    }

    const crossUnit = pairReceipt();
    crossUnit.pair_evidence.shared_invariants.selected_unit = "WK-2092#SLICE-009";
    const rebound = pairReceipt({ overrides: {
      pair_evidence: crossUnit.pair_evidence,
      body_bytes: JSON.stringify(crossUnit.pair_evidence),
      body_digest: digestOf(JSON.stringify(crossUnit.pair_evidence))
    } });
    const error = await refusal(operationFor(setup, {
      resolveLauncherReceipt: behavioralResolver({ receipt: rebound })
    })(request(setup, BEHAVIORAL_REQUEST)));
    assert.equal(error.code, CODES.RECEIPT_IDENTITY_MISMATCH);
    await assertNoPartialWrite(setup, before);
  });

function testProofBinding() {
  return {
    test_proof_id: "test-proof-suite-covers-component",
    verification_claim_id: "claim-suite-covers-component",
    system_under_test_boundary: { boundary_id: "sut-boundary-component", kind: "module",
      runtime_module_path: "packages/controlled-contract/lib/test-proof-contract.mjs",
      subject_reference_ids: ["ref-component"] },
    observable_result: { observable_id: "observable-component", kind: "return_value",
      proposition_id: "prop-suite-covers-component" },
    candidate_execution_provider: { provider_id: "launcher.node-test",
      provider_version: "1.0.0", capability: "candidate_execution" },
    falsifiers: [{ falsifier_id: "falsifier-component", strategy: "dependency_failure",
      proposition_id: "prop-component-absent", expected_outcome: "verification_fails",
      mutation: { mutation_id: "mutation-component", mechanism: "module_substitution",
        target_kind: "module",
        module_path: "packages/controlled-contract/lib/test-proof-contract.mjs" },
      execution_provider: { provider_id: "launcher.node-test-module-fault",
        provider_version: "1.0.0", capability: "falsifier_execution" } }],
    traversal_provider: { mode: "provider", provider_id: "launcher.node-test-v8-coverage",
      provider_version: "1.0.0", capability: "boundary_traversal", boundary_kind: "module",
      observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion",
      evidence_artifact_type: "boundary_trace" },
    coverage_disposition: { baseline_id: "coverage-baseline-component",
      baseline_state: "complete_executed_inventory",
      items: [{ test_id: "test-component", disposition: "preserved" }] },
    prohibited_shortcuts: ["source_text_inspection"]
  };
}

async function testValidityFixture(t) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "wk-2107-validity-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const contracts = path.join(repoRoot, "wiki", "contracts");
  await mkdir(contracts, { recursive: true });
  await mkdir(path.join(repoRoot, "wiki", "work-records"), { recursive: true });

  const [base, evaluationInput] = await Promise.all([
    readFile(path.join(ROOT,
      "packages/controlled-contract/examples/minimal-controlled-acceptance-contract-v034.json"),
    "utf8").then(JSON.parse),
    readFile(path.join(ROOT,
      "packages/controlled-contract/profiles/proof.verification.test-validity/2.0.0/evaluation-input.template.json"),
    "utf8").then(JSON.parse)
  ]);
  const binding = testProofBinding();
  evaluationInput.reference_bindings = [
    { role: "component", reference_ids: ["ref-component"] },
    { role: "suite", reference_ids: ["ref-suite"] }
  ];
  const validity = evaluationInput.stable_evaluation.test_validity[0];
  validity.verification_id = binding.verification_claim_id;
  validity.test_proof_id = binding.test_proof_id;
  validity.candidate_execution.observed_boundary_id =
    binding.system_under_test_boundary.boundary_id;
  validity.candidate_execution.observed_observable_id = binding.observable_result.observable_id;
  validity.boundary_traversal.boundary_id = binding.system_under_test_boundary.boundary_id;
  validity.boundary_traversal.observable_id = binding.observable_result.observable_id;
  validity.falsifier_executions[0].falsifier_id = binding.falsifiers[0].falsifier_id;
  validity.falsifier_executions[0].failure_proposition_id = binding.falsifiers[0].proposition_id;
  validity.falsifier_executions[0].mutation.mutation_id =
    binding.falsifiers[0].mutation.mutation_id;
  validity.falsifier_executions[0].mutation.target_verification_id =
    binding.verification_claim_id;
  for (const field of ["declared_test_ids", "baseline_executed_test_ids"]) {
    validity.test_inventory[field] = ["test-component"];
  }
  validity.test_inventory.observed_tests = [{ test_id: "test-component", status: "passed" }];

  const contract = migrateControlledAcceptanceContractV02ToV1({
    contract: base, testProofs: [binding]
  });
  const evaluationPath = "WK-2044.evaluation-input.json";
  const proofPlanRequest = {
    schema_version: "controlled-contract-proof-plan-request.v1",
    requested_intents: ["controlled-proof-intent.test-verification-validity"],
    selected_packs: [{ profile_id: "proof.verification.test-validity",
      profile_version: "2.0.0", evaluation_input_path: evaluationPath }]
  };
  const proofPlan = await controlledContract.buildProofPlan({
    contract, request: proofPlanRequest, evaluationInputs: { [evaluationPath]: evaluationInput }
  });
  for (const [carrierKind, content] of Object.entries({
    contract, evaluation_input: evaluationInput,
    proof_plan_request: proofPlanRequest, proof_plan: proofPlan
  })) await writeFile(path.join(contracts,
    controlledContractCarrierFilename({ wkId: "WK-2044", carrierKind })),
  `${JSON.stringify(content, null, 2)}\n`);

  const record = {
    schema_version: "work-record.v1", id: "WK-2044",
    repo: "agent-chassis/agent-chassis", title: "test-validity capture fixture",
    record_kind: "work_item", work_kind: "implementation", status: "active",
    priority: "high", owner: "unassigned", created: "2026-08-17", updated: "2026-08-17",
    read_scope: [], repo_paths: [], write_scope: [], depends_on: [], blocks: [], related: [],
    dispatch_intent: { intended_agent_role: "worker", target_unit: "record",
      requires_graph_impact: false, requires_escalation: false },
    acceptance: { criteria: ["Structured validation is admission compatible."],
      validation: [{ operation: "node_test", target: "fixture.mjs",
        verification_ids: [binding.verification_claim_id] }] },
    sections: { summary: "", why_it_matters: "", scope: { items: [], out_of_scope: [] },
      tasks: [], references: [], agent_notes: "", closure: null },
    children: [], slices: [], escalations: [], projections: [], migration: null,
    derived_evidence: [], initiative: "IN-0001"
  };
  await writeFile(path.join(repoRoot, "wiki/work-records/WK-2044.json"),
    `${JSON.stringify(record, null, 2)}\n`);

  const bindings = await resolveControlledContractTestProofRuntimeBindings({
    repoRoot, wkId: "WK-2044", verificationIds: [binding.verification_claim_id]
  });
  const catalog = await controlledContract.readProofPackCatalog();
  const admitted = catalog.packs.find(
    ({ profile_id: id }) => id === "proof.verification.test-validity");
  return {
    repoRoot, contracts, wkId: "WK-2044", unit: "WK-2044",
    bindings, verificationId: binding.verification_claim_id,
    profile: { profileId: admitted.profile_id, profileVersion: admitted.profile_version }
  };
}

function testProofReceipt(setup, overrides = {}) {
  const identity = {
    evidence_id: "test-proof-evidence-one", run_id: "run-one", wk_id: setup.wkId,
    selected_unit: setup.unit,
    controlled_contract_generation: setup.bindings.controlled_contract_generation,
    verification_id: setup.verificationId, source_snapshot_digest: digestOf("snapshot"),
    command_id: "command-abc", command_target: "tests/x.test.mjs",
    test_id: `sha256:${"1".repeat(64)}`, attempt: 1,
    ...(overrides.evidence_identity ?? {})
  };
  return {
    schema_version: "workspace-agent-test-proof-evidence-receipt.v1",
    evidence_digest: digestOf("evidence"),
    authority: "advisory_runtime_observation",
    evidence_identity: identity,
    contract_binding: {
      contract_digest: setup.bindings.contract_digest,
      contract_schema_version: setup.bindings.contract_schema_version,
      verification_claim_id: setup.verificationId,
      test_proof_id: "test-proof-suite-covers-component",
      ...(overrides.contract_binding ?? {})
    },
    execution_result: { status: "passed", exit_code: 0 },
    inventory_change_count: 0, falsifier_statuses: [], traversal_statuses: [],
    semantic_judgment: "not_performed_coordinator_owned", advisory: true,
    authority_effect: "none",
    ...(overrides.envelope ?? {})
  };
}

test("test-validity capture preserves the stable-v1 tuple and writes nothing",
  async (t) => {
    const setup = await testValidityFixture(t);
    const before = await manifestState(setup);
    const operation = createCommonProofCaptureOperation({
      repositories: { fixture: setup.repoRoot },
      resolveLauncherReceipt: async (identity) =>
        identity.artifact === "test_proof_runtime_evidence_receipt"
          ? testProofReceipt(setup) : null,
      now: stepClock()
    });
    const result = await operation({
      repository: "fixture", wkId: setup.wkId, unit: setup.unit,
      family: "test_verification_validity", verificationId: setup.verificationId,
      ...{ profileId: setup.profile.profileId, profileVersion: setup.profile.profileVersion }
    });
    assert.equal(result.unit_kind, "work_record");
    assert.equal(result.capture.persisted, false);
    assert.equal(result.capture.matched_binding_count, 1);

    assert.deepEqual(result.capture.stable_v1_tuple, {
      controlled_contract_generation: setup.bindings.controlled_contract_generation,
      contract_digest: setup.bindings.contract_digest,
      contract_schema_version: setup.bindings.contract_schema_version
    });
    assert.equal(result.capture.execution_status, "passed");

    assert.equal(result.launcher_store_mutated, false);
    await assertNoPartialWrite(setup, before);
    const repositoryObservation = result.store_observations.find(
      ({ store }) => store === COMMON_PROOF_CAPTURE_STORES.repository);
    assert.equal(repositoryObservation.lifecycle_state, "resolved");
    assert.equal(repositoryObservation.currentness_detail.store_mutated, false);
  });

test("a stale, cross-identity, or absent test-proof receipt refuses", async (t) => {
  const setup = await testValidityFixture(t);
  const base = {
    repository: "fixture", wkId: setup.wkId, unit: setup.unit,
    family: "test_verification_validity", verificationId: setup.verificationId,
    profileId: setup.profile.profileId, profileVersion: setup.profile.profileVersion
  };
  const cases = [

    [{ evidence_identity: { controlled_contract_generation: digestOf("other") } },
      CODES.RECEIPT_STALE, "controlled_contract_generation"],
    [{ contract_binding: { contract_digest: digestOf("other") } },
      CODES.RECEIPT_STALE, "contract_digest"],
    [{ contract_binding: { contract_schema_version: "controlled-acceptance-contract.v0" } },
      CODES.RECEIPT_STALE, "contract_schema_version"],
    [{ evidence_identity: { wk_id: "WK-3333" } }, CODES.RECEIPT_IDENTITY_MISMATCH, null],
    [{ evidence_identity: { selected_unit: "WK-2044#SLICE-001" } },
      CODES.RECEIPT_IDENTITY_MISMATCH, null],
    [{ evidence_identity: { verification_id: "claim-other" } },
      CODES.RECEIPT_IDENTITY_MISMATCH, null],
    [{ envelope: { evidence_digest: "nope" } }, CODES.RECEIPT_UNAUTHENTICATED, null]
  ];
  for (const [overrides, code, divergentField] of cases) {
    const operation = createCommonProofCaptureOperation({
      repositories: { fixture: setup.repoRoot },
      resolveLauncherReceipt: async () => testProofReceipt(setup, overrides)
    });
    const error = await refusal(operation(base));
    assert.equal(error.code, code, JSON.stringify(overrides));
    if (divergentField) assert.deepEqual(error.details.divergent_fields, [divergentField]);
  }

  const noVerification = createCommonProofCaptureOperation({
    repositories: { fixture: setup.repoRoot },
    resolveLauncherReceipt: async () => testProofReceipt(setup)
  });
  const error = await refusal(noVerification({ ...base, verificationId: undefined }));
  assert.equal(error.code, CODES.IDENTITY_MISMATCH);
});

const INTEGRATION_WK = "WK-2200";
const INTEGRATION_MAPPING_WK = "WK-2201";

function integrationTestProofBinding() {
  return { ...testProofBinding() };
}

const durableReference = (referenceId, typeTerm, domain, value) => ({
  reference_id: referenceId, type_term: typeTerm,
  identity: { kind: "durable_id", domain, value }
});
const UNCONDITIONAL_CONTEXT = { mode: "unconditional", operand_reference_ids: [] };
const typedProposition = (propositionId, subject, operator, operandIds) => ({
  proposition_id: propositionId, subject_reference_id: subject, operator,
  applicability_context: UNCONDITIONAL_CONTEXT,
  operands: operandIds.map((reference_id) => ({ kind: "reference", reference_id }))
});

function integrationMappingContract(contract, claimIds, sliceIds) {
  const references = [
    ...claimIds.map((claimId, index) => durableReference(`ref-claim-${index + 1}`,
      "cc:criterion", `${INTEGRATION_WK}.operative-claim`, claimId)),
    ...sliceIds.map((sliceId, index) => durableReference(`ref-slice-${index + 1}`,
      "cc:process", `${INTEGRATION_WK}.slice`, sliceId)),
    ...sliceIds.map((_, index) => durableReference(`ref-path-${index + 1}`,
      "cc:operation", `${INTEGRATION_WK}.execution-path`, `path-00${index + 1}`)),
    durableReference("ref-branch-1", "cc:state",
      `${INTEGRATION_WK}.required-branch`, "branch-success"),
    durableReference("ref-branch-2", "cc:state",
      `${INTEGRATION_WK}.required-branch`, "branch-refusal")
  ];
  const propositions = [
    ...claimIds.map((_, index) => typedProposition(`prop-own-${index + 1}`,
      `ref-claim-${index + 1}`, "reference:contained_in",
      [`ref-slice-${(index % sliceIds.length) + 1}`])),
    ...sliceIds.map((_, index) => typedProposition(`prop-route-${index + 1}`,
      `ref-slice-${index + 1}`, "reference:routes_to", [`ref-path-${index + 1}`])),
    ...sliceIds.map((_, index) => typedProposition(`prop-branches-${index + 1}`,
      `ref-path-${index + 1}`, "reference:includes", ["ref-branch-1", "ref-branch-2"]))
  ];
  return {
    schema_version: "controlled-acceptance-contract.v1",
    vocabulary_version: contract.vocabulary_version,
    profile_id: contract.profile_id,
    references,
    propositions,
    claims: propositions.map(({ proposition_id: propositionId }) => ({
      claim_id: `claim-${propositionId}`, kind: "behavior", modality: "MUST",
      proposition_id: propositionId
    })),
    relations: [], collections: [], residue: [], annotations: [],
    test_proof_version: contract.test_proof_version, test_proofs: []
  };
}

function integrationSlice(id, dependsOn) {
  return {
    ...structuredClone(SLICE), id, title: `integration slice ${id}`,
    depends_on: [...dependsOn]
  };
}

async function completeIntegrationClaimIds({
  contract, claimIds, sliceIds, proofPlanRequest, evaluationTemplate
}) {
  const bootstrapRecord = {
    id: INTEGRATION_WK, repo: "agent-chassis/agent-chassis", focus: null,
    related: [INTEGRATION_MAPPING_WK],
    slices: sliceIds.map((id, index) =>
      integrationSlice(id, index === 0 ? [] : [sliceIds[index - 1]]))
  };
  try {
    const authored = await controlledContract.buildProofAuthoringSkeleton({
      canonicalRecord: bootstrapRecord, contract,
      mappingContracts: [integrationMappingContract(contract, claimIds, sliceIds)],
      slices: bootstrapRecord.slices, proofPlanRequest,
      evaluationInputs: { [`${INTEGRATION_WK}.evaluation-input.json`]: evaluationTemplate },
      focus: null
    });
    return authored.contract.claims.map(({ claim_id: claimId }) => claimId);
  } catch {
    return claimIds;
  }
}

async function integrationFixture(t, {
  contract: contractOverride = null, mappingContract: mappingOverride = null,
  testProofs = null
} = {}) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "wk-2107-current-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  const contracts = path.join(repoRoot, "wiki", "contracts");
  await mkdir(contracts, { recursive: true });
  await mkdir(path.join(repoRoot, "wiki", "work-records"), { recursive: true });

  const example = JSON.parse(await readFile(path.join(ROOT,
    "packages/controlled-contract/examples/minimal-controlled-acceptance-contract-v034.json"),
  "utf8"));
  const contract = contractOverride ?? migrateControlledAcceptanceContractV02ToV1({
    contract: example, testProofs: testProofs ?? [integrationTestProofBinding()]
  });
  const claimIds = (contract.claims ?? []).map(({ claim_id: claimId }) => claimId);
  const sliceIds = ["SLICE-001", "SLICE-002"];
  const evaluationTemplate = JSON.parse(await readFile(path.join(ROOT,
    "packages/controlled-contract/profiles/proof.integration.prefix-safety/2.0.0/evaluation-input.template.json"),
  "utf8"));
  const proofPlanRequest = {
    schema_version: "controlled-contract-proof-plan-request.v1",
    requested_intents: ["controlled-proof-intent.integration-prefix-safety"],
    selected_packs: []
  };

  const completeClaimIds = await completeIntegrationClaimIds({
    contract, claimIds, sliceIds, record: null, proofPlanRequest, evaluationTemplate
  });
  const mappingContract = mappingOverride ??
    integrationMappingContract(contract, completeClaimIds, sliceIds);

  const write = (name, value) =>
    writeFile(path.join(contracts, name), `${JSON.stringify(value, null, 2)}\n`);
  await write(`${INTEGRATION_WK}.controlled-acceptance.json`, contract);
  await write(`${INTEGRATION_WK}.proof-plan-request.json`, proofPlanRequest);
  await write(`${INTEGRATION_WK}.evaluation-input.json`, evaluationTemplate);
  await write(`${INTEGRATION_MAPPING_WK}.controlled-acceptance.json`, mappingContract);

  const record = {
    schema_version: "work-record.v1", id: INTEGRATION_WK,
    repo: "agent-chassis/agent-chassis", title: "current-profile integration fixture",
    record_kind: "work_item", work_kind: "implementation", status: "active",
    priority: "high", owner: "unassigned", created: "2026-08-17", updated: "2026-08-17",
    read_scope: [], repo_paths: [], write_scope: [], depends_on: [], blocks: [],
    related: [INTEGRATION_MAPPING_WK],
    dispatch_intent: { intended_agent_role: "worker", target_unit: "record",
      requires_graph_impact: false, requires_escalation: false },
    acceptance: { criteria: ["fixture"], validation: [] },
    sections: { summary: "", why_it_matters: "", scope: { items: [], out_of_scope: [] },
      tasks: [], references: [], agent_notes: "", closure: null },
    children: [],
    slices: sliceIds.map((id, index) =>
      integrationSlice(id, index === 0 ? [] : [sliceIds[index - 1]])),
    escalations: [], projections: [], migration: null, derived_evidence: [],
    initiative: "IN-0001", focus: null
  };
  await writeFile(path.join(repoRoot, "wiki/work-records", `${INTEGRATION_WK}.json`),
    `${JSON.stringify(record, null, 2)}\n`);
  return {
    repoRoot, contracts, wkId: INTEGRATION_WK, unit: INTEGRATION_WK,
    contract, mappingContract, record
  };
}

const HISTORICAL_SOURCE_FILES = Object.freeze([
  "wiki/work-records/WK-2063.json",
  "wiki/contracts/WK-2063.controlled-acceptance.json",
  "wiki/contracts/WK-2063.proof-plan-request.json",
  "wiki/contracts/WK-2063.evaluation-input.json",
  "wiki/contracts/WK-2063.pack-sha256-cf0c29c136f0a7b54fb7c75116fae5473a259592f04a2679d95491a3c524ac4a.evaluation-input.json",
  "wiki/contracts/WK-2071.controlled-acceptance.json"
]);

async function historicalFixture(t) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "wk-2107-historical-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  await mkdir(path.join(repoRoot, "wiki", "contracts"), { recursive: true });
  await mkdir(path.join(repoRoot, "wiki", "work-records"), { recursive: true });
  for (const relative of HISTORICAL_SOURCE_FILES) {
    await copyFile(path.join(ROOT, relative), path.join(repoRoot, relative));
  }
  return {
    repoRoot, contracts: path.join(repoRoot, "wiki", "contracts"),
    wkId: "WK-2063", unit: "WK-2063"
  };
}

async function currentIntegrationProfile() {
  const comparison = await controlledContract.compareIntegrationPrefixCaptureCompatibility();
  return {
    comparison,
    target: comparison.target_profile,
    historical: comparison.source_profile,
    request: {
      family: "integration_prefix_safety",
      profileId: comparison.target_profile.profile_id,
      profileVersion: comparison.target_profile.profile_version
    }
  };
}

test("the current-profile route publishes the exact 2.0.0 authored generation",
  async (t) => {
    const setup = await integrationFixture(t);
    const current = await currentIntegrationProfile();
    assert.equal(current.target.profile_version, "2.0.0");
    const calls = [];
    const operation = operationFor(setup, {
      loadPackageCapabilities: spyCapabilities(calls), now: stepClock()
    });
    const result = await operation(request(setup, current.request));

    assert.equal(result.capture.profile_id, "proof.integration.prefix-safety");
    assert.equal(result.capture.profile_version, "2.0.0");
    assert.equal(result.capture.published_profile_id, "proof.integration.prefix-safety");
    assert.equal(result.capture.published_profile_version, "2.0.0");
    assert.equal(result.capture.historical_profile_version, "1.0.0");

    assert.equal(result.evidence_store, "repository");
    assert.equal(result.launcher_derived, false);
    assert.equal(result.persisted, true);
    assert.equal(result.repository_store_mutated, true);
    assert.equal(result.capture.persisted, true);
    assert.match(result.capture.generation, /^[0-9a-f]{64}$/u);

    assert.deepEqual(result.store_observations.map(({ store }) => store),
      [COMMON_PROOF_CAPTURE_STORES.repository]);
    const observation = result.store_observations[0];
    assert.equal(observation.lifecycle_state, "persisted");
    assert.equal(observation.currentness, "current");
    assert.equal(observation.source_identity, `generation:${result.capture.generation}`);
    assert.equal(observation.currentness_detail.written, true);
    assert.equal(observation.currentness_detail.no_op, false);

    const published = await resolveCanonicalControlledContractCarrierSet({
      repoRoot: setup.repoRoot, wkId: setup.wkId
    });
    assert.equal(published.source, "manifest");
    assert.equal(published.generation, result.capture.generation);
    const manifest = JSON.parse(await readFile(
      path.join(setup.contracts, `${setup.wkId}.carrier-set-manifest.json`), "utf8"));
    assert.equal(manifest.generation.id, result.capture.generation);
    assert.equal(published.members.length, manifest.carriers.length);

    const authored = await controlledContract.buildProofAuthoringSkeleton({
      canonicalRecord: setup.record, contract: setup.contract,
      mappingContracts: [setup.mappingContract], slices: setup.record.slices,
      proofPlanRequest: JSON.parse(await readFile(path.join(setup.contracts,
        `${setup.wkId}.proof-plan-request.json`), "utf8")),
      evaluationInputs: { [`${setup.wkId}.evaluation-input.json`]: JSON.parse(
        await readFile(path.join(setup.contracts,
          `${setup.wkId}.evaluation-input.json`), "utf8")) },
      focus: null
    });
    const named = (carrierKind) =>
      controlledContractCarrierFilename({ wkId: setup.wkId, carrierKind });
    assert.deepEqual(published.members_by_basename[named("contract")].content,
      authored.contract);
    assert.deepEqual(published.members_by_basename[named("proof_plan_request")].content,
      authored.proof_plan_request);
    assert.deepEqual(published.members_by_basename[named("proof_plan")].content,
      authored.proof_plan);
    for (const [basename, content] of Object.entries(authored.evaluation_inputs)) {
      assert.deepEqual(published.members_by_basename[basename].content, content, basename);
    }
    assert.equal(result.capture.contract_schema_version, "controlled-acceptance-contract.v1");
    assert.equal(result.capture.evaluation_input_path,
      `${setup.wkId}.evaluation-input.json`);

    assert.equal(calls.filter(
      ({ name }) => name === "buildProofAuthoringSkeleton").length, 1);
    assert.equal(calls.filter(
      ({ name }) => name === "buildIntegrationPrefixSourceMap").length, 0);
    for (const name of ["compareIntegrationPrefixCaptureCompatibility",
      "readProofPackCatalog", "loadAdmittedProofPack", "validateStableTestProofContract"]) {
      assert.equal(calls.filter((call) => call.name === name).length, 1, name);
    }

    assert.equal(result.capture.source_map_schema_version,
      authored.source_map.schema_version);
    assert.equal(result.capture.integration_unit_count,
      authored.integration_units.integration_units.length);
    assert.equal(result.capture.execution_path_count,
      authored.execution_paths.execution_paths.length);
    assert.equal(result.capture.execution_path_count, setup.record.slices.length);
    assert.deepEqual(result.capture.branches, [...authored.branches]);
    assert.ok(result.capture.branches.length > 0);

    assert.deepEqual(result.capture.artifact_member_basenames,
      authored.artifact_members.map(({ filename }) => filename).sort());
    assert.ok(result.capture.artifact_member_basenames.length > 0);
    assert.ok(result.capture.artifact_member_basenames.every(
      (basename) => /integration-prefix/u.test(basename)));
    for (const basename of result.capture.artifact_member_basenames) {
      assert.equal(Object.hasOwn(published.members_by_basename, basename), false, basename);
    }
    assert.equal(result.capture.carrier_count, published.members.length);
  });

test("replaying the identical current-profile capture is a deterministic no-op",
  async (t) => {
    const setup = await integrationFixture(t);
    const current = await currentIntegrationProfile();
    const first = await operationFor(setup)(request(setup, current.request));
    assert.equal(first.persisted, true);
    const afterFirst = await treeSnapshot(setup.repoRoot);

    const replay = await operationFor(setup)(request(setup, current.request));
    assert.equal(replay.capture.generation, first.capture.generation);
    assert.equal(replay.capture.published_profile_version, "2.0.0");

    assert.equal(replay.store_observations[0].currentness_detail.no_op, true);
    assert.equal(replay.store_observations[0].currentness_detail.written, false);

    assert.deepEqual(await treeSnapshot(setup.repoRoot), afterFirst);
    const resolved = await resolveCanonicalControlledContractCarrierSet({
      repoRoot: setup.repoRoot, wkId: setup.wkId
    });
    assert.equal(resolved.generation, first.capture.generation);
  });

test("integration-prefix source movement before the manifest switch rolls back completely",
  async (t) => {
    const setup = await integrationFixture(t);
    const current = await currentIntegrationProfile();
    const contractPath = path.join(setup.contracts,
      `${setup.wkId}.controlled-acceptance.json`);

    const competing = structuredClone(setup.contract);
    competing.annotations = [
      { annotation_id: "annotation-competing", text: "competing writer" }
    ];
    const competingBytes = `${JSON.stringify(competing, null, 2)}\n`;

    let moved = false;
    t.after(() => setCanonicalAuthoringPublisherHookForTest(null));
    setCanonicalAuthoringPublisherHookForTest(async (boundary) => {
      if (boundary !== "generation_verified" || moved) return;
      moved = true;
      await writeFile(contractPath, competingBytes);
    });
    const error = await refusal(operationFor(setup)(request(setup, current.request)));
    setCanonicalAuthoringPublisherHookForTest(null);

    assert.equal(moved, true);
    assert.equal(error.code, "controlled_contract_source_lease_source_stale");

    const names = (await readdir(setup.contracts)).sort();
    assert.deepEqual(names.filter((name) => name.startsWith(".carrier-set-")), []);
    assert.equal(names.some((name) => name.endsWith("carrier-set-manifest.json")), false);
    let generations = [];
    try {
      generations = await readdir(path.join(setup.contracts, ".carrier-generations"));
    } catch { generations = []; }
    assert.deepEqual(generations, []);

    assert.equal(await readFile(contractPath, "utf8"), competingBytes);

    const resolved = await resolveCanonicalControlledContractCarrierSet({
      repoRoot: setup.repoRoot, wkId: setup.wkId
    });
    assert.equal(resolved.source, "legacy_root");
    assert.deepEqual(resolved.members_by_basename[
      controlledContractCarrierFilename({ wkId: setup.wkId, carrierKind: "contract" })
    ].content, competing);
  });

test("a historical 1.0.0 selection is refused as not the current route", async (t) => {
  const setup = await integrationFixture(t);
  const current = await currentIntegrationProfile();
  const before = await treeSnapshot(setup.repoRoot);
  const error = await refusal(operationFor(setup)(request(setup, {
    ...current.request, profileVersion: current.historical.profile_version
  })));
  assert.equal(error.code, CODES.PROFILE_INCOMPATIBLE);
  assert.equal(error.details.selected_profile_version, "1.0.0");
  assert.equal(error.details.target_profile_version, "2.0.0");

  assert.equal(error.details.selected_historical_profile, true);
  assert.deepEqual(await treeSnapshot(setup.repoRoot), before);
});

test("an experimental canonical contract refuses as pre-stable without mutation",
  async (t) => {
    const setup = await historicalFixture(t);
    const current = await currentIntegrationProfile();
    const before = await treeSnapshot(setup.repoRoot);
    const error = await refusal(operationFor(setup)(request(setup, current.request)));
    assert.equal(error.code, CODES.CANONICAL_SOURCE_PRE_STABLE);
    assert.equal(error.details.contract_schema_version,
      "controlled-acceptance-contract.experimental.v0.2");
    assert.equal(error.details.required_schema_version, "controlled-acceptance-contract.v1");

    assert.deepEqual(await treeSnapshot(setup.repoRoot), before);
  });

test("an incomplete stable-v1 test-proof population refuses without mutation", async (t) => {
  const current = await currentIntegrationProfile();

  const example = JSON.parse(await readFile(path.join(ROOT,
    "packages/controlled-contract/examples/minimal-controlled-acceptance-contract-v034.json"),
  "utf8"));
  const complete = migrateControlledAcceptanceContractV02ToV1({
    contract: example, testProofs: [integrationTestProofBinding()]
  });
  const stripped = structuredClone(complete);
  stripped.test_proofs = [];
  const bare = await integrationFixture(t, { contract: stripped });
  const bareBefore = await treeSnapshot(bare.repoRoot);
  const invalid = await refusal(operationFor(bare)(request(bare, current.request)));
  assert.equal(invalid.code, CODES.CANONICAL_SOURCE_PRE_STABLE);
  assert.ok(invalid.details.diagnostics);
  assert.deepEqual(await treeSnapshot(bare.repoRoot), bareBefore);

  const permissive = await integrationFixture(t, { contract: stripped });
  const permissiveBefore = await treeSnapshot(permissive.repoRoot);
  const operation = operationFor(permissive, {
    loadPackageCapabilities: spyCapabilities([], (surface) => ({
      ...surface, validateStableTestProofContract: () => ({ valid: true, diagnostics: [] })
    }))
  });
  const incomplete = await refusal(operation(request(permissive, current.request)));
  assert.equal(incomplete.code, CODES.TEST_PROOF_POPULATION_INCOMPLETE);
  assert.deepEqual(incomplete.details.missing_verification_ids,
    ["claim-suite-covers-component"]);
  assert.equal(incomplete.details.required_count, 1);
  assert.deepEqual(await treeSnapshot(permissive.repoRoot), permissiveBefore);
});

test("an incompatible mapping population refuses without mutation", async (t) => {
  const current = await currentIntegrationProfile();
  const setup = await integrationFixture(t);

  const historical = JSON.parse(await readFile(
    path.join(ROOT, "wiki/contracts/WK-2071.controlled-acceptance.json"), "utf8"));
  await writeFile(
    path.join(setup.contracts, `${INTEGRATION_MAPPING_WK}.controlled-acceptance.json`),
    `${JSON.stringify(historical, null, 2)}\n`);
  const before = await treeSnapshot(setup.repoRoot);
  const error = await refusal(operationFor(setup)(request(setup, current.request)));
  assert.equal(error.code, CODES.CANONICAL_POPULATION_INCOMPLETE);
  assert.deepEqual(error.details.related_schema_versions,
    ["controlled-acceptance-contract.experimental.v0.2"]);
  assert.deepEqual(await treeSnapshot(setup.repoRoot), before);
});

test("compatibility, migration, target, catalog, and admission each gate the route",
  async (t) => {
    const setup = await integrationFixture(t);
    const current = await currentIntegrationProfile();
    const before = await treeSnapshot(setup.repoRoot);
    const comparison = current.comparison;
    const withComparison = (value) => (surface) => ({
      ...surface, compareIntegrationPrefixCaptureCompatibility: async () => value
    });
    const cases = [

      [withComparison({ ...comparison, outcome: "incompatible" }),
        CODES.PROFILE_INCOMPATIBLE, { outcome: "incompatible" }],

      [withComparison({ ...comparison,
        migration: { ...comparison.migration, complete: false } }),
      CODES.PROFILE_INCOMPATIBLE, { migration_complete: false }],

      [withComparison({ ...comparison,
        target_profile: { profile_id: "proof.integration.prefix-safety",
          profile_version: "3.0.0" } }),
      CODES.PROFILE_INCOMPATIBLE, { target_profile_version: "3.0.0" }],

      [(surface) => ({ ...surface, readProofPackCatalog: async () => ({ packs: [] }) }),
        CODES.PROFILE_INCOMPATIBLE, { catalog_profile_version: null }],

      [(surface) => ({ ...surface,
        loadAdmittedProofPack: async () => ({ profile: {
          profile_id: "proof.integration.prefix-safety", profile_version: "1.0.0" } }) }),
      CODES.PROFILE_INCOMPATIBLE, { admitted_profile_version: "1.0.0" }]
    ];
    for (const [mutate, code, expectedDetails] of cases) {
      const operation = operationFor(setup, {
        loadPackageCapabilities: spyCapabilities([], mutate)
      });
      const error = await refusal(operation(request(setup, current.request)));
      assert.equal(error.code, code, JSON.stringify(expectedDetails));
      for (const [key, value] of Object.entries(expectedDetails)) {
        assert.equal(error.details[key], value, key);
      }
      assert.deepEqual(await treeSnapshot(setup.repoRoot), before);
    }
  });

test("integration-prefix refuses a missing exported owner by name", async (t) => {
  const setup = await integrationFixture(t);
  const current = await currentIntegrationProfile();
  const before = await treeSnapshot(setup.repoRoot);

  for (const name of ["buildIntegrationPrefixSourceMap", "buildProofAuthoringSkeleton"]) {
    const operation = operationFor(setup, {
      loadPackageCapabilities: spyCapabilities([], (surface) => {
        const reduced = { ...surface };
        delete reduced[name];
        return reduced;
      })
    });
    const error = await refusal(operation(request(setup, current.request)));
    assert.equal(error.code, CODES.PACKAGE_CAPABILITY_MISSING);
    assert.deepEqual(error.details.missing_capabilities, [name]);
  }
  assert.deepEqual(await treeSnapshot(setup.repoRoot), before);
});

test("a competing contract publication conflicts the integration-prefix digest CAS",
  async (t) => {
    const setup = await integrationFixture(t);
    const current = await currentIntegrationProfile();
    const contractPath = path.join(setup.contracts,
      `${INTEGRATION_WK}.controlled-acceptance.json`);
    const original = await readFile(contractPath);
    const moved = structuredClone(setup.contract);
    moved.annotations = [{ annotation_id: "annotation-moved", text: "moved" }];

    const error = await refusal(operationFor(setup, {
      now: stepClock((tick) => {
        if (tick === 1) writeFileSync(contractPath, `${JSON.stringify(moved, null, 2)}\n`);
      })
    })(request(setup, current.request)));
    assert.equal(error.code, "controlled_contract_stale_content_digest");

    assert.notDeepEqual(await readFile(contractPath), original);
    assert.deepEqual((await readdir(setup.contracts)).filter(
      (name) => name.startsWith(".carrier-set-") || name === ".carrier-generations"), []);
  });

test("the integration-prefix route never migrates or rewrites canonical state",
  async () => {
    const production = await Promise.all([
      "packages/wiki-core/src/lib/common-proof-capture-tools.mjs",
      "packages/wiki-core/src/operations/common-proof-capture.mjs"
    ].map((relative) => readFile(path.join(ROOT, relative), "utf8")));
    for (const source of production) {

      for (const forbidden of ["stable-v1-migration", "migrateControlledAcceptance",
        "experimental.v0.2", "testProofs", "test_proof_version"]) {
        assert.equal(source.includes(forbidden), false, forbidden);
      }

      assert.equal(/controlled-contract\/lib\//u.test(source), false);
      assert.equal(/controlled-contract\/examples\//u.test(source), false);
    }

    assert.equal(production[0].includes("publicationProfile"), false);
    assert.equal(production[0].includes("source_profile.profile_version"), false);
  });

test("one shared observation envelope carries both stores and claims no joint instant",
  async (t) => {
    const setup = await canonicalFixture(t);
    await withBoundarySlots(setup);
    const repositoryOnly = await operationFor(setup, { now: stepClock() })(
      request(setup, DECLARED_BOUNDARY_REQUEST));
    const both = await operationFor(setup, {
      resolveLauncherReceipt: async () => writeConfinementProjection(),
      now: stepClock()
    })(request(setup, WRITE_CONFINEMENT_REQUEST));

    assert.deepEqual(repositoryOnly.store_observations.map(({ store }) => store),
      [COMMON_PROOF_CAPTURE_STORES.repository]);

    assert.deepEqual(both.store_observations.map(({ store }) => store),
      [COMMON_PROOF_CAPTURE_STORES.repository, COMMON_PROOF_CAPTURE_STORES.launcher]);

    for (const observation of [...repositoryOnly.store_observations,
      ...both.store_observations]) {
      assert.equal(observation.schema_version,
        COMMON_PROOF_CAPTURE_OBSERVATION_SCHEMA_VERSION);
      assert.deepEqual(Object.keys(observation).sort(), [
        "cross_store_transaction", "currentness", "currentness_detail", "lifecycle_state",
        "observed_at", "schema_version", "simultaneous_currentness_claimed",
        "source_digest", "source_identity", "store"
      ]);
      assert.ok(COMMON_PROOF_CAPTURE_LIFECYCLE_STATES.includes(observation.lifecycle_state));
      assert.ok(COMMON_PROOF_CAPTURE_CURRENTNESS_RESULTS.includes(observation.currentness));
      assert.equal(observation.cross_store_transaction, false);
      assert.equal(observation.simultaneous_currentness_claimed, false);
      assert.equal(typeof observation.source_identity, "string");
    }

    assert.equal(repositoryOnly.store_observations[0].lifecycle_state, "persisted");

    const [repositoryObservation, launcherObservation] = both.store_observations;
    assert.equal(repositoryObservation.lifecycle_state, "resolved");
    assert.equal(repositoryObservation.currentness_detail.store_mutated, false);
    assert.equal(launcherObservation.lifecycle_state, "read_only_join");
    assert.equal(launcherObservation.currentness_detail.store_mutated, false);
    assert.notEqual(repositoryObservation.observed_at, launcherObservation.observed_at);
    assert.notEqual(repositoryObservation.source_identity,
      launcherObservation.source_identity);
    assert.notEqual(repositoryObservation.source_digest, launcherObservation.source_digest);
    assert.equal(both.cross_store_transaction, false);
    assert.equal(both.simultaneous_currentness_claimed, false);

    assert.equal(new Set(both.store_observations.map(({ store }) => store)).size, 2);
  });

test("the observation envelope owner refuses an ill-formed observation", () => {
  const valid = {
    store: COMMON_PROOF_CAPTURE_STORES.repository,
    sourceIdentity: "generation:abc",
    sourceDigest: digestOf("x"),
    observedAt: "2026-08-18T00:00:01.000Z",
    lifecycleState: "resolved",
    currentness: "current"
  };
  assert.equal(commonProofCaptureObservation(valid).store,
    COMMON_PROOF_CAPTURE_STORES.repository);
  for (const override of [
    { store: "some_other_store" },
    { sourceIdentity: "" },
    { observedAt: "" },
    { lifecycleState: "committed" },
    { currentness: "probably" }
  ]) {
    assert.throws(() => commonProofCaptureObservation({ ...valid, ...override }),
      ({ code }) => code === CODES.IDENTITY_MISMATCH);
  }

  assert.equal(commonProofCaptureObservation({ ...valid, sourceDigest: null }).source_digest,
    null);
  assert.throws(() => commonProofCaptureObservation({ ...valid, sourceDigest: "" }),
    ({ code }) => code === CODES.IDENTITY_MISMATCH);
});

test("persistence binds the server-observed digest to the CAS owner, which refuses a stale one",
  async (t) => {
    const setup = await canonicalFixture(t);
    await withBoundarySlots(setup);
    const first = await operationFor(setup, { now: stepClock() })(
      request(setup, DECLARED_BOUNDARY_REQUEST));
    const observation = first.store_observations[0];

    assert.equal(observation.currentness_detail.expected_content_digest, null);
    assert.equal(observation.currentness_detail.prior_source_identity,
      `legacy_root:${setup.wkId}:`);
    assert.equal(observation.currentness_detail.written, true);

    const published = await resolveCanonicalControlledContractCarrierSet({
      repoRoot: setup.repoRoot, wkId: setup.wkId
    });
    const actual = published.members_by_basename[first.capture.target_filename].content_digest;

    const conflict = await refusal(assertControlledContractCarrierExpectedDigest({
      repoRoot: setup.repoRoot, wkId: setup.wkId, focus: null,
      carrierKind: "evaluation_input",
      pack: { profileId: DECLARED_BOUNDARY_REQUEST.profileId,
        profileVersion: DECLARED_BOUNDARY_REQUEST.profileVersion },
      preferPack: true,
      expectedContentDigest: digestOf("a digest the carrier never had")
    }));
    assert.equal(conflict.code, "controlled_contract_stale_content_digest");
    assert.equal(conflict.details.actual_content_digest, actual);
  });

test("a competing publication between the initial observation and the lease conflicts",
  async (t) => {
    const setup = await canonicalFixture(t);
    const manifestPath = path.join(setup.contracts, `${setup.wkId}.carrier-set-manifest.json`);
    const runBoundary = (extra = {}) =>
      operationFor(setup, extra)(request(setup, DECLARED_BOUNDARY_REQUEST));

    await withBoundarySlots(setup);
    await runBoundary();
    const manifestA = await readFile(manifestPath);
    await withBoundarySlots(setup, { limits: VARIED_BOUNDARY_LIMITS });
    await runBoundary();
    const manifestB = await readFile(manifestPath);
    assert.notDeepEqual(manifestA, manifestB);

    await writeFile(manifestPath, manifestA);
    await withBoundarySlots(setup, { limits: VARIED_BOUNDARY_LIMITS });

    const error = await refusal(runBoundary({
      now: stepClock((tick) => {
        if (tick === 1) writeFileSync(manifestPath, manifestB);
      })
    }));
    assert.equal(error.code, "controlled_contract_stale_content_digest");

    assert.deepEqual(await readFile(manifestPath), manifestB);
    assert.deepEqual((await readdir(setup.contracts)).filter(
      (name) => name.startsWith(".carrier-set-")), []);
  });

test("live-source movement during publication fails the final compare and rolls back",
  async (t) => {
    const setup = await canonicalFixture(t);
    const manifestPath = path.join(setup.contracts, `${setup.wkId}.carrier-set-manifest.json`);
    const runBoundary = (extra = {}) =>
      operationFor(setup, extra)(request(setup, DECLARED_BOUNDARY_REQUEST));

    await withBoundarySlots(setup);
    await runBoundary();
    const manifestA = await readFile(manifestPath);
    await withBoundarySlots(setup, { limits: VARIED_BOUNDARY_LIMITS });
    await runBoundary();
    const manifestB = await readFile(manifestPath);
    await writeFile(manifestPath, manifestA);
    await withBoundarySlots(setup, { limits: VARIED_BOUNDARY_LIMITS });
    const before = await manifestState(setup);

    let moved = false;
    t.after(() => setCanonicalAuthoringPublisherHookForTest(null));
    setCanonicalAuthoringPublisherHookForTest(async (boundary) => {

      if (boundary !== "generation_verified" || moved) return;
      moved = true;
      await writeFile(manifestPath, manifestB);
    });
    const error = await refusal(runBoundary());
    setCanonicalAuthoringPublisherHookForTest(null);
    assert.equal(moved, true);
    assert.ok(error.code.startsWith("controlled_contract_source_lease_"), error.code);

    const after = await manifestState(setup);
    assert.deepEqual(after.staging, []);
    assert.deepEqual(after.generations, before.generations);

    assert.deepEqual(await readFile(manifestPath), manifestB);
    const resolved = await resolveCanonicalControlledContractCarrierSet({
      repoRoot: setup.repoRoot, wkId: setup.wkId
    });
    assert.equal(resolved.source, "manifest");
  });

test("repository-derived publication is complete, manifest-last, and replay-stable",
  async (t) => {
    const setup = await canonicalFixture(t);
    await withBoundarySlots(setup);
    const first = await operationFor(setup)(request(setup, DECLARED_BOUNDARY_REQUEST));
    assert.equal(first.persisted, true);
    assert.equal(first.repository_store_mutated, true);

    const published = await resolveCanonicalControlledContractCarrierSet({
      repoRoot: setup.repoRoot, wkId: setup.wkId
    });
    assert.equal(published.generation, first.capture.generation);
    for (const carrierKind of ["contract", "proof_plan_request", "evaluation_input"]) {
      const name = controlledContractCarrierFilename({ wkId: setup.wkId, carrierKind });
      assert.ok(Object.hasOwn(published.members_by_basename, name), name);
    }
    assert.ok(Object.hasOwn(published.members_by_basename, first.capture.target_filename));

    const manifest = JSON.parse(await readFile(
      path.join(setup.contracts, `${setup.wkId}.carrier-set-manifest.json`), "utf8"));
    assert.equal(manifest.generation.id, first.capture.generation);
    assert.equal(published.members.length, manifest.carriers.length);

    const beforeJoin = await treeSnapshot(setup.repoRoot);
    const join = await operationFor(setup, {
      resolveLauncherReceipt: async () => writeConfinementProjection()
    })(request(setup, WRITE_CONFINEMENT_REQUEST));
    assert.equal(join.persisted, false);
    assert.deepEqual(await treeSnapshot(setup.repoRoot), beforeJoin);

    const replay = await operationFor(setup)(request(setup, DECLARED_BOUNDARY_REQUEST));
    assert.equal(replay.capture.generation, first.capture.generation);
    assert.equal(replay.store_observations[0].currentness_detail.no_op, true);
  });

test("the shared resolver owns no provider, diff, receipt, pagination, or mapping substrate",
  async () => {
    const source = await readFile(
      path.join(ROOT, "packages/wiki-core/src/lib/common-proof-capture-tools.mjs"), "utf8");

    assert.ok(source.split("\n").length < 1250, "shared module exceeded its line boundary");

    for (const forbidden of [
      "node:child_process", "execFile", "spawn", "simple-git", "git diff",
      "TEST_PROOF_PROVIDER_CATALOG", "resolveTestProofProviderCompatibility",
      "evaluateAdmittedTestValidity", "assessTestProofContract"
    ]) assert.equal(source.includes(forbidden), false, forbidden);

    for (const forbidden of [
      "writeFile", "mkdir", "rename", "carrier-set-manifest", ".carrier-generations"
    ]) assert.equal(source.includes(forbidden), false, forbidden);

    for (const forbidden of ["cursor", "page_size", "content_reference", "continuation"]) {
      assert.equal(source.toLowerCase().includes(forbidden), false, forbidden);
    }

    assert.ok(source.includes('"@agent-chassis/controlled-contract"'));
    assert.equal(/controlled-contract\/lib\//u.test(source), false,
      "an unpublished deep package path was imported");

    assert.equal(source.includes("agent-launch"), false);
    const operationSource = await readFile(
      path.join(ROOT, "packages/wiki-core/src/operations/common-proof-capture.mjs"), "utf8");
    assert.equal(operationSource.includes("agent-launch"), false);

    const bodyOf = (name) => {
      const start = source.indexOf(`async function ${name}(`);
      assert.notEqual(start, -1, name);

      const end = source.indexOf("\n}\n", start);
      assert.notEqual(end, -1, name);
      return source.slice(start, end);
    };
    const PUBLICATION_OWNERS = [
      "withCanonicalControlledContractSourceLease",
      "assertControlledContractCarrierExpectedDigest",
      "writeControlledContractCarrierSet",
      "publishCanonicalCarrierSet",
      "publish("
    ];
    for (const name of ["resolveWriteConfinementCapture",
      "resolveBehavioralPreservationCapture", "readBehavioralPreservationSide",
      "resolveTestValidityCapture", "resolveTestValidityProfile"]) {
      const body = bodyOf(name);
      for (const owner of PUBLICATION_OWNERS) {
        assert.equal(body.includes(owner), false, `${name} reaches ${owner}`);
      }
    }

    assert.ok(bodyOf("resolveDeclaredBoundaryCapture").includes("await publish("));
    assert.ok(bodyOf("resolveIntegrationPrefixCapture")
      .includes("writeControlledContractCarrierSet"));

    const dispatch = source.slice(source.indexOf("const REPOSITORY_FAMILY_RESOLVERS"));
    assert.ok(dispatch.includes("publish: publishCanonicalCarrierSet"));
    assert.equal(
      dispatch.slice(dispatch.indexOf("LAUNCHER_FAMILY_RESOLVERS[selection.family]"),
        dispatch.indexOf("REPOSITORY_FAMILY_RESOLVERS[selection.family]"))
        .includes("publish"), false);

    const manifest = JSON.parse(await readFile(
      path.join(ROOT, "packages/wiki-core/package.json"), "utf8"));
    assert.equal(Object.keys(manifest.dependencies ?? {}).some(
      (name) => name.includes("agent-launch")), false);

    assert.ok(operationSource.split("\n").length < 150);
    assert.ok(operationSource.includes("assertControlledContractOperationInput"));
    assert.ok(operationSource.includes("resolveAndPersistCommonProofCapture"));

    for (const name of ["mapDeclaredBoundaryCapture", "mapWriteConfinementCapture",
      "mapBehavioralPreservationCapture", "resolveAndPersistCommonProofCapture"]) {
      const existing = await readFile(
        path.join(ROOT, "packages/wiki-core/src/operations/controlled-contract.mjs"), "utf8");
      assert.equal(existing.includes(name), false, name);
    }
  });

async function competingPackMember(wkId) {
  const base = buildBoundaryFixture({});
  const artifactSource = (b) => ({ kind: "artifact_file", relative_path: b });
  const mapped = await controlledContract.mapDeclaredBoundaryCapture({
    capture: {
      schema_version: controlledContract.DECLARED_BOUNDARY_CAPTURE_INPUT_SCHEMA_VERSION,
      policy: { bytes: base.policyBytes,
        source: artifactSource(`${wkId}.declared-boundary-policy.json`) },
      observation: { record_id: `${wkId}/boundary-observation-record`,
        bytes: base.observationBytes,
        source: artifactSource(`${wkId}.declared-boundary-observations.json`) },
      subjects: { bytes: base.subjectsBytes,
        source: artifactSource(`${wkId}.declared-boundary-subjects.json`) },
      report: { source: artifactSource(`${wkId}.declared-boundary-report.json`) }
    }
  });
  assert.equal(mapped.mapped, true);
  return {
    basename: controlledContractPackCarrierFilename({
      wkId, focus: null,
      profileId: controlledContract.DECLARED_BOUNDARY_PROFILE_ID,
      profileVersion: controlledContract.DECLARED_BOUNDARY_PROFILE_VERSION }),
    bytes: `${JSON.stringify(mapped.evaluation_input, null, 2)}\n`
  };
}

test("a canonical member ADDED between the initial observation and the lease conflicts",
  async (t) => {
    const setup = await integrationFixture(t);
    const current = await currentIntegrationProfile();
    const competing = await competingPackMember(INTEGRATION_WK);
    const competingPath = path.join(setup.contracts, competing.basename);
    const before = await treeSnapshot(setup.repoRoot);

    const calls = [];
    const error = await refusal(operationFor(setup, {
      loadPackageCapabilities: spyCapabilities(calls),
      now: stepClock((tick) => {
        if (tick === 1) writeFileSync(competingPath, competing.bytes);
      })
    })(request(setup, current.request)));

    assert.equal(error.code, CODES.CARRIER_STATE_CONTRADICTORY);
    assert.deepEqual(error.details.moved_basenames, [competing.basename]);

    assert.equal(calls.filter(({ name }) => name === "buildProofAuthoringSkeleton").length, 0);

    const after = await manifestState(setup);
    assert.deepEqual(after.staging, []);
    assert.deepEqual(after.generations, []);
    assert.equal(after.manifest, null);

    assert.equal(await readFile(competingPath, "utf8"), competing.bytes);
    const resolved = await resolveCanonicalControlledContractCarrierSet({
      repoRoot: setup.repoRoot, wkId: setup.wkId });
    assert.equal(resolved.source, "legacy_root");
    assert.ok(Object.hasOwn(resolved.members_by_basename, competing.basename));

    const afterTree = await treeSnapshot(setup.repoRoot);
    const competingKey = `wiki/contracts/${competing.basename}`;
    assert.ok(Object.hasOwn(afterTree, competingKey));
    delete afterTree[competingKey];
    assert.deepEqual(afterTree, before);
  });

test("a canonical member REMOVED between the initial observation and the lease conflicts",
  async (t) => {
    const setup = await integrationFixture(t);
    const current = await currentIntegrationProfile();
    const competing = await competingPackMember(INTEGRATION_WK);
    const competingPath = path.join(setup.contracts, competing.basename);

    await writeFile(competingPath, competing.bytes);
    const before = await treeSnapshot(setup.repoRoot);

    const calls = [];
    const error = await refusal(operationFor(setup, {
      loadPackageCapabilities: spyCapabilities(calls),
      now: stepClock((tick) => {
        if (tick === 1) rmSync(competingPath, { force: true });
      })
    })(request(setup, current.request)));

    assert.equal(error.code, CODES.CARRIER_STATE_CONTRADICTORY);
    assert.deepEqual(error.details.moved_basenames, [competing.basename]);
    assert.equal(calls.filter(({ name }) => name === "buildProofAuthoringSkeleton").length, 0);

    const after = await manifestState(setup);
    assert.deepEqual(after.staging, []);
    assert.deepEqual(after.generations, []);
    assert.equal(after.manifest, null);

    await assert.rejects(readFile(competingPath), ({ code }) => code === "ENOENT");
    const resolved = await resolveCanonicalControlledContractCarrierSet({
      repoRoot: setup.repoRoot, wkId: setup.wkId });
    assert.equal(Object.hasOwn(resolved.members_by_basename, competing.basename), false);
    delete before[`wiki/contracts/${competing.basename}`];
    assert.deepEqual(await treeSnapshot(setup.repoRoot), before);
  });

test("declared-boundary slot reads are fenced, bounded, and distinguish absence",
  async (t) => {
    const escaped = await canonicalFixture(t);
    const base = await withBoundarySlots(escaped);
    const outside = await mkdtemp(path.join(os.tmpdir(), "wk-2107-outside-"));
    t.after(() => rm(outside, { recursive: true, force: true }));

    const external = path.join(outside, "external-subjects.json");
    await writeFile(external, base.subjectsBytes);
    const slot = path.join(escaped.contracts, `${escaped.wkId}.declared-boundary-subjects.json`);
    await rm(slot);
    await symlink(external, slot);
    const beforeEscape = await treeSnapshot(escaped.repoRoot);

    const escapeCalls = [];
    const escapeError = await refusal(operationFor(escaped, {
      loadPackageCapabilities: spyCapabilities(escapeCalls)
    })(request(escaped, DECLARED_BOUNDARY_REQUEST)));

    assert.equal(escapeError.code, "controlled_contract_carrier_escape");

    assert.equal(escapeCalls.filter(
      ({ name }) => name === "mapDeclaredBoundaryCapture").length, 0);
    assert.deepEqual(await treeSnapshot(escaped.repoRoot), beforeEscape);
    assert.deepEqual((await manifestState(escaped)).generations, []);

    const absent = await canonicalFixture(t);
    await withBoundarySlots(absent);
    await rm(path.join(absent.contracts, `${absent.wkId}.declared-boundary-policy.json`));
    const beforeAbsent = await treeSnapshot(absent.repoRoot);
    const absentError = await refusal(
      operationFor(absent)(request(absent, DECLARED_BOUNDARY_REQUEST)));
    assert.equal(absentError.code, CODES.CANONICAL_POPULATION_INCOMPLETE);
    assert.deepEqual(absentError.details.missing_basenames,
      [`${absent.wkId}.declared-boundary-policy.json`]);
    assert.deepEqual(await treeSnapshot(absent.repoRoot), beforeAbsent);

    const oversized = await canonicalFixture(t);
    await withBoundarySlots(oversized);
    await writeFile(
      path.join(oversized.contracts, `${oversized.wkId}.declared-boundary-observations.json`),
      Buffer.alloc(CONTROLLED_CONTRACT_MAX_JSON_BYTES + 1, 0x20));
    const oversizedCalls = [];
    const oversizedError = await refusal(operationFor(oversized, {
      loadPackageCapabilities: spyCapabilities(oversizedCalls)
    })(request(oversized, DECLARED_BOUNDARY_REQUEST)));
    assert.equal(oversizedError.code, "controlled_contract_carrier_too_large");
    assert.equal(oversizedCalls.filter(
      ({ name }) => name === "mapDeclaredBoundaryCapture").length, 0);
    assert.deepEqual((await manifestState(oversized)).generations, []);
  });

test("repository_store_mutated reports the write event, not persistence eligibility",
  async (t) => {
    const setup = await integrationFixture(t);
    const current = await currentIntegrationProfile();
    const first = await operationFor(setup)(request(setup, current.request));
    const published = await treeSnapshot(setup.repoRoot);
    const replay = await operationFor(setup)(request(setup, current.request));

    assert.equal(first.repository_store_mutated, true);
    assert.equal(replay.repository_store_mutated, false);
    assert.deepEqual(await treeSnapshot(setup.repoRoot), published);

    assert.equal(replay.persisted, true);
    assert.equal(replay.capture.persisted, true);
    assert.equal(replay.capture.generation, first.capture.generation);
    assert.equal(replay.store_observations[0].lifecycle_state, "persisted");
    assert.equal(replay.store_observations[0].currentness_detail.written, false);
    assert.equal(replay.store_observations[0].currentness_detail.no_op, true);

    const boundary = await canonicalFixture(t);
    await withBoundarySlots(boundary);
    const firstBoundary = await operationFor(boundary)(
      request(boundary, DECLARED_BOUNDARY_REQUEST));
    const boundaryTree = await treeSnapshot(boundary.repoRoot);
    const replayBoundary = await operationFor(boundary)(
      request(boundary, DECLARED_BOUNDARY_REQUEST));
    assert.equal(firstBoundary.repository_store_mutated, true);
    assert.equal(replayBoundary.repository_store_mutated, false);
    assert.equal(replayBoundary.persisted, true);
    assert.equal(replayBoundary.capture.persisted, true);
    assert.deepEqual(await treeSnapshot(boundary.repoRoot), boundaryTree);

    const join = await operationFor(boundary, {
      resolveLauncherReceipt: async () => writeConfinementProjection()
    })(request(boundary, WRITE_CONFINEMENT_REQUEST));
    assert.equal(join.repository_store_mutated, false);
    assert.equal(join.persisted, false);
    assert.deepEqual(await treeSnapshot(boundary.repoRoot), boundaryTree);
  });
