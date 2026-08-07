import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  authenticateWkCloseoutChain,
  defaultRunGit,
  defaultWkForgeHandoff
} from "../packages/agent-launch-cli/src/lib/wk-forge-handoff.mjs";
import {
  constructTerminalWkCandidate,
  defaultTerminalCandidateRunGit,
  freezeTerminalWkCandidateInputs
} from "../packages/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import { materializeTerminalCandidateCheckout } from
  "../packages/agent-launch-cli/src/lib/terminal-review-materialization.mjs";

function git(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" }
  }).trim();
}

function commit(repo, message) {
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

function fixture(t, {
  updated = ["2026-07-30", "2026-07-31"], mutate, makeCloseout = true, existingClosure = false,
  threeCommit = false, twoDependencies = false
} = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wk-final-closeout-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "fixture");
  git(root, "config", "user.email", "fixture@example.invalid");
  writeFileSync(path.join(root, "README.md"), "fixture\n");
  commit(root, "base");
  const recordPath = path.join(root, "wiki", "work-records", "WK-1788.json");
  mkdirSync(path.dirname(recordPath), { recursive: true });
  const terminal = {
    id: "SLICE-010", title: "terminal review", work_kind: "review", owner: "reviewer",
    priority: "medium", depends_on: twoDependencies
      ? ["WK-1788#SLICE-011", "WK-1788#SLICE-012"]
      : ["WK-1788#SLICE-011"], read_scope: ["AGENTS.md"],
    repo_paths: ["wiki/work-records/WK-1788.json"], write_scope: [],
    dispatch_intent: {
      intended_agent_role: "reviewer", target_unit: "slice",
      requires_graph_impact: false, requires_escalation: false
    }, acceptance: { criteria: ["review"], validation: ["node --test"] },
    review_purpose: "terminal_whole_wk", status: "review"
  };
  const implementation = {
    id: "SLICE-011", title: "implementation", work_kind: "implementation", status: "review",
    sections: existingClosure
      ? { closure: { summary: "Already closed.", validation: [], follow_ups: [] } }
      : {}
  };
  const secondImplementation = {
    id: "SLICE-012", title: "second implementation", work_kind: "implementation", status: "review",
    sections: {}
  };
  const base = {
    schema_version: "work-record.v1", record_kind: "work_item", id: "WK-1788", title: "closeout",
    initiative: "IN-0030", status: threeCommit ? "todo" : "review", updated: updated[0],
    slices: [threeCommit ? { ...terminal, status: "todo" } : terminal, implementation,
      ...(twoDependencies ? [secondImplementation] : [])]
  };
  writeFileSync(recordPath, JSON.stringify(base));
  const candidate = commit(root, "reviewed candidate");
  if (!makeCloseout) return { root, candidate, recordPath, base };
  let reviewParent = candidate;
  if (threeCommit) {
    const review = structuredClone(base);
    review.status = "review";
    review.slices[0].status = "review";
    review.updated = updated[1];
    review.slices[1].status = "done";
    review.slices[1].sections.closure = {
      summary: "Closed.", validation: ["node --test"], follow_ups: []
    };
    writeFileSync(recordPath, JSON.stringify(review));
    reviewParent = commit(root, "terminal review state");
  }
  if (threeCommit) {
    const done = structuredClone(JSON.parse(git(root, "show", `${reviewParent}:wiki/work-records/WK-1788.json`)));
    done.status = "done";
    writeFileSync(recordPath, JSON.stringify(done));
    const head = commit(root, "complete");
    return { root, candidate, head, review: reviewParent };
  }
  const closeout = structuredClone(threeCommit ? JSON.parse(git(root, "show", `${reviewParent}:wiki/work-records/WK-1788.json`)) : base);
  closeout.status = "review";
  closeout.updated = updated[1];
  closeout.slices[1].status = "done";
  closeout.slices[1].sections.closure = {
    summary: "Closed.", validation: ["node --test"], follow_ups: []
  };
  mutate?.(closeout);
  writeFileSync(recordPath, JSON.stringify(closeout));
  const head = commit(root, "final slice closeout");
  return { root, candidate, head, review: reviewParent };
}

function authenticate(state) {
  return authenticateWkCloseoutChain({
    mainRepo: state.root, wk: "WK-1788", candidate: state.candidate, head: state.head,
    deps: { runGit: defaultRunGit }
  });
}

async function publicRecovery(t, { unauthenticatedIntermediate = false } = {}) {
  const state = fixture(t, { threeCommit: true, makeCloseout: false });
  git(state.root, "remote", "add", "origin", "https://github.com/agent-chassis/agent-chassis.git");
  git(state.root, "branch", "wk/IN-0030/WK-1788", state.candidate);
  const frozen = freezeTerminalWkCandidateInputs({
    mainRepo: state.root, baseSha: git(state.root, "rev-parse", `${state.candidate}^`),
    baseRef: "main", wkRef: "refs/heads/wk/IN-0030/WK-1788", canonicalWkId: "WK-1788",
    canonicalWkDigest: `sha256:${"a".repeat(64)}`
  });
  const binding = constructTerminalWkCandidate({ frozen });
  const candidateRoot = mkdtempSync(path.join(os.tmpdir(), "wk-final-closeout-candidate-"));
  t.after(() => rmSync(candidateRoot, { recursive: true, force: true }));
  const materialization = materializeTerminalCandidateCheckout({
    binding, candidateRoot, runGit: defaultTerminalCandidateRunGit
  });
  git(state.root, "checkout", "--detach", "-q", binding.candidate);
  const reviewRecord = structuredClone(state.base);
  reviewRecord.status = "review";
  reviewRecord.slices[0].status = "review";
  reviewRecord.updated = "2026-07-31";
  reviewRecord.slices[1].status = "done";
  reviewRecord.slices[1].sections.closure = {
    summary: "Closed.", validation: ["node --test"], follow_ups: []
  };
  if (unauthenticatedIntermediate) reviewRecord.title = "unauthenticated intermediate mutation";
  writeFileSync(state.recordPath, JSON.stringify(reviewRecord));
  const review = commit(state.root, "terminal review state");
  const completionRecord = structuredClone(reviewRecord);
  completionRecord.status = "done";
  writeFileSync(state.recordPath, JSON.stringify(completionRecord));
  const completion = commit(state.root, "complete");
  const forge = {
    repository: { host: "github.com", owner: "agent-chassis", name: "agent-chassis" },
    probe: () => ({ state: "authenticated", default_branch: "main" }),
    observeRemoteBranch: async () => ({ kind: "present", sha: completion }),
    listPullRequestPage: async () => ({ kind: "ok", has_next: false, items: [{
      number: 1, state: "open", merged: false, mergeable_state: "clean",
      url: "https://github.com/agent-chassis/agent-chassis/pull/1",
      repository: { host: "github.com", owner: "agent-chassis", name: "agent-chassis" },
      base_ref: "main", head_ref: `handoff/wk/IN-0030/WK-1788/${binding.candidate}`,
      head_sha: completion
    }] }),
    publishBranchIfAbsent: async () => ({ kind: "published" }),
    createPullRequest: async () => ({ kind: "uncertain" })
  };
  return { state, review, completion, result: await defaultWkForgeHandoff({
    mainRepo: state.root, assignedUnit: "WK-1788",
    deps: { forge, resolveTerminalCandidatePublicationState: async () => ({ binding, materialization }) }
  }) };
}

test("public forge recovery authenticates final-slice closeout after terminal review", async (t) => {
  const { result } = await publicRecovery(t);
  assert.equal(result.ok, true);
});

test("public forge recovery refuses an unauthenticated intermediate before final closeout", async (t) => {
  const { result } = await publicRecovery(t, { unauthenticatedIntermediate: true });
  assert.equal(result.ok, false);
});

test("forge recovery authenticates the exact final-slice closeout and coupled updated drift", (t) => {
  const state = fixture(t);
  assert.deepEqual(authenticate(state), { head: state.head, review_state: state.candidate });
});

test("forge recovery carries the authenticated final-slice closeout through the review intermediate", (t) => {
  const state = fixture(t, { threeCommit: true });
  assert.deepEqual(authenticate(state), { head: state.head, review_state: state.review });
});

test("forge recovery refuses standalone updated drift and unauthorized closeout variants", (t) => {
  for (const mutate of [
    (record) => { record.updated = ""; },
    (record) => { record.slices[1].status = "review"; delete record.slices[1].sections.closure; },
    (record) => { delete record.slices[1].sections.closure; },
    (record) => { record.slices[1].sections.closure.extra = true; },
    (record) => { record.slices[1].status = "done"; delete record.slices[1].sections.closure; },
    (record) => { record.slices[0].title = "changed"; },
    (record) => { record.slices[1].title = "changed"; }
  ]) {
    const state = fixture(t, { updated: ["2026-07-30", "2026-07-31"], mutate });
    assert.equal(authenticate(state), null);
  }
  const unchanged = fixture(t, { updated: ["2026-07-30", "2026-07-30"] });
  assert.deepEqual(authenticate(unchanged), {
    head: unchanged.head, review_state: unchanged.candidate
  });
});

test("forge recovery refuses more than one newly closed dependency", (t) => {
  const state = fixture(t, {
    twoDependencies: true,
    mutate: (record) => {
      record.slices[2].status = "done";
      record.slices[2].sections.closure = {
        summary: "Closed.", validation: ["node --test"], follow_ups: []
      };
    }
  });
  assert.equal(authenticate(state), null);
});

test("forge recovery permits unchanged declared dependencies beside one closeout", (t) => {
  const state = fixture(t, { twoDependencies: true });
  assert.deepEqual(authenticate(state), {
    head: state.head, review_state: state.candidate
  });
});

test("forge recovery requires one declared same-record implementation dependency", (t) => {
  for (const mutate of [
    (record) => { record.slices[0].depends_on = ["WK-9999#SLICE-011"]; },
    (record) => { record.slices[0].depends_on = ["WK-1788#SLICE-010"]; },
    (record) => { record.slices[0].depends_on = ["WK-1788#SLICE-011", "WK-1788#SLICE-012"]; },
    (record) => { record.slices[1].work_kind = "review"; },
    (record) => { record.slices[1].status = "todo"; },
    (record) => { record.slices[1].sections.closure = { summary: "Closed.", validation: [1], follow_ups: [] }; }
  ]) {
    const state = fixture(t, { mutate });
    assert.equal(authenticate(state), null);
  }
  assert.equal(authenticate(fixture(t, { existingClosure: true })), null);
});

test("forge recovery authenticates the terminal-review intermediate before final closeout", (t) => {
  const state = fixture(t, { makeCloseout: false });
  const { root, candidate, recordPath } = state;
  const base = structuredClone(state.base);
  base.title = "unauthenticated intermediate mutation";
  writeFileSync(recordPath, JSON.stringify(base));
  commit(root, "unauthenticated intermediate");
  const closeout = structuredClone(base);
  closeout.slices[1].status = "done";
  closeout.slices[1].sections.closure = {
    summary: "Closed.", validation: ["node --test"], follow_ups: []
  };
  writeFileSync(recordPath, JSON.stringify(closeout));
  const head = commit(root, "final slice closeout");
  assert.equal(authenticateWkCloseoutChain({
    mainRepo: root, wk: "WK-1788", candidate, head, deps: { runGit: defaultRunGit }
  }), null);
});
