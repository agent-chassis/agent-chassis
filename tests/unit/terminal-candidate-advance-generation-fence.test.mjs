import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";

import {
  advanceTerminalReviewCandidate,
  TERMINAL_CANDIDATE_RUNTIME_CODES,
  TerminalCandidateRuntimeError
} from "../../packages/wiki-mcp/src/lib/dispatch-terminal-candidate-runtime.mjs";

const runtime = readFileSync(new URL(
  "../../packages/wiki-mcp/src/lib/dispatch-terminal-candidate-runtime.mjs",
  import.meta.url
), "utf8");

function advanceBody() {
  const start = runtime.indexOf("export async function advanceTerminalReviewCandidate");
  assert.ok(start >= 0);
  return runtime.slice(start);
}

test("advance authenticates complete current generation before freezing W inputs", () => {
  const body = advanceBody();
  const authenticate = body.indexOf("authenticateAdvanceGeneration({");
  const freeze = body.indexOf("freezeTerminalWkCandidateInputs({");
  const reconstructed = body.indexOf("freezeReconstructedTerminalWkCandidateInputs({");
  assert.ok(authenticate >= 0);
  assert.ok(freeze > authenticate);
  assert.ok(reconstructed > authenticate);
  assert.match(body, /generationAuthentication,\s*\n\s*runGit/u);
});

test("generation is re-authenticated after derivation and before candidate CAS", () => {
  const body = advanceBody();
  const derive = body.indexOf("const derived = await derive({ frozen, runGit });");
  const finalAuth = body.indexOf("const finalGenerationAuthentication = await authenticateAdvanceGeneration");
  const cas = body.indexOf("const published = await publish({");
  assert.ok(derive >= 0);
  assert.ok(finalAuth > derive);
  assert.ok(cas > finalAuth);
  assert.ok(body.indexOf("controlled-contract generation moved during candidate derivation") > finalAuth);
  assert.match(runtime, /return assertAuthenticatedControlledContractGeneration\(authenticated/u);
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

test("production advance refuses an absent generation without mutating the candidate ref", async (t) => {
  const mainRepo = await mkdtemp(path.join(os.tmpdir(), "terminal-candidate-generation-fence-"));
  t.after(() => rm(mainRepo, { recursive: true, force: true }));
  await mkdir(path.join(mainRepo, "wiki", "work-records"), { recursive: true });
  await mkdir(path.join(mainRepo, "wiki", "contracts"), { recursive: true });
  await writeFile(path.join(mainRepo, "wiki", "work-records", "WK-2271.json"), JSON.stringify({
    id: "WK-2271", initiative: "IN-0030"
  }), "utf8");

  const currentW = "a".repeat(40);
  const snapshot = Object.freeze({ currentW, versionDecision: null });
  let casCalls = 0;
  const backend = {
    async withTerminalCandidateAdvanceExclusion({ evaluateTerminalReviewCandidateStatus, run }) {
      const observed = await evaluateTerminalReviewCandidateStatus();
      return run(observed);
    }
  };

  await assert.rejects(
    advanceTerminalReviewCandidate({
      mainRepo,
      wkId: "WK-2271",
      backend,
      dependencies: {
        evaluateTerminalReviewCandidateStatus: async () => ({ state: "candidate_stale_w" }),
        authoritySnapshot: () => snapshot,
        casTerminalCandidateCurrentRef: async () => { casCalls += 1; }
      }
    }),
    (error) => {
      assert.ok(error instanceof TerminalCandidateRuntimeError);
      assert.equal(error.code, TERMINAL_CANDIDATE_RUNTIME_CODES.ADVANCE_GENERATION_ABSENT);
      return true;
    }
  );
  assert.equal(casCalls, 0);
});

test("v3 final recheck binds the canonical record digest as well as the review contract", () => {
  const body = advanceBody();
  assert.match(body, /selection\.schema === "v3" && finalLive\.contract\.digest !== snapshot\.live\.digest/u);
  assert.match(body, /authenticatedControlledContractGenerationsEqual\(\s*finalGenerationAuthentication,\s*generationAuthentication\)/u);
});
