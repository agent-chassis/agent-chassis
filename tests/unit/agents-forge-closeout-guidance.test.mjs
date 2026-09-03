

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  assertForgeHandoffGuidance,
  evaluateForgeHandoffGuidance,
  FORBIDDEN_AUTHORITY,
  REQUIRED_SEMANTICS
} from "../helpers/forge-handoff-guidance.mjs";

const AGENTS_PATH = path.resolve(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "../AGENTS.md");
const AGENTS = readFileSync(AGENTS_PATH, "utf8");

const CONFORMING_SENTENCES = {
  names: "The orchestrator's next action is `workspace_wk_forge_handoff`.",
  "sequenced-after-terminal-review":
    "Invoke it only once the terminal whole-WK findings-only review of that exact candidate is complete.",
  "publishes-reviewed-candidate": "It hands off the already-reviewed candidate to the forge.",
  "publishes-byte-for-byte": "Publication is verbatim.",
  "targets-configured-base": "The target is the configured base branch.",
  "creates-or-observes-pull-request":
    "It creates the pull request for that publication, or observes the one that already exists."
};

const surfaceFrom = (sentences) => `# Guidance\n\n${sentences.join(" ")}\n`;
const conforming = (omitId) =>
  surfaceFrom(
    Object.entries(CONFORMING_SENTENCES)
      .filter(([id]) => id !== omitId)
      .map(([, sentence]) => sentence)
  );

test("WK-1731 root AGENTS.md carries the forge-handoff boundary", () => {
  assertForgeHandoffGuidance(AGENTS, { surface: "root AGENTS.md" });
});

test("WK-1731 helper accepts a differently worded projection of the same boundary", () => {

  assertForgeHandoffGuidance(conforming(null), { surface: "alternate-wording surface" });
});

test("WK-1731 guidance check discriminates each missing handoff semantic", () => {
  for (const semantic of REQUIRED_SEMANTICS) {
    const result = evaluateForgeHandoffGuidance(conforming(semantic.id));
    assert.deepEqual(
      result.missing.map((entry) => entry.id),
      [semantic.id],
      `dropping the ${semantic.id} sentence must be reported as exactly that gap`
    );
    assert.throws(() => assertForgeHandoffGuidance(conforming(semantic.id)), /omits forge-handoff semantics/);
  }
});

test("WK-1731 a surface that never names the tool reports the whole requirement missing", () => {
  const result = evaluateForgeHandoffGuidance("# Guidance\n\nRun the terminal review, then stop.\n");
  assert.equal(result.present, false);
  assert.deepEqual(
    result.missing.map((entry) => entry.id),
    REQUIRED_SEMANTICS.map((semantic) => semantic.id)
  );
});

test("WK-1731 guidance check rejects each unsupported forge authority claim", () => {
  const claims = {
    "merge-or-merge-observation": "It then merges the pull request and reports the merge state.",
    "state-reconciliation": "It reconciles the WK ref with the landing branch afterwards.",
    "parent-wk-completion": "It completes the parent WK as soon as the pull request lands.",
    "candidate-reconstruction": "It rebuilds the candidate from the WK tip before publishing.",
    "caller-supplied-authority": "It accepts a caller-supplied candidate ref and forge target.",
    "shell-or-gh-route": "Fall back to `gh pr create` from the shell when the tool is unavailable."
  };
  assert.deepEqual(Object.keys(claims).sort(), FORBIDDEN_AUTHORITY.map((rule) => rule.id).sort());

  for (const [id, claim] of Object.entries(claims)) {
    const surface = conforming(null).trimEnd() + ` ${claim}\n`;
    const result = evaluateForgeHandoffGuidance(surface);
    assert.ok(
      result.violations.some((violation) => violation.id === id),
      `"${claim}" must be reported as ${id}`
    );
    assert.throws(() => assertForgeHandoffGuidance(surface), /claims unsupported forge authority/);
  }
});

test("WK-1731 an earlier denial does not cover a later claim in the same sentence", () => {

  const claims = {
    "candidate-reconstruction": "It never merges; it rebuilds the candidate from the WK tip.",
    "shell-or-gh-route": "There is no supported agent route past that boundary, so use `gh pr merge` instead."
  };
  for (const [id, claim] of Object.entries(claims)) {
    const result = evaluateForgeHandoffGuidance(conforming(null).trimEnd() + ` ${claim}\n`);
    assert.ok(
      result.violations.some((violation) => violation.id === id),
      `"${claim}" must be reported as ${id}`
    );
  }
});

test("WK-1731 denying an authority in a surface's own words is not a violation", () => {

  for (const denial of [
    "It never merges, reconciles state, or completes the parent WK.",
    "The tool does not merge the pull request and cannot rebuild the candidate.",
    "No caller-supplied forge authority is accepted, and there is no shell fallback."
  ]) {
    const surface = conforming(null).trimEnd() + ` ${denial}\n`;
    assert.deepEqual(evaluateForgeHandoffGuidance(surface).violations, [], denial);
  }
});

test("WK-2153 a subject-bearing conjunction starts a new claim, not a continued denial", () => {
  const claims = {
    "merge-or-merge-observation": "It does not merge, and it observes and reports merge state.",
    "state-reconciliation": "It never merges, and while it runs the launcher reconciles state.",
    "parent-wk-completion": "It does not reconcile state, and the coordinator completes the parent WK.",
    "candidate-reconstruction": "It does not merge, and then it rebuilds the candidate.",
    "caller-supplied-authority":
      "It takes no authority from prompt text, and it accepts a caller-supplied ref.",
    "shell-or-gh-route": "Do not use shell, and an operator may use gh instead."
  };
  assert.deepEqual(Object.keys(claims).sort(), FORBIDDEN_AUTHORITY.map((rule) => rule.id).sort());

  for (const [id, claim] of Object.entries(claims)) {
    const surface = conforming(null).trimEnd() + ` ${claim}\n`;
    assert.ok(
      evaluateForgeHandoffGuidance(surface).violations.some((violation) => violation.id === id),
      `"${claim}" must be reported as ${id}`
    );
    assert.throws(() => assertForgeHandoffGuidance(surface), /claims unsupported forge authority/);
  }
});

test("WK-2153 a coordinated denial list stays one denial", () => {

  for (const denial of [
    "It does not merge and reconcile state.",
    "It does not merge, observe merge state, or reconcile state.",
    "It never rebuilds and never re-derives the candidate."
  ]) {
    const surface = conforming(null).trimEnd() + ` ${denial}\n`;
    assert.deepEqual(evaluateForgeHandoffGuidance(surface).violations, [], denial);
  }
});

test("WK-2153 a denial attached to the trigger's own predicate is accepted", () => {
  for (const denial of [
    "Merge readiness is not owned by this capability.",
    "Reconciliation of the WK record is not performed by the tool.",
    "Completing the parent WK is not part of handoff.",
    "Shell access remains denied for authority-bearing actions.",
    "Candidate reconstruction is never performed by the tool.",
    "Caller-supplied forge authority is forbidden."
  ]) {
    const surface = conforming(null).trimEnd() + ` ${denial}\n`;
    assert.deepEqual(evaluateForgeHandoffGuidance(surface).violations, [], denial);
  }
});

test("WK-2153 a post-trigger denial does not reach into a later affirmative clause", () => {

  const surface =
    conforming(null).trimEnd() +
    " Merge readiness is not owned by this capability, and it reconciles the WK ref afterwards.\n";
  assert.deepEqual(
    evaluateForgeHandoffGuidance(surface).violations.map((violation) => violation.id),
    ["state-reconciliation"]
  );
});

test("WK-2153 relational semantics are not satisfied by tokens from unrelated clauses", () => {

  const invalid =
    "# Guidance\n\n" +
    "After the terminal review, `workspace_wk_forge_handoff` is run. " +
    "It publishes a freshly created candidate to the base branch, and an operator " +
    "observes the reviewed commit verbatim in the pull request.\n";

  const result = evaluateForgeHandoffGuidance(invalid);
  assert.equal(result.present, true, "the region must still be detected");
  for (const id of ["publishes-reviewed-candidate", "creates-or-observes-pull-request"]) {
    assert.ok(
      result.missing.some((entry) => entry.id === id),
      `${id} must not be satisfied by tokens from unrelated clauses`
    );
  }
  assert.throws(() => assertForgeHandoffGuidance(invalid), /omits forge-handoff semantics/);
});

test("WK-2153 relational semantics still hold when one clause states them", () => {

  const valid =
    "# Guidance\n\n" +
    "Once the terminal whole-WK review is dispositioned, run `workspace_wk_forge_handoff`. " +
    "It hands off the already-reviewed candidate unmodified to the configured base branch. " +
    "The same call creates the pull request for that publication, or observes the open one.\n";
  assertForgeHandoffGuidance(valid, { surface: "clause-attributed surface" });
});
