

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as barrel from "../packages/agent-launch-cli/src/lib/backend-scope-authority.mjs";
import * as shared from "../packages/agent-launch-cli/src/lib/backend-scope-authority-shared.mjs";
import * as workerScope from "../packages/agent-launch-cli/src/lib/backend-worker-scope-authority.mjs";
import * as terminalLifecycle from
  "../packages/agent-launch-cli/src/lib/backend-terminal-review-lifecycle-authority.mjs";
import * as terminalTarget from
  "../packages/agent-launch-cli/src/lib/backend-terminal-review-target-authority.mjs";
import * as sliceReview from "../packages/agent-launch-cli/src/lib/backend-slice-review-authority.mjs";
import * as integrated from "../packages/agent-launch-cli/src/lib/backend-integrated-scope-authority.mjs";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TESTS_DIR, "..");
const LIB_DIR = "packages/agent-launch-cli/src/lib";
const BARREL_PATH = `${LIB_DIR}/backend-scope-authority.mjs`;

const EXPECTED_BARREL_EXPORTS = Object.freeze([
  "CANONICAL_INTEGRATED_CONTRACT_CLASSIFICATIONS",
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
      "verifyFrozenReceiptObjectsAgainstObjectStore"
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

const MAX_PHYSICAL_LINES = 600;

function physicalLineCount(relativePath) {
  const source = readFileSync(path.join(REPO_ROOT, relativePath), "utf8");

  const lines = source.split("\n");
  return source.endsWith("\n") ? lines.length - 1 : lines.length;
}

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
  assert.ok(!Object.hasOwn(barrel, "runFrozenReviewTargetObjectStoreProbes"),
    "the shared object-store probe runner stays internal to the module family");
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

test("WK-1790 refactor: every resulting production file is under 600 physical lines", () => {
  const counts = RESULTING_PRODUCTION_FILES.map((file) => [file, physicalLineCount(file)]);
  for (const [file, lines] of counts) {
    assert.ok(lines > 0, `${file} must exist and be non-empty`);
    assert.ok(lines < MAX_PHYSICAL_LINES,
      `${file} is ${lines} physical lines; the split requires strictly under ${MAX_PHYSICAL_LINES}`);
  }

  const barrelSource = readFileSync(path.join(REPO_ROOT, BARREL_PATH), "utf8");
  const barrelCode = barrelSource.split("\n").filter((line) => !/^\s*(\/\/|$)/u.test(line));
  assert.ok(barrelCode.every((line) => !/^\s*(export\s+)?(function|const|let|var|class)\s/u.test(line)),
    "the compatibility barrel declares no implementation of its own");
});

test("WK-1790 refactor: no extracted case file is accidentally test-discovered twice", () => {

  const discovered = readdirSync(TESTS_DIR)
    .filter((name) => name.endsWith(".test.mjs"))
    .filter((name) => statSync(path.join(TESTS_DIR, name)).isFile());
  const occurrences = (name) => discovered.filter((entry) => entry === name).length;

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
    assert.ok(!helper.endsWith(".test.mjs"));
    assert.equal(occurrences(helper), 0, `${helper} must not be discovered as a suite`);

    const importers = discovered.filter((name) =>
      name !== "backend-scope-authority-module-boundaries.test.mjs" &&
      readFileSync(path.join(TESTS_DIR, name), "utf8").includes(`"./${helper}"`));
    assert.equal(importers.length, 1, `${helper} is owned by exactly one discovered suite`);
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
    import("../packages/agent-launch-cli/src/lib/backend-review-identity.mjs"),
    import("../packages/agent-launch-cli/src/lib/backend-provisioning-state.mjs"),
    import("../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-scope.mjs"),
    import("../packages/agent-launch-cli/src/lib/backend-worktree-binding.mjs"),
    import("../packages/wiki-mcp/src/lib/dispatch-terminal-review-evidence.mjs")
  ]);
  for (const namespace of loaded) {
    assert.ok(Object.keys(namespace).length > 0, "consumer module evaluated with a live export surface");
  }

  assert.equal(loaded[0].isPlainObject, (await import(
    "../packages/agent-launch-cli/src/lib/backend-review-identity.mjs")).isPlainObject);
  assert.equal(barrel.sameStringArray, shared.sameStringArray);
});
