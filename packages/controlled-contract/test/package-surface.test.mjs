import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from
  "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  TASK_RESULT_PROJECTION_VOCABULARY,
  TASK_RESULT_SNAPSHOT_DEFAULTS,
  TaskResultSnapshotError,
  createTaskResultSnapshotRegistry,
  defineTaskResultCollectionDescriptors,
  taskResultPageAccounting,
  taskResultScalarRangeAccounting
} from "../current.mjs";

const packageRoot = path.resolve(import.meta.dirname, "..");
const agentLaunchPackageRoot = path.resolve(packageRoot, "../agent-launch-cli");
const execFileAsync = promisify(execFile);

function childEnvironment() {
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  return environment;
}

async function filesBelow(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(entryPath));
    else result.push(entryPath);
  }
  return result;
}

test("the published package exposes bounded assessment and selection commands and no development surface", async () => {
  const manifest = JSON.parse(await readFile(
    path.join(packageRoot, "package.json"), "utf8"
  ));
  assert.deepEqual(manifest.exports["."], {
    types: "./current.d.mts",
    default: "./current.mjs"
  });
  assert.deepEqual(manifest.exports["./current.mjs"],
    manifest.exports["."]);
  assert.deepEqual(manifest.exports["./assessment-recovery"], {
    types: "./lib/assessment-recovery.d.mts",
    default: "./lib/assessment-recovery.mjs"
  });
  assert.equal(
    manifest.exports[
      "./schema/controlled-contract-component-exclusion-applicability.v2.schema.json"
    ],
    "./schema/controlled-contract-component-exclusion-applicability.v2.schema.json"
  );
  assert.deepEqual(manifest.bin, {
    "controlled-contract": "bin/assess-contract.mjs",
    "controlled-contract-build-proof-plan": "bin/build-proof-plan.mjs",
    "controlled-contract-derive-declared-boundary-record-consistency":
      "bin/derive-declared-boundary-record-consistency.mjs",
    "controlled-contract-derive-declared-limit-guidance-propagation":
      "bin/derive-declared-limit-guidance-propagation.mjs",
    "controlled-contract-derive-lexicographic-conformance":
      "bin/derive-lexicographic-conformance.mjs",
    "controlled-contract-describe-proof-pack": "bin/describe-proof-pack.mjs",
    "controlled-contract-discover-proof-intents": "bin/discover-proof-intents.mjs",
    "controlled-contract-inspect-proof-pack-bindings":
      "bin/inspect-proof-pack-bindings.mjs",
    "controlled-contract-select-proof-packs": "bin/select-proof-packs.mjs"
  });
  const published = manifest.files.join("\n");
  for (const excluded of [
    "experimental/", "versions/", "test/**", "adequacy.json",
    "negative-fixtures", "witness-profile-weakenings",
    "controlled-contract-assessment.experimental.v0.1.schema.json"
  ]) assert.doesNotMatch(published, new RegExp(excluded.replace("*", "\\*"), "u"));
  assert.equal(
    manifest.files.includes("schema/controlled-contract-assessment.v1.schema.json"),
    true
  );
  for (const required of [
    "bin/derive-declared-boundary-record-consistency.mjs",
    "bin/derive-declared-limit-guidance-propagation.mjs",
    "bin/derive-lexicographic-conformance.mjs",
    "current.d.mts",
    "lib/assessment-recovery.d.mts",
    "lib/assessment-recovery.mjs",
    "lib/acceptance-coverage-identity.mjs",
    "lib/acceptance-coverage.mjs",
    "lib/acceptance-coverage-projection.mjs",
    "lib/obligation-coverage-carrier.mjs",
    "lib/obligation-coverage-guarantee-selectors.mjs",
    "lib/deterministic-lexicographic-ordering.mjs",
    "lib/declared-boundary-record-consistency.mjs",
    "lib/declared-limit-guidance-propagation.mjs",
    "lib/sound-negative-observation-projection.mjs",
    "lib/caller-input-authority-confinement-projection.mjs",
    "proof-intents/catalog.json",
    "schema/controlled-contract-proof-intent-catalog.v2.schema.json",
    "schema/controlled-contract-proof-intent-discovery.v1.schema.json",
    "schema/controlled-contract-proof-pack-binding-assistance.v1.schema.json",
    "schema/controlled-contract-proof-pack-authoring.v2.schema.json",
    "schema/controlled-contract-proof-plan-request.v1.schema.json",
    "schema/controlled-contract-proof-plan.v1.schema.json",
    "schema/controlled-contract-multi-pack-assessment.v2.schema.json",
    "schema/controlled-contract-component-exclusion-applicability.v2.schema.json",
    "schema/controlled-contract-obligation-coverage.v3.schema.json"
  ]) assert.equal(manifest.files.includes(required), true, required);
  assert.equal(
    manifest.files.includes("lib/deterministic-projection.mjs"),
    true,
    "the package-owned deterministic transformer must ship with admitted users"
  );
  const topLevelDirectories = (await readdir(packageRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map(({ name }) => name);
  for (const retired of ["experimental", "versions", "docs", "prompts"]) {
    assert.equal(topLevelDirectories.includes(retired), false);
  }
});

test("runtime profiles contain only compact admitted artifacts", async () => {
  const profilesRoot = path.join(packageRoot, "profiles");
  const catalog = JSON.parse(await readFile(
    path.join(profilesRoot, "catalog.json"), "utf8"
  ));
  for (const pack of catalog.packs) {
    const directory = path.join(packageRoot, pack.path);
    const admission = JSON.parse(await readFile(
      path.join(directory, "admission.json"), "utf8"
    ));
    const names = (await readdir(directory)).sort();
    const expected = [
      "admission.json", "evaluation-input.template.json", "parameter-contract.json", "profile.json"
    ];
    if (pack.profile_id === "proof.verification.test-validity") expected.push("evaluator.mjs");
    if (pack.profile_id === "proof.design.implementation-readiness" &&
        pack.profile_version === "4.0.0") {
      expected.push("component-exclusion-applicability.json");
    }
    expected.sort();
    assert.deepEqual(names, expected, pack.profile_id);
  }
  assert.ok(catalog.packs.length > 0);
});

test("current packaged proof bindings reject historical and stale identities", async (t) => {
  const { loadExactAdmittedProofPack } = await import("../lib/admitted-proof-packs.mjs");
  const catalog = JSON.parse(await readFile(
    path.join(packageRoot, "profiles/catalog.json"), "utf8"
  ));
  const identities = catalog.packs.map(
    ({ profile_id: id, profile_version: version }) => `${id}@${version}`
  );
  assert.equal(new Set(identities).size, identities.length);
  const current = catalog.packs.find(
    ({ profile_id: id }) => id === "proof.verification.test-validity"
  );
  assert.ok(current);
  const admitted = await loadExactAdmittedProofPack({
    profileId: current.profile_id,
    profileVersion: current.profile_version
  });
  assert.equal(admitted.test_validity_evaluator.status, "resolved");
  assert.equal(admitted.test_validity_evaluator.implementation_digest,
    "sha256:8aff870dc00038e340e6e9bf889eb2c8f74b2f8b1fd70024fd54994b90cee90f");
  for (const profileVersion of ["7.0.0", "9.0.0"]) {
    await assert.rejects(loadExactAdmittedProofPack({
      profileId: current.profile_id,
      profileVersion
    }), { code: "proof_pack_exact_version_not_current" });
  }

  const { stdout } = await execFileAsync("npm", [
    "pack", "--dry-run", "--json", "--ignore-scripts"
  ], { cwd: packageRoot, env: childEnvironment(), maxBuffer: 4 * 1024 * 1024 });
  const names = new Set(JSON.parse(stdout)[0].files.map(({ path: file }) => file));
  assert.equal(names.has("lib/proof-evaluator-registry.mjs"), true);
  assert.equal(names.has(`${current.path}/evaluator.mjs`), true);
  assert.equal(names.has(
    "profiles/proof.verification.test-validity/7.0.0/evaluator.mjs"), true);
  assert.equal([...names].some((name) => /(?:^|\/)test(?:\/|$)|certification/u.test(name)),
    false);

  const temporary = await mkdtemp(path.join(os.tmpdir(), "wk2568-stale-pack-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const copiedPackage = path.join(temporary, "controlled-contract");
  await cp(packageRoot, copiedPackage, { recursive: true });
  await symlink(path.resolve(packageRoot, "../../node_modules"),
    path.join(copiedPackage, "node_modules"), "dir");
  const admissionPath = path.join(copiedPackage, current.path, "admission.json");
  const staleAdmission = JSON.parse(await readFile(admissionPath, "utf8"));
  staleAdmission.profile_digest = "0".repeat(64);
  await writeFile(admissionPath, `${JSON.stringify(staleAdmission, null, 2)}\n`);
  const copiedLoader = await import(
    `${pathToFileURL(path.join(copiedPackage, "lib/admitted-proof-packs.mjs")).href}?stale=1`
  );
  await assert.rejects(copiedLoader.loadExactAdmittedProofPack({
    profileId: current.profile_id,
    profileVersion: current.profile_version
  }), { code: "proof_pack_admission_binding_mismatch" });
});

test("the public current surface exposes selection and zero/one/many assessment", async () => {
  const current = await import("../current.mjs");
  for (const name of [
    "TASK_RESULT_PROJECTION_VOCABULARY",
    "defineTaskResultCollectionDescriptors",
    "taskResultPageAccounting",
    "taskResultScalarRangeAccounting",
    "TASK_RESULT_SNAPSHOT_DEFAULTS",
    "TaskResultSnapshotError",
    "createTaskResultSnapshotRegistry"
  ]) assert.ok(Object.hasOwn(current, name), name);
  assert.equal(typeof current.defineTaskResultCollectionDescriptors, "function");
  assert.equal(typeof current.taskResultPageAccounting, "function");
  assert.equal(typeof current.taskResultScalarRangeAccounting, "function");
  assert.equal(typeof current.TaskResultSnapshotError, "function");
  assert.equal(typeof current.createTaskResultSnapshotRegistry, "function");
  assert.equal(TASK_RESULT_PROJECTION_VOCABULARY.semantic_scope, "task_relevant_public");
  assert.equal(typeof TASK_RESULT_SNAPSHOT_DEFAULTS.maximum_bytes, "number");
  assert.equal(typeof TaskResultSnapshotError, "function");
  assert.equal(typeof createTaskResultSnapshotRegistry, "function");
  assert.equal(typeof defineTaskResultCollectionDescriptors, "function");
  assert.equal(typeof taskResultPageAccounting, "function");
  assert.equal(typeof taskResultScalarRangeAccounting, "function");
  assert.equal(typeof current.assessContractFiles, "function");
  assert.equal(typeof current.assessStructuralContractFile, "function");
  assert.equal(typeof current.selectProofPacks, "function");
  assert.equal(typeof current.discoverProofIntents, "function");
  assert.equal(typeof current.canonicalProofIntentDiscoveryJson, "function");
  assert.equal(typeof current.inspectProofPackBindings, "function");
  assert.equal(typeof current.canonicalProofPackBindingAssistanceJson, "function");
  assert.equal(typeof current.buildProofPlan, "function");
  assert.equal(typeof current.buildProofPlanFiles, "function");
  assert.equal(typeof current.canonicalProofPlanJson, "function");
  assert.equal(typeof current.describeProofPackAuthoring, "function");
  assert.equal(typeof current.assessProofPlan, "function");
  assert.equal(typeof current.assessProofPlanFiles, "function");
  assert.equal(typeof current.buildControlledContractAssessmentRecovery, "function");
  assert.equal(typeof current.ControlledContractAssessmentRecoveryError, "function");
  assert.equal(typeof current.canonicalEvaluationFilename, "function");
  assert.equal(current.canonicalEvaluationFilename("WK-2196", null),
    "WK-2196.evaluation-input.json");
  assert.equal(current.canonicalEvaluationFilename("WK-2196", "focused-case"),
    "WK-2196-focused-case.evaluation-input.json");
  assert.equal(typeof current.assertComponentExclusionApplicability, "function");
  assert.equal(typeof current.assertSoundNegativeObservationCapture, "function");
  assert.equal("deriveSoundNegativeObservationCapture" in current, false);
  assert.equal(typeof current.assertCallerInputAuthorityConfinementCapture, "function");
  assert.equal("deriveCallerInputAuthorityConfinementCapture" in current, false);
  assert.equal(typeof current.deriveDeclaredBoundaryRecordConsistency, "function");
  assert.equal(typeof current.deriveCriterionIdentitySet, "function");
  assert.equal(typeof current.compareCriterionIdentitySets, "function");
  assert.equal(typeof current.evaluateAcceptanceCoverage, "function");
  assert.equal(typeof current.isAcceptanceCoverageComplete, "function");
  assert.equal(typeof current.projectAcceptanceCoverage, "function");
  assert.equal(typeof current.validateObligationCoverageCarrier, "function");
  assert.equal(typeof current.buildObligationGuaranteeSelectorIndex, "function");
  assert.equal(typeof current.resolveObligationGuaranteeSelector, "function");
  assert.deepEqual(current.OBLIGATION_COVERAGE_OUTCOMES, ['stale', 'explicit_gap', 'design_invalid', 'selected']);
  assert.equal(typeof current.describeStableTestProofAuthoring, "function");
  assert.equal(typeof current.queryStableTestProofBindings, "function");
  assert.equal(typeof current.replaceStableTestProofBindings, "function");
  assert.equal(typeof current.resolveStableTestProofProviderBindings, "function");
  assert.match(current.TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
    /^sha256:[a-f0-9]{64}$/u);
  assert.equal(typeof current.assessTestProofContract, "function");
  assert.equal("createSinglePackProofPlan" in current, false);
});

test("the public current declaration exposes discovery types and values", async () => {
  const declaration = await readFile(
    path.join(packageRoot, "current.d.mts"), "utf8"
  );
  for (const name of [
    "TASK_RESULT_PROJECTION_VOCABULARY",
    "TaskResultCollectionDescriptor",
    "defineTaskResultCollectionDescriptors",
    "TaskResultPageAccounting",
    "taskResultPageAccounting",
    "TaskResultScalarRangeAccounting",
    "taskResultScalarRangeAccounting",
    "TASK_RESULT_SNAPSHOT_DEFAULTS",
    "TaskResultSnapshotError",
    "TaskResultSnapshotRegistry",
    "createTaskResultSnapshotRegistry",
    "ProofIntentDiscoveryError",
    "canonicalProofIntentDiscoveryJson",
    "discoverProofIntents",
    "ProofPackBindingAssistanceError",
    "canonicalProofPackBindingAssistanceJson",
    "inspectProofPackBindings",
    "ProofPlanCompilerError",
    "ControlledContractAssessmentRecoveryError",
    "buildControlledContractAssessmentRecovery",
    "ComponentExclusionApplicability",
    "ComponentExclusionApplicabilityComponent",
    "ComponentExclusionApplicabilitySelectorKind",
    "ComponentExclusionApplicabilityValidationResult",
    "assertComponentExclusionApplicability",
    "buildProofPlan",
    "buildProofPlanFiles",
    "canonicalProofPlanJson",
    "deriveDeclaredBoundaryRecordConsistency",
    "AcceptanceCoverageState",
    "AcceptanceCoverageCriterionIdentitySet",
    "AcceptanceCoverageEvaluationResult",
    "AcceptanceCoverageProjectionResult",
    "projectAcceptanceCoverage",
    "ObligationCoverageCarrier",
    "ObligationCoverageOutcome",
    "ObligationCoverageEvaluationResult",
    "ObligationCoverageProjectionResult",
    "validateObligationCoverageCarrier",
    "buildObligationGuaranteeSelectorIndex",
    "resolveObligationGuaranteeSelector",
    "describeStableTestProofAuthoring",
    "queryStableTestProofBindings",
    "resolveStableTestProofBindingPopulation",
    "replaceStableTestProofBindings",
    "resolveStableTestProofProviderBindings",
    "TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST",
    "assessTestProofContract",
    "ProofAuthoringError", "assertProofAuthoringDraft"
  ]) assert.match(declaration, new RegExp(`\\b${name}\\b`, "u"), name);
  for (const name of [
    "deriveSoundNegativeObservationCapture",
    "deriveCallerInputAuthorityConfinementCapture"
  ]) assert.doesNotMatch(declaration, new RegExp(`\\b${name}\\b`, "u"), name);
});

test("published runtime modules cannot import certification or test code", async () => {
  const sources = [
    ...await filesBelow(path.join(packageRoot, "lib")),
    path.join(packageRoot, "bin", "assess-contract.mjs"),
    path.join(packageRoot, "bin", "build-proof-plan.mjs"),
    path.join(packageRoot, "bin", "discover-proof-intents.mjs"),
    path.join(packageRoot, "bin", "inspect-proof-pack-bindings.mjs"),
    path.join(packageRoot, "bin", "describe-proof-pack.mjs"),
    path.join(packageRoot, "bin", "select-proof-packs.mjs"),
    path.join(packageRoot, "bin", "check-contract.mjs"),
    path.join(packageRoot, "current.mjs")
  ].filter((file) => file.endsWith(".mjs"));
  for (const file of sources) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /(?:^|["'])\.\.\/test\//mu, file);
    assert.doesNotMatch(source, /test\/certification|negative-fixtures|coverage-witness/u,
      file);
  }
});

test("the publication dry run ships discovery runtime and excludes test corpora", async () => {
  const { stdout } = await execFileAsync("npm", [
    "pack", "--dry-run", "--json", "--ignore-scripts"
  ], {
    cwd: packageRoot,
    env: childEnvironment(),
    maxBuffer: 4 * 1024 * 1024
  });
  const publication = JSON.parse(stdout)[0];
  const names = new Set(publication.files.map(({ path: file }) => file));
  for (const required of [
    "current.d.mts",
    "lib/assessment-recovery.d.mts",
    "lib/assessment-recovery.mjs",
    "bin/discover-proof-intents.mjs",
    "lib/proof-intent-discovery.mjs",
    "lib/proof-intent-discovery.d.mts",
    "schema/controlled-contract-proof-intent-discovery.v1.schema.json",
    "bin/inspect-proof-pack-bindings.mjs",
    "lib/proof-pack-binding-assistance.mjs",
    "lib/proof-pack-binding-assistance.d.mts",
    "schema/controlled-contract-proof-pack-binding-assistance.v1.schema.json",
    "bin/build-proof-plan.mjs",
    "lib/proof-plan-compiler.mjs",
    "lib/proof-plan-compiler.d.mts",
    "schema/controlled-contract-proof-plan-request.v1.schema.json",
    "schema/controlled-contract-component-exclusion-applicability.v2.schema.json",
    "lib/acceptance-coverage-identity.mjs",
    "lib/acceptance-coverage.mjs",
    "lib/acceptance-coverage-projection.mjs",
    "lib/obligation-coverage-carrier.mjs",
    "lib/obligation-coverage-guarantee-selectors.mjs",
    "lib/native-contract-carrier-v1.mjs",
    "lib/test-proof-contract-v1.mjs",
    "lib/test-proof-provider-registry.mjs",
    "schema/controlled-acceptance-contract.v1.schema.json",
    "schema/controlled-contract-obligation-coverage.v3.schema.json",
    "schema/controlled-contract-test-proof-runtime-evidence.v2.schema.json",
    "lib/test-proof-assessment.mjs",
    "schema/controlled-contract-assessment.v2.schema.json",
    "profiles/proof.verification.test-validity/7.0.0/evaluator.mjs",
    "profiles/proof.design.implementation-readiness/4.0.0/admission.json",
    "profiles/proof.design.implementation-readiness/4.0.0/component-exclusion-applicability.json",
    "profiles/proof.design.implementation-readiness/4.0.0/evaluation-input.template.json",
    "profiles/proof.design.implementation-readiness/4.0.0/profile.json"
  ]) assert.equal(names.has(required), true, required);
  for (const name of names) {
    assert.doesNotMatch(name, /(?:^|\/)test(?:\/|$)/u);
    assert.doesNotMatch(name, /(?:^|\/)certification(?:\/|$)/u);
    assert.doesNotMatch(name,
      /negative-fixtures|coverage-witness|adequacy\.json/u);
    assert.doesNotMatch(name,
      /(?:adequacy|fixture|witness|corpus)[^/]*\.mjs$/u);
  }
});

test("an isolated packed public current entrypoint loads its complete runtime closure",
  async (t) => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "cc-current-pack-"));
    t.after(() => rm(temporary, { recursive: true, force: true }));
    const { stdout } = await execFileAsync("npm", [
      "pack", "--json", "--ignore-scripts", "--pack-destination", temporary,
      "--cache", path.join(temporary, "npm-cache")
    ], {
      cwd: packageRoot,
      env: childEnvironment(),
      maxBuffer: 4 * 1024 * 1024
    });
    const [packed] = JSON.parse(stdout);
    const consumerRoot = path.join(temporary, "consumer");
    await mkdir(consumerRoot);

    await mkdir(path.join(consumerRoot, ".git"));
    await execFileAsync("tar", [
      "-xzf", path.join(temporary, packed.filename), "-C", consumerRoot
    ]);
    const installedPackage = path.join(consumerRoot, "package");
    await symlink(
      path.resolve(packageRoot, "../../node_modules"),
      path.join(installedPackage, "node_modules"),
      "dir"
    );
    const entrypoint = pathToFileURL(
      path.join(installedPackage, "current.mjs")
    ).href;
    await execFileAsync(process.execPath, [
      "--input-type=module",
      "--eval",
      "await import(process.argv[1]);",
      entrypoint
    ], {
      cwd: consumerRoot,
      env: childEnvironment(),
      maxBuffer: 4 * 1024 * 1024
    });
  });

test("the packed package root excludes experimental producers and preserves stable exports",
  async (t) => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "cc-root-pack-"));
    t.after(() => rm(temporary, { recursive: true, force: true }));
    const { stdout } = await execFileAsync("npm", [
      "pack", "--json", "--ignore-scripts", "--pack-destination", temporary,
      "--cache", path.join(temporary, "npm-cache")
    ], {
      cwd: packageRoot,
      env: childEnvironment(),
      maxBuffer: 4 * 1024 * 1024
    });
    const [packed] = JSON.parse(stdout);
    const extractRoot = path.join(temporary, "extract");
    await mkdir(extractRoot);
    await execFileAsync("tar", [
      "-xzf", path.join(temporary, packed.filename), "-C", extractRoot
    ]);
    const extractedPackage = path.join(extractRoot, "package");
    await symlink(
      path.resolve(packageRoot, "../../node_modules"),
      path.join(extractedPackage, "node_modules"),
      "dir"
    );
    const [sourceRoot, packedRoot] = await Promise.all([
      import("../current.mjs"),
      import(pathToFileURL(path.join(extractedPackage, "current.mjs")).href)
    ]);
    assert.deepEqual(Object.keys(packedRoot), Object.keys(sourceRoot));
    for (const name of [
      "deriveSoundNegativeObservationCapture",
      "deriveCallerInputAuthorityConfinementCapture"
    ]) assert.equal(name in packedRoot, false, name);
    assert.equal(typeof packedRoot.deriveDeclaredBoundaryRecordConsistency, "function");
    for (const root of [sourceRoot, packedRoot]) {
      assert.equal(root.canonicalEvaluationFilename("WK-2196", null),
        "WK-2196.evaluation-input.json");
      assert.equal(root.canonicalEvaluationFilename("WK-2196", "focused-case"),
        "WK-2196-focused-case.evaluation-input.json");
    }
    const selection = { ...await sourceRoot.pinProofSelection('proof.verification.test-validity'), parameters: {} };

    assert.equal('resolveProofAuthoring' in sourceRoot, false);
    const { resolveProofAuthoring } = await import('../lib/proof-authoring-resolution.mjs');
    const resolved = await resolveProofAuthoring({
      schema_version: 'controlled-contract-obligation-coverage.v3', wk_id: 'WK-2095',
      selected_unit: null, focus: null, obligations: [{ obligation_id: 'OBL-001',
        statement: 'Expose one exact package root behavior.', selection,
        gap: { gap_kind: 'review_only', reason: 'Package import does not execute proof.' } }]
    }, { source_digest: `sha256:${'a'.repeat(64)}` });
    const carrier = resolved.mapping;
    for (const root of [sourceRoot, packedRoot]) {
      assert.deepEqual(root.assertComponentExclusionApplicability(
        null, {}, {}
      ), {
        component_exclusion_applicability: null,
        component_exclusion_applicability_digest: null
      });
      assert.equal(root.validateObligationCoverageCarrier(carrier).valid, true);
      const evaluation = root.evaluateAcceptanceCoverage({
        obligationCoverage: carrier
      });
      assert.equal(evaluation.obligation_outcomes[0].outcome, "explicit_gap");
      assert.equal(root.projectAcceptanceCoverage({ evaluation }).totals.total, 1);
    }
  });

test("the launcher publication ships the closed test-proof provider runtime", async () => {
  const { stdout } = await execFileAsync("npm", [
    "pack", "--dry-run", "--json", "--ignore-scripts"
  ], {
    cwd: agentLaunchPackageRoot,
    env: childEnvironment(),
    maxBuffer: 8 * 1024 * 1024
  });
  const names = new Set(JSON.parse(stdout)[0].files.map(({path: file}) => file));
  for (const required of [
    "src/lib/workspace-agent-test-proof-provider-registry.mjs",
    "src/lib/workspace-agent-test-proof-evidence.mjs",
    "src/lib/workspace-agent-test-proof-node-observation.mjs",
    "src/lib/workspace-agent-test-proof-node-reporter.mjs",
    "src/lib/workspace-agent-test-proof-module-fault-contract.mjs",
    "src/lib/workspace-agent-test-proof-module-fault-loader.mjs",
    "src/lib/workspace-agent-validation-runner.mjs"
  ]) assert.equal(names.has(required), true, required);
});
