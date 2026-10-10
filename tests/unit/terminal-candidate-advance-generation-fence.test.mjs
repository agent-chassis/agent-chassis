import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  advanceSelectedTerminalCandidate,
  projectTerminalCandidateAdvanceFailure,
  TERMINAL_CANDIDATE_RUNTIME_CODES,
  TerminalCandidateRuntimeError
} from "../../packages/wiki-mcp/src/lib/dispatch-terminal-candidate-runtime.mjs";

const runtime = readFileSync(new URL(
  "../../packages/wiki-mcp/src/lib/dispatch-terminal-candidate-runtime.mjs",
  import.meta.url
), "utf8");

function advanceBody() {
  const start = runtime.indexOf("async function advanceCandidatePipeline");
  assert.ok(start >= 0);
  return runtime.slice(start);
}

test("advance authenticates complete current generation before freezing W inputs", () => {
  const body = advanceBody();
  const authenticate = body.indexOf(
    "const generationAuthentication = await authenticateAdvanceGeneration({");
  const freeze = body.indexOf("freezeTerminalWkCandidateInputs({");
  assert.ok(authenticate >= 0);
  assert.ok(freeze > authenticate);

  const initial = body.slice(authenticate, freeze);
  assert.match(initial, /expectation: \{ expectedWkTipSha: snapshot\.currentW \}/u);
  assert.equal(initial.includes("expectedGeneration"), false);
  assert.match(body, /generationAuthentication,\s*\n\s*runGit/u);
});

test("generation is re-authenticated after derivation and before candidate CAS", () => {
  const body = advanceBody();
  const derive = body.indexOf("const derived = await derive({ frozen, runGit });");
  const finalAuth = body.indexOf("await authenticateAdvanceGeneration({", derive);
  const cas = body.indexOf("const published = await publish({");
  assert.ok(derive >= 0);
  assert.ok(finalAuth > derive);
  assert.ok(cas > finalAuth);

  assert.match(body.slice(finalAuth, cas),
    /expectedWkTipSha: snapshot\.currentW,\s*expectedGeneration: generationAuthentication\s*\}/u);

  assert.match(runtime,
    /await authenticateCurrentControlledContractGenerationAtW\(\{\s*repoRoot: mainRepo, wkId, \.\.\.expectation, deps: \{ runGit \}\s*\}\)/u);
  assert.equal(runtime.includes("controlled-contract-resolved-generation.v1"), false);
});

test("candidate CAS remains bound to the evaluator snapshot and exact B/W refs", () => {
  const body = advanceBody();
  const publish = body.indexOf("const published = await publish({");
  const returned = body.indexOf("return Object.freeze({", publish);
  assert.ok(publish >= 0, "advance must await the current publication/CAS owner");
  assert.ok(returned > publish, "advance must not return before publication/CAS settles");
  assert.match(body, /expectedOld:\s*snapshot\.candidate/u);
  assert.match(body, /\{ ref: snapshot\.forkRef, oid: snapshot\.base \}/u);
  assert.match(body, /\{ ref: snapshot\.wkRef, oid: snapshot\.currentW \}/u);
});

test("advance adopts no snapshot for a status lookalike and reaches no owner", async () => {
  const reached = [];
  const backend = {
    async withTerminalCandidateAdvanceExclusion({ evaluateTerminalReviewCandidateStatus, run }) {
      return run(await evaluateTerminalReviewCandidateStatus());
    }
  };
  const owner = (name) => async () => { reached.push(name); throw new Error(name); };
  await assert.rejects(
    advanceSelectedTerminalCandidate({
      mainRepo: "/missing-fixture",
      wkId: "WK-2271",
      version: "a".repeat(64),
      backend,
      dependencies: {
        evaluateTerminalReviewCandidateStatus: async () => ({ state: "candidate_stale_w" }),
        authoritySnapshot: () => Object.freeze({ currentW: "a".repeat(40), candidate: "b".repeat(40) }),
        authenticateHistoricalTerminalCandidate: owner("authenticate"),
        deriveTerminalWkCandidate: owner("derive"),
        publishTerminalWkCandidateVersion: owner("publish")
      }
    }),
    (error) => {
      assert.ok(error instanceof TerminalCandidateRuntimeError);
      assert.equal(error.code, TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_NOT_STALE);
      assert.deepEqual(projectTerminalCandidateAdvanceFailure(error), {
        stage: "selection", requested_version: "a".repeat(64), source: null, target: null,
        derived_candidate: null, ref_transaction_attempted: false
      });
      return true;
    }
  );
  assert.deepEqual(reached, []);
  assert.equal(runtime.includes("dependencies.authoritySnapshot"), false);
  assert.equal(/export[^\n]*statusAuthoritySnapshots/u.test(runtime), false);
});

test("the requested version is authenticated inside the exclusion and is equality-only", () => {
  const body = advanceBody();
  const run = body.indexOf("run: async (inside) => {");
  const authenticate = body.indexOf("await authenticateHistoricalTerminalCandidate({");
  const equality = body.indexOf("selected.binding.candidate !== snapshot.candidate");
  const generation = body.indexOf("const generationAuthentication = await authenticateAdvanceGeneration({");
  assert.ok(run >= 0 && authenticate > run && equality > authenticate && generation > equality);
  assert.match(body, /mainRepo, wkId, versionIdentity: selectedVersion, runGit\s*\}\)/u);

  assert.deepEqual(body.match(/\bselected\.[A-Za-z_.]+/gu),
    ["selected.binding.candidate", "selected.binding.candidate"]);
  assert.equal(body.match(/\(selected\)/gu).length, 1);
  assert.ok(body.includes("progress.source = projectTerminalWkCandidateVersion(selected);"));
  for (const forbidden of ["latest", "expectedOld: selected", "selected.binding.base",
    "selected.binding.wk_tip", "selected.binding.controlled_generation"]) {
    assert.equal(body.includes(forbidden), false, forbidden);
  }
});

test("advance derives from the W record digest and generation, never a review contract", () => {
  const body = advanceBody();
  assert.match(body, /canonicalWkDigest: selection\.digest/u);
  for (const reviewInput of ["review_contract_digest", "review_subject", "decideTerminalReviewLifecycle",
    "freezeReconstructedTerminalWkCandidateInputs"]) {
    assert.equal(body.includes(reviewInput), false, reviewInput);
  }

  assert.equal(runtime.includes("authenticatedControlledContractGenerationsEqual"), false);
});
