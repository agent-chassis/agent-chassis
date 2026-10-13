

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadTestCorpus } from "../test-suite-classification.mjs";

import * as barrel from "../../packages/agent-launch-cli/src/lib/backend-scope-authority.mjs";
import * as shared from "../../packages/agent-launch-cli/src/lib/backend-scope-authority-shared.mjs";
import * as workerScope from "../../packages/agent-launch-cli/src/lib/backend-worker-scope-authority.mjs";
import * as terminalLifecycle from
  "../../packages/agent-launch-cli/src/lib/backend-terminal-review-lifecycle-authority.mjs";
import * as terminalTarget from
  "../../packages/agent-launch-cli/src/lib/backend-terminal-review-target-authority.mjs";
import * as sliceReview from "../../packages/agent-launch-cli/src/lib/backend-slice-review-authority.mjs";
import * as integrated from "../../packages/agent-launch-cli/src/lib/backend-integrated-scope-authority.mjs";

const TESTS_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = path.resolve(TESTS_DIR, "..");
const LIB_DIR = "packages/agent-launch-cli/src/lib";
const BARREL_PATH = `${LIB_DIR}/backend-scope-authority.mjs`;

const EXPECTED_BARREL_EXPORTS = Object.freeze([
  "CANONICAL_INTEGRATED_CONTRACT_CLASSIFICATIONS",
  "SLICE_REVIEW_AUTHORITY_CODES",
  "SLICE_REVIEW_AUTHORITY_CODE_GROUPS",
  "SLICE_REVIEW_AUTHORITY_DETAIL_KEYS",
  "SLICE_REVIEW_AUTHORITY_GROUPS",
  "SLICE_REVIEW_AUTHORITY_REASONS",
  "SliceReviewAuthorityError",
  "TERMINAL_REVIEW_LIFECYCLE_INADMISSIBLE_CODE",
  "assertAdmissibleLiveTerminalReviewCoordination",
  "assertFrozenReviewTarget",
  "assertFrozenSliceReviewTarget",
  "assertFrozenTerminalCandidateReviewTarget",
  "assertProvisionedScopeAuthority",
  "assertTerminalReviewMaterializationAttestation",
  "classifyCanonicalIntegratedSliceContract",
  "deepFreezeCanonicalSnapshot",
  "firstOwnField",
  "groupTrustedReviewReceiptsByReviewedIdentity",
  "isTerminalReviewLifecycleRefusal",
  "normalizeAuthenticatedTerminalReviewLifecycleDelta",
  "readCanonicalWorkRecord",
  "resolveCanonicalFindingsOnlyReviewUnit",
  "resolveCanonicalIntegratedSliceState",
  "resolveCanonicalSliceIntegrationUnit",
  "resolveCanonicalSliceReviewUnit",
  "resolveCanonicalTerminalReviewCoordinationState",
  "resolveDeclaredCanonicalFindingsOnlyReviewUnit",
  "resolveFrozenSliceReviewReceiptContract",
  "resolveFrozenWorkerScopeAuthority",
  "sameStringArray",
  "scopeAuthorityRefusal",
  "terminalReviewLifecycleRefusal",
  "trustedReviewReceiptGroupKey",
  "verifyFrozenReceiptObjectsAgainstObjectStore",
  "verifyFrozenSliceReviewTargetAgainstObjectStore",
  "verifyFrozenWkReviewTargetAgainstObjectStore"
]);

const EXTRACTED_MODULES = Object.freeze([
  {
    file: `${LIB_DIR}/backend-scope-authority-shared.mjs`,
    namespace: shared,
    owns: ["scopeAuthorityRefusal", "firstOwnField", "deepFreezeCanonicalSnapshot", "sameStringArray"]
  },
  {
    file: `${LIB_DIR}/backend-worker-scope-authority.mjs`,
    namespace: workerScope,
    owns: ["resolveFrozenWorkerScopeAuthority", "assertProvisionedScopeAuthority", "readCanonicalWorkRecord"]
  },
  {
    file: `${LIB_DIR}/backend-terminal-review-lifecycle-authority.mjs`,
    namespace: terminalLifecycle,
    owns: [
      "resolveCanonicalFindingsOnlyReviewUnit",

      "resolveDeclaredCanonicalFindingsOnlyReviewUnit",
      "TERMINAL_REVIEW_LIFECYCLE_INADMISSIBLE_CODE",
      "terminalReviewLifecycleRefusal",
      "isTerminalReviewLifecycleRefusal",
      "assertAdmissibleLiveTerminalReviewCoordination",
      "normalizeAuthenticatedTerminalReviewLifecycleDelta",
      "resolveCanonicalTerminalReviewCoordinationState"
    ]
  },
  {
    file: `${LIB_DIR}/backend-terminal-review-target-authority.mjs`,
    namespace: terminalTarget,
    owns: [
      "assertFrozenReviewTarget",
      "assertFrozenTerminalCandidateReviewTarget",
      "assertTerminalReviewMaterializationAttestation",
      "verifyFrozenWkReviewTargetAgainstObjectStore"
    ]
  },
  {
    file: `${LIB_DIR}/backend-slice-review-authority.mjs`,
    namespace: sliceReview,
    owns: [
      "assertFrozenSliceReviewTarget",
      "verifyFrozenSliceReviewTargetAgainstObjectStore",
      "resolveCanonicalSliceReviewUnit",
      "resolveCanonicalSliceIntegrationUnit",
      "resolveFrozenSliceReviewReceiptContract",
      "verifyFrozenReceiptObjectsAgainstObjectStore",
      "SliceReviewAuthorityError",
      "SLICE_REVIEW_AUTHORITY_CODES",
      "SLICE_REVIEW_AUTHORITY_CODE_GROUPS",
      "SLICE_REVIEW_AUTHORITY_DETAIL_KEYS",
      "SLICE_REVIEW_AUTHORITY_GROUPS",
      "SLICE_REVIEW_AUTHORITY_REASONS"
    ]
  },
  {
    file: `${LIB_DIR}/backend-integrated-scope-authority.mjs`,
    namespace: integrated,
    owns: [
      "trustedReviewReceiptGroupKey",
      "groupTrustedReviewReceiptsByReviewedIdentity",
      "CANONICAL_INTEGRATED_CONTRACT_CLASSIFICATIONS",
      "classifyCanonicalIntegratedSliceContract",
      "resolveCanonicalIntegratedSliceState"
    ]
  }
]);

const RESULTING_PRODUCTION_FILES = Object.freeze([
  BARREL_PATH,
  ...EXTRACTED_MODULES.map((entry) => entry.file)
]);

function* walkSourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkSourceFiles(full);
    else if (entry.name.endsWith(".mjs")) yield full;
  }
}

test("WK-1790 refactor: the compatibility barrel exposes the exact expected public symbol set", () => {
  assert.deepEqual(Object.keys(barrel).sort(), [...EXPECTED_BARREL_EXPORTS].sort());

  const owned = EXTRACTED_MODULES.flatMap((entry) => entry.owns);
  assert.equal(new Set(owned).size, owned.length, "no symbol is claimed by two modules");
  assert.deepEqual([...owned].sort(), [...EXPECTED_BARREL_EXPORTS].sort());

  assert.equal(typeof terminalTarget.runFrozenReviewTargetObjectStoreProbes, "function");
  assert.equal(typeof terminalTarget.createTerminalCandidateReviewTarget, "function");
  assert.equal(typeof terminalTarget.projectTerminalCandidateReviewTargetReadiness, "function");
  assert.ok(!Object.hasOwn(barrel, "runFrozenReviewTargetObjectStoreProbes"),
    "the shared object-store probe runner stays internal to the module family");
  assert.ok(!Object.hasOwn(barrel, "createTerminalCandidateReviewTarget"),
    "the terminal-candidate constructor has no compatibility barrel alias");
  assert.ok(!Object.hasOwn(barrel, "projectTerminalCandidateReviewTargetReadiness"),
    "the terminal-candidate readiness projection has no compatibility barrel alias");
});

test("WK-1790 refactor: every barrel export is identical to its extracted-module export", () => {
  for (const { file, namespace, owns } of EXTRACTED_MODULES) {
    for (const name of owns) {
      assert.ok(Object.hasOwn(namespace, name), `${file} must export ${name}`);

      assert.equal(barrel[name], namespace[name],
        `barrel ${name} must BE the ${file} export, not a wrapper around it`);
    }
  }

  assert.equal(typeof barrel.resolveFrozenWorkerScopeAuthority, "function");
  assert.equal(typeof barrel.normalizeAuthenticatedTerminalReviewLifecycleDelta, "function");
  assert.equal(barrel.TERMINAL_REVIEW_LIFECYCLE_INADMISSIBLE_CODE,
    "agent_launch.terminal_review_lifecycle.inadmissible.v1");
  assert.ok(Object.isFrozen(barrel.CANONICAL_INTEGRATED_CONTRACT_CLASSIFICATIONS));
});

test("WK-1790 refactor: no extracted case file is accidentally test-discovered twice", () => {

  const discovered = loadTestCorpus({
    repoRoot: REPO_ROOT,
    readFile: (abs) => readFileSync(abs, "utf8"),
    listDir: (abs) => readdirSync(abs, { withFileTypes: true }),
    dirExists: (abs) => existsSync(abs),
  });
  const discoveredPaths = [...discovered.unit, ...discovered.integration];
  const occurrences = (base) =>
    discoveredPaths.filter((rel) => path.basename(rel) === base).length;

  assert.equal(occurrences("backend-scope-authority-module-boundaries.test.mjs"), 1,
    "this regression is discovered exactly once");

  for (const file of RESULTING_PRODUCTION_FILES) {
    const base = path.basename(file);
    assert.ok(!base.endsWith(".test.mjs"), `${file} must not be named as a test`);
    assert.equal(occurrences(base), 0, `${file} must not be test-discovered`);
    assert.ok(!path.resolve(REPO_ROOT, file).startsWith(TESTS_DIR + path.sep),
      `${file} is production source, not a test fixture`);
  }

  for (const helper of [
    "workspace-agent-corrective-continuation-structural-cases.mjs",
    "workspace-agent-corrective-continuation-base-cases.mjs"
  ]) {
    assert.equal(existsSync(path.join(TESTS_DIR, helper)), false, `${helper} stays retired`);
    assert.equal(occurrences(helper), 0, `${helper} must not be discovered as a suite`);

    const importers = discoveredPaths.filter((rel) =>
      path.basename(rel) !== "backend-scope-authority-module-boundaries.test.mjs" &&
      readFileSync(path.join(REPO_ROOT, rel), "utf8").includes(`/${helper}"`));
    assert.equal(importers.length, 0, `${helper} has no discovered corrective owner`);
  }
});

test("WK-1790 refactor: the original import path remains loadable by existing consumers", async () => {

  const importRe =
    /import\s*\{([^}]*)\}\s*from\s*"[^"]*backend-scope-authority\.mjs"/gsu;
  const consumers = [];
  for (const dir of ["packages", "tests"]) {
    for (const file of walkSourceFiles(path.join(REPO_ROOT, dir))) {
      const relative = path.relative(REPO_ROOT, file);
      if (relative === BARREL_PATH) continue;
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(importRe)) {
        const names = match[1].split(",").map((entry) => entry.trim()).filter(Boolean);
        if (names.length !== 0) consumers.push({ relative, names });
      }
    }
  }
  assert.ok(consumers.length >= 15,
    `expected the pre-split path to still have many consumers, found ${consumers.length}`);
  for (const { relative, names } of consumers) {
    for (const name of names) {
      assert.ok(Object.hasOwn(barrel, name),
        `${relative} imports ${name} from the compatibility barrel, which no longer exports it`);
    }
  }

  const loaded = await Promise.all([
    import("../../packages/agent-launch-cli/src/lib/backend-review-identity.mjs"),
    import("../../packages/agent-launch-cli/src/lib/backend-provisioning-state.mjs"),
    import("../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-scope.mjs"),
    import("../../packages/agent-launch-cli/src/lib/backend-worktree-binding.mjs"),
    import("../../packages/wiki-mcp/src/lib/dispatch-terminal-review-evidence.mjs")
  ]);
  for (const namespace of loaded) {
    assert.ok(Object.keys(namespace).length > 0, "consumer module evaluated with a live export surface");
  }

  assert.equal(loaded[0].isPlainObject, (await import(
    "../../packages/agent-launch-cli/src/lib/backend-review-identity.mjs")).isPlainObject);
  assert.equal(barrel.sameStringArray, shared.sameStringArray);
});

test("WK-2347 shared bootstrap keeps provisioning ownership out of the binding consumer", () => {
  const source = (name) => readFileSync(path.join(REPO_ROOT, LIB_DIR, name), "utf8");
  const binding = source("backend-worktree-binding.mjs");
  const scope = source("workspace-agent-dispatch-backend-scope.mjs");
  const managed = source("worktree-provisioning-dispatch-managed.mjs");
  const reconcile = source("worktree-substrate-exact-unit-reconcile.mjs");

  assert.doesNotMatch(binding,
    /provisionManagedWkLifecycleAtDispatch|provisionManagedWorktreesAtDispatch|allocateOrAdoptExactUnitWorktree|persistControlledContractGeneration/u);
  assert.match(binding, /admitEstablished/u,
    "the binding boundary consumes an already-established worker carrier");
  assert.match(scope, /bootstrapManagedWkLifecycle/u);
  assert.ok(
    managed.indexOf("establishManagedWkLifecycleLocked") <
      managed.indexOf("classifyEarlySliceTip({"),
    "the shared persistent-WK owner must finish before worker-only slice reconciliation"
  );
  assert.doesNotMatch(reconcile,
    /persistControlledContractGeneration|establish_persistent_wk_lifecycle_ref|workspace_agent|spawn\s*\(/u,
    "the exact-slice continuation remains a Git-topology projection, not a second bootstrap owner"
  );
});
