import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  constructTerminalWkCandidate,
  defaultTerminalCandidateRunGit,
  freezeTerminalWkCandidateInputs
} from "../packages/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import { materializeTerminalCandidateCheckout } from
  "../packages/agent-launch-cli/src/lib/terminal-review-materialization.mjs";
import {
  defaultWkForgeHandoff,
  resolveWkForgeHandoffBoundaryAuthorization
} from "../packages/agent-launch-cli/src/lib/wk-forge-handoff.mjs";
import {
  WK_FORGE_HANDOFF_CCE_POLICY_DECISION_SCHEMA_VERSION,
  WK_FORGE_HANDOFF_FAILURE_CATEGORIES
} from "../packages/agent-launch-cli/src/lib/trusted-operation-contracts.mjs";

const REPOSITORY = Object.freeze({
  host: "github.com",
  owner: "agent-chassis",
  name: "agent-chassis",
  https_url: "https://github.com/agent-chassis/agent-chassis.git"
});

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

function makeWritable(target) {
  if (!existsSync(target)) return;
  const stat = lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return;
  chmodSync(target, 0o700);
  for (const entry of readdirSync(target)) makeWritable(path.join(target, entry));
}

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wk1718-forge-"));
  const repo = path.join(root, "repo");
  const candidateRoot = path.join(root, "candidate");
  t.after(() => {
    makeWritable(root);
    rmSync(root, { recursive: true, force: true });
  });
  git(root, "init", "-q", "-b", "main", repo);
  git(repo, "config", "user.name", "fixture");
  git(repo, "config", "user.email", "fixture@example.invalid");
  git(repo, "remote", "add", "origin", REPOSITORY.https_url);
  const record = {
    schema_version: "work-record.v1",
    id: "WK-1718",
    initiative: "IN-0034",
    title: "Git-native terminal candidate",
    status: "review",
    depends_on: ["WK-0001"],
    slices: [{ id: "SLICE-003", work_kind: "implementation", status: "review" }]
  };
  mkdirSync(path.join(repo, "wiki", "work-records"), { recursive: true });
  writeFileSync(path.join(repo, "wiki", "work-records", "WK-1718.json"), JSON.stringify(record));
  writeFileSync(path.join(repo, "base.txt"), "base\n");
  const B = commit(repo, "base");
  git(repo, "branch", "wk/IN-0034/WK-1718");
  git(repo, "checkout", "-q", "wk/IN-0034/WK-1718");
  writeFileSync(path.join(repo, "wk.txt"), "complete WK delta\n");
  const W = commit(repo, "wk");
  git(repo, "checkout", "-q", "main");
  writeFileSync(path.join(repo, "landing.txt"), "landing\n");
  const L = commit(repo, "landing");
  const frozen = freezeTerminalWkCandidateInputs({
    mainRepo: repo,
    landingRef: "refs/heads/main",
    wkRef: "refs/heads/wk/IN-0034/WK-1718",
    canonicalWkId: "WK-1718",
    canonicalWkDigest: `sha256:${"a".repeat(64)}`
  });
  const binding = constructTerminalWkCandidate({ frozen });
  const materialization = materializeTerminalCandidateCheckout({
    binding,
    candidateRoot,
    runGit: defaultTerminalCandidateRunGit
  });
  return { root, repo, record, B, L, W, binding, materialization };
}

function fakeForge(candidate, { branchSha = null, prs = [] } = {}) {
  const branches = new Map(branchSha === null ? [] : [[`handoff/wk/IN-0034/WK-1718/${candidate}`, branchSha]]);
  const pullRequests = [...prs];
  return {
    repository: REPOSITORY,
    probe: () => ({ state: "authenticated", default_branch: "main" }),
    observeRemoteBranch: async ({ branch }) => branches.has(branch)
      ? { kind: "present", sha: branches.get(branch) }
      : { kind: "absent" },
    publishBranchIfAbsent: async ({ branch, commit: sha }) => {
      if (!branches.has(branch)) branches.set(branch, sha);
      return { kind: "published" };
    },
    listPullRequestPage: async ({ base, head }) => ({
      kind: "ok",
      items: pullRequests.filter((entry) => entry.base_ref === base && entry.head_ref === head),
      has_next: false
    }),
    createPullRequest: async ({ base, head }) => {
      const pr = {
        number: pullRequests.length + 1,
        state: "open",
        merged: false,
        url: "https://example.invalid/pr",
        mergeable_state: "unknown",
        base_ref: base,
        head_ref: head,
        head_sha: candidate,
        repository: REPOSITORY
      };
      pullRequests.push(pr);
      return { kind: "created", pull_request: pr };
    }
  };
}

function candidateState(state, evidence = null) {
  return {
    binding: state.binding,
    materialization: state.materialization,
    validation_evidence: [{ candidate: state.binding.candidate, ok: false, advisory: true }],
    advisory_review_evidence: evidence
  };
}

async function publish(state, overrides = {}) {
  return defaultWkForgeHandoff({
    mainRepo: state.repo,
    assignedUnit: "WK-1718",
    deps: {
      forge: fakeForge(state.binding.candidate),
      resolveTerminalCandidatePublicationState: async () => candidateState(state),
      ...overrides
    }
  });
}

test("exact candidate publication sends C byte-for-byte and performs no reconstruction", async (t) => {
  const state = fixture(t);
  const calls = [];
  const runGit = (input) => {
    calls.push(input.args);
    return defaultTerminalCandidateRunGit(input);
  };
  const result = await publish(state, { runGit });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.result.commit, state.binding.candidate);
  assert.equal(result.result.parent, state.L);
  assert.equal(result.result.tree, state.binding.candidate_tree);
  assert.equal(result.result.boundary_authorization.policy_posture, "free_substrate");
  assert.equal(calls.some((args) => new Set(["commit-tree", "merge-tree", "merge-base"]).has(args[0])), false);
});

test("legacy refs, landing movement, current-ref membership, WK status/dependencies, validation, and findings do not veto publication", async (t) => {
  const state = fixture(t);
  git(state.repo, "update-ref", `refs/agent-launch/terminal-candidates/WK-1718/${state.binding.candidate}`,
    state.binding.candidate);
  git(state.repo, "update-ref", `refs/agent-launch/terminal-candidates/WK-1718/${state.L}`, state.L);
  git(state.repo, "update-ref", state.binding.candidate_ref, state.L, state.binding.candidate);
  writeFileSync(path.join(state.repo, "landing-moved.txt"), "unrelated\n");
  const movedLanding = commit(state.repo, "landing moved");
  const current = { ...state.record, status: "blocked", depends_on: ["WK-9999"] };
  writeFileSync(path.join(state.repo, "wiki", "work-records", "WK-1718.json"), JSON.stringify(current));

  for (const evidence of [
    null,
    { reviews: [{ clean_review: true }] },
    { reviews: [{ findings: [{ severity: "blocking" }] }] }
  ]) {
    const result = await publish(state, {
      forge: fakeForge(state.binding.candidate),
      resolveTerminalCandidatePublicationState: async () => candidateState(state, evidence)
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.result.commit, state.binding.candidate);
  }
  assert.equal(git(state.repo, "rev-parse", "refs/heads/main"), movedLanding);
});

test("missing current-candidate resolver has no compatibility construction fallback", async (t) => {
  const state = fixture(t);
  const calls = [];
  const result = await defaultWkForgeHandoff({
    mainRepo: state.repo,
    assignedUnit: "WK-1718",
    deps: { runGit: (input) => { calls.push(input.args); return defaultTerminalCandidateRunGit(input); } }
  });
  assert.equal(result.ok, false);
  assert.equal(result.category, WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY);
  assert.equal(result.detail.reason, "exact_terminal_candidate_resolver_unavailable");
  assert.deepEqual(calls, []);
});

test("mechanical candidate object, checkout, and W drift still refuse", async (t) => {
  for (const movement of ["checkout", "wk"]) {
    await t.test(movement, async (st) => {
      const state = fixture(st);
      if (movement === "checkout") {
        writeFileSync(path.join(state.materialization.checkout_path, "drift.txt"), "drift\n");
      } else {
        git(state.repo, "update-ref", "refs/heads/wk/IN-0034/WK-1718", state.L, state.W);
      }
      const result = await publish(state);
      assert.equal(result.ok, false);
      assert.equal(result.category, WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY);
      assert.equal(result.detail.reason, "terminal_candidate_binding_moved");
    });
  }
});

test("configured CCE alone decides the exact forge boundary", async (t) => {
  const state = fixture(t);
  let request;
  const denied = await publish(state, {
    forgeHandoffCcePolicy: {
      configured: true,
      authorize: async (value) => {
        request = value;
        return {
          schema_version: WK_FORGE_HANDOFF_CCE_POLICY_DECISION_SCHEMA_VERSION,
          decision_id: "deny-1",
          decision: "deny",
          ratified: true,
          attestation_valid: true,
          target: value.target
        };
      }
    }
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.category, WK_FORGE_HANDOFF_FAILURE_CATEGORIES.CCE_POLICY);
  assert.equal(request.target.candidate_sha, state.binding.candidate);

  const allowed = await resolveWkForgeHandoffBoundaryAuthorization({
    policy: {
      configured: true,
      authorize: async (value) => ({
        schema_version: WK_FORGE_HANDOFF_CCE_POLICY_DECISION_SCHEMA_VERSION,
        decision_id: "allow-1",
        decision: "allow",
        ratified: true,
        attestation_valid: true,
        target: value.target
      })
    },
    binding: state.binding,
    initiative: "IN-0034",
    repository: REPOSITORY,
    landing: "main",
    branch: `handoff/wk/IN-0034/WK-1718/${state.binding.candidate}`
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.authorization.authority, "cce");
});

test("forge proposal state is not consulted or converted into a local veto", async (t) => {
  const state = fixture(t);
  const forge = fakeForge(state.binding.candidate, {
    prs: [
      { state: "closed", merged: false },
      { state: "open", merged: false }
    ]
  });
  forge.listPullRequestPage = async () => {
    throw new Error("proposal state must remain forge-owned");
  };
  forge.createPullRequest = async () => {
    throw new Error("proposal creation must remain forge-owned");
  };
  const result = await publish(state, { forge });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.result.commit, state.binding.candidate);
  assert.equal(result.result.proposal_authority, "configured_forge_and_human_merge_actor");
});

test("remote branch disagreement remains a forge transport refusal", async (t) => {
  const state = fixture(t);
  const result = await publish(state, { forge: fakeForge(state.binding.candidate, { branchSha: state.L }) });
  assert.equal(result.ok, false);
  assert.equal(result.category, WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT);
});
