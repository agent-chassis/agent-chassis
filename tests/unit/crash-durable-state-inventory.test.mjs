

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CRASH_DURABLE_LIVENESS,
  CRASH_DURABLE_LOCK_STATES,
  classifyLockState,
  decideRelease,
  decideRetirement
} from "../../packages/wiki-core/src/lib/crash-durable-state.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const DURABLE_STORE_WRITER_CENSUS_ARTIFACT_REL = "tests/fixtures/crash-durable-state-writer-census.json";
const LOCK_ARTIFACT = "lock_artifact";
const EXPECTED_DURABLE_STORE_IDS = Object.freeze([
  "canonical-work-record",

  "launcher-supervisor-termination",
  "managed-worker-attempt-journal",
  "managed-worker-attempt-partition-lock",
  "canonical-work-record-write-lock",
  "corrective-integration-chain",
  "exact-slice-review-receipt-journal",
  "exact-slice-review-receipt-store-lock",
  "launcher-durable-state-root",
  "managed-run-process-identity",
  "managed-run-subject-reservation",
  "wk-terminal-disposition-proof",
  "worktree-identity-binding",
  "worktree-provision-lock",
  "worktree-reaper-audit"
]);

const CENSUS = JSON.parse(
  readFileSync(path.join(REPO_ROOT, DURABLE_STORE_WRITER_CENSUS_ARTIFACT_REL), "utf8")
);

const DURABLE = "durable_authoritative";
const UNRESOLVED = "unresolved_authoritative_writer";
const NON_AUTHORITATIVE = "non_authoritative_runtime_or_config";

const EXACT_SOURCE_IDENTITY = /^packages\/[\w.-]+\/src\/[\w./-]+\.mjs#[A-Za-z_$][\w$]*$/u;

const routedWriters = () =>
  CENSUS.writers.filter((writer) => writer.classification !== NON_AUTHORITATIVE);

test("every in-scope authoritative writer declares a routing owner, by exact identity", () => {
  const modes = new Set(CENSUS.routing_modes);
  assert.ok(modes.size > 0, "the census declares a closed routing vocabulary");
  assert.equal(
    CENSUS.routing_owners.publication_helper,
    "packages/wiki-core/src/lib/crash-durable-state.mjs",
    "the retained publication helper is named"
  );
  assert.equal(
    CENSUS.routing_owners.liveness_oracle,
    "packages/agent-launch-cli/src/lib/worktree-lease.mjs",
    "the retained liveness oracle is named"
  );

  const undeclared = [];
  for (const writer of routedWriters()) {
    const routing = CENSUS.routing[writer.source_identity];
    if (!routing) {
      undeclared.push(writer.source_identity);
      continue;
    }
    assert.ok(
      modes.has(routing.routes_through),
      `${writer.source_identity} declares an unknown routing mode: ${routing.routes_through}`
    );
    assert.ok(
      typeof routing.evidence === "string" && routing.evidence.length > 0,
      `${writer.source_identity} must carry source-specific routing evidence`
    );
    assert.match(
      writer.source_identity,
      EXACT_SOURCE_IDENTITY,
      "routing is keyed by an exact <module>#<symbol> identity, never a path or package prefix"
    );
  }

  assert.deepEqual(
    undeclared,
    [],
    "an in-scope authoritative writer bypasses the retained owners with no declared routing"
  );
});

test("the routing table names no writer the census does not carry", () => {
  const censused = new Set(CENSUS.writers.map((writer) => writer.source_identity));
  const stale = Object.keys(CENSUS.routing).filter((identity) => !censused.has(identity));
  assert.deepEqual(
    stale,
    [],
    "a routing declaration outlived its writer; retire it rather than leaving a false claim"
  );

  for (const writer of CENSUS.writers) {
    if (writer.classification !== NON_AUTHORITATIVE) continue;
    assert.equal(
      Object.hasOwn(CENSUS.routing, writer.source_identity),
      false,
      `${writer.source_identity} is non-authoritative and must not claim durable routing`
    );
  }
});

test("exclusions are source-specific and demonstrated, never broad allowlists", () => {
  assert.ok(Array.isArray(CENSUS.examined_and_excluded));
  for (const entry of CENSUS.examined_and_excluded) {
    assert.match(
      entry.source_identity,
      EXACT_SOURCE_IDENTITY,
      `${entry.source_identity} must be an exact source identity; a directory or package allowlist is forbidden`
    );
    assert.ok(
      typeof entry.reason === "string" && entry.reason.length > 20,
      `${entry.source_identity} must demonstrate why it holds no in-scope durable-state authority`
    );
  }

  const censused = new Set(CENSUS.writers.map((writer) => writer.source_identity));
  const shadowed = CENSUS.examined_and_excluded
    .map((entry) => entry.source_identity)
    .filter((identity) => censused.has(identity));
  assert.deepEqual(shadowed, [], "an identity is either a censused writer or an exclusion, never both");
});

test("every abandonment judgment routes through worktree-lease, and non-reclaimers say so", () => {
  assert.equal(
    CENSUS.abandonment_judgments.owner,
    "packages/agent-launch-cli/src/lib/worktree-lease.mjs",
    "worktree-lease is the sole abandonment-judgment owner"
  );
  for (const identity of CENSUS.abandonment_judgments.routed) {
    assert.match(identity, EXACT_SOURCE_IDENTITY, "a routed judgment is named by exact identity");
  }
  for (const entry of CENSUS.abandonment_judgments.never_reclaims) {
    assert.match(entry.source_identity, EXACT_SOURCE_IDENTITY);
    assert.ok(
      typeof entry.reason === "string" && entry.reason.length > 20,
      `${entry.source_identity} must state why it never reclaims instead of silently not doing so`
    );
  }

  const neverReclaims = new Set(
    CENSUS.abandonment_judgments.never_reclaims.map((entry) => entry.source_identity)
  );
  for (const writer of CENSUS.writers) {
    if (writer.artifact_class !== LOCK_ARTIFACT) continue;
    const routing = CENSUS.routing[writer.source_identity];
    assert.ok(
      routing?.routes_through === "crash_durable_token_lock" || neverReclaims.has(writer.source_identity),
      `${writer.source_identity} is a lock artifact with no declared token-lock or non-reclaiming owner`
    );
  }
});

test("the gate covers exactly the frozen differential corpus's durable stores", () => {
  const covered = new Set(routedWriters().map((writer) => writer.store_id));
  assert.deepEqual(
    [...covered].sort(),
    [...EXPECTED_DURABLE_STORE_IDS].sort(),
    "the enforcement gate and the frozen baseline corpus cover the same durable stores"
  );

  const unresolved = CENSUS.writers.filter((writer) => writer.classification === UNRESOLVED);
  assert.deepEqual(
    unresolved.map((writer) => writer.store_id),
    ["wk-terminal-disposition-proof"]
  );
  assert.equal(
    CENSUS.routing[unresolved[0].source_identity].routes_through,
    UNRESOLVED,
    "an unresolved authoritative writer is never declared as routed"
  );
});

test("no package, dependency edge, or package cycle was added", () => {
  const manifest = (name) =>
    JSON.parse(readFileSync(path.join(REPO_ROOT, "packages", name, "package.json"), "utf8"));

  const wikiCore = manifest("wiki-core");
  const launchCore = manifest("agent-launch-core");
  const launchCli = manifest("agent-launch-cli");

  assert.deepEqual(
    Object.keys(wikiCore.dependencies ?? {}).sort(),
    ["@agent-chassis/controlled-contract", "@vscode/tree-sitter-wasm", "ajv", "protobufjs", "web-tree-sitter"],
    "wiki-core gained no dependency by hosting the substrate"
  );
  assert.equal(
    Object.hasOwn(wikiCore.dependencies ?? {}, "@agent-chassis/agent-launch-core"),
    false,
    "wiki-core does not depend back on agent-launch-core"
  );
  assert.equal(
    Object.hasOwn(wikiCore.dependencies ?? {}, "@agent-chassis/agent-launch-cli"),
    false,
    "wiki-core does not depend back on agent-launch-cli"
  );

  assert.ok(Object.hasOwn(launchCore.dependencies ?? {}, "@agent-chassis/wiki-core"));
  assert.ok(Object.hasOwn(launchCli.dependencies ?? {}, "@agent-chassis/wiki-core"));
});

test("the retained lock mechanics fail closed on every non-reclaimable state", () => {
  const contender = "token-contender-0000000000001";
  const held = {
    exists: true,
    kind: "directory",
    ownerEntry: { owner_token: "token-owner-000000000000001", owner_identity: "identity-owner-1" }
  };

  assert.equal(
    decideRetirement({ inspection: held, contenderToken: contender, liveness: CRASH_DURABLE_LIVENESS.DEAD }).retirable,
    true
  );
  for (const liveness of [CRASH_DURABLE_LIVENESS.LIVE, CRASH_DURABLE_LIVENESS.INDETERMINATE, undefined]) {
    assert.equal(
      decideRetirement({ inspection: held, contenderToken: contender, liveness }).retirable,
      false,
      `liveness ${liveness ?? "missing"} must never authorize retirement`
    );
  }

  const shapes = [
    [{ exists: true, kind: "file", ownerEntry: null }, CRASH_DURABLE_LOCK_STATES.LEGACY_REGULAR_FILE],
    [{ exists: true, kind: "directory", ownerEntry: null }, CRASH_DURABLE_LOCK_STATES.LEGACY_OWNERLESS_DIRECTORY],
    [{ exists: true, kind: "directory", ownerEntry: { malformed: true } }, CRASH_DURABLE_LOCK_STATES.MALFORMED],
    [{ exists: false, kind: null, ownerEntry: null }, CRASH_DURABLE_LOCK_STATES.ABSENT]
  ];
  for (const [inspection, expected] of shapes) {
    assert.equal(classifyLockState(inspection), expected);
    assert.equal(
      decideRetirement({ inspection, contenderToken: contender, liveness: CRASH_DURABLE_LIVENESS.DEAD }).retirable,
      false,
      `${expected} must fail closed even with a dead verdict`
    );
  }

  assert.equal(decideRelease({ inspection: held, token: "token-owner-000000000000001" }).releasable, true);
  assert.equal(decideRelease({ inspection: held, token: contender }).releasable, false);
});

test("the accepted whole-checkout-deletion limitation is recorded and not contradicted", () => {
  assert.ok(Array.isArray(CENSUS.accepted_limitations) && CENSUS.accepted_limitations.length > 0);
  const limitation = CENSUS.accepted_limitations.join(" ");
  assert.match(limitation, /whole-checkout deletion/iu);
  assert.match(limitation, /git clean -xd/u);
  assert.match(
    limitation,
    /no in-tree mechanism claims to survive or detect/iu,
    "the limitation is recorded as accepted and unproven, never as survivable or detectable"
  );
});
