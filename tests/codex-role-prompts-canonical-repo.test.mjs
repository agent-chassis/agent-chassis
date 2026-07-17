

import test from "node:test";
import assert from "node:assert/strict";

import {
  redteamPrompt,
  reviewPrompt
} from "../packages/agent-launch-cli/src/lib/codex-role-prompts.mjs";

const SUBJECT = "WK-1577#SLICE-007";
const CANONICAL_REPO = "/srv/canonical/main-repo";

const SUBMIT_SIGNAL =
  "When findings-only reviewer or redteam work is complete, call workspace_submit_for_review";
const MANAGED_NO_SUBMIT = "Do not call workspace_submit_for_review.";
const MANAGED_CAPTURE =
  "Complete by returning your terminal structured findings result for trusted-runtime capture";

test("reviewPrompt without canonicalRepo renders the unchanged non-managed submit signal", () => {
  const prompt = reviewPrompt(SUBJECT);
  assert.equal(reviewPrompt(SUBJECT, {}), prompt, "empty options match no-argument form");
  assert.match(prompt, /reviewer role contract/);
  assert.ok(prompt.includes(SUBMIT_SIGNAL), "non-managed reviewer keeps the submit signal");
  assert.ok(!prompt.includes(MANAGED_NO_SUBMIT), "non-managed reviewer is not the managed contract");
});

test("reviewPrompt forwards a supplied canonicalRepo to the renderer (activates managed branch)", () => {
  const managed = reviewPrompt(SUBJECT, { canonicalRepo: CANONICAL_REPO });

  assert.ok(managed.includes(MANAGED_NO_SUBMIT), "managed reviewer drops the submit mandate");
  assert.ok(managed.includes(MANAGED_CAPTURE), "managed reviewer completes via captured result");
  assert.ok(!managed.includes(SUBMIT_SIGNAL), "managed reviewer omits the submit signal");
});

test("an empty/whitespace canonicalRepo is treated as absent (non-managed)", () => {
  const baseline = reviewPrompt(SUBJECT);
  for (const canonicalRepo of [undefined, null, "", "   "]) {
    assert.equal(
      reviewPrompt(SUBJECT, { canonicalRepo }),
      baseline,
      `canonicalRepo=${JSON.stringify(canonicalRepo)} must render the non-managed prompt`
    );
  }
});

test("canonicalRepo does not perturb other reviewPrompt options", () => {
  const options = {
    acceptanceCriteria: ["criterion one", "criterion two"],
    acceptanceValidation: ["node --test something"],
    terminalStructuredRoleResultMode: "FENCED"
  };
  const nonManaged = reviewPrompt(SUBJECT, options);
  const managed = reviewPrompt(SUBJECT, { ...options, canonicalRepo: CANONICAL_REPO });

  for (const fragment of ["criterion one", "criterion two", "node --test something"]) {
    assert.ok(nonManaged.includes(fragment), `non-managed prompt includes ${fragment}`);
    assert.ok(managed.includes(fragment), `managed prompt includes ${fragment}`);
  }
  assert.ok(nonManaged.includes(SUBMIT_SIGNAL));
  assert.ok(managed.includes(MANAGED_NO_SUBMIT));
});

test("redteamPrompt is unchanged and never enters the managed branch", () => {
  const baseline = redteamPrompt(SUBJECT);
  assert.match(baseline, /redteam role contract/);

  assert.equal(redteamPrompt(SUBJECT, { canonicalRepo: CANONICAL_REPO }), baseline);
  assert.ok(!baseline.includes(MANAGED_NO_SUBMIT));
});

test("no caller-controlled fallback can synthesize canonicalRepo", () => {

  const prompt = reviewPrompt(SUBJECT, {
    acceptanceCriteria: ["/etc/passwd"],
    acceptanceValidation: ["canonicalRepo=/hijacked"],
    terminalStructuredRoleResultMode: "/hijacked"
  });
  assert.ok(prompt.includes(SUBMIT_SIGNAL), "no other option activates the managed branch");
  assert.ok(!prompt.includes(MANAGED_NO_SUBMIT));
});
