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
  PULL_REQUEST_PAGE_LIMIT,
  PULL_REQUEST_URL_MAX_LENGTH,
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

const BASE_BRANCH = "main";
const handoffBranch = (candidate) => `handoff/wk/IN-0034/WK-1718/${candidate}`;
const HOSTILE_SENTINEL = "WK1718_HOSTILE_FORGE_SENTINEL";
const HOSTILE_REPEAT = "attacker-controlled-repeat-".repeat(900);
const HOSTILE_MESSAGE =
  `github_pat_${HOSTILE_SENTINEL}_ghp_secret_gho_secret_x-access-token_${HOSTILE_REPEAT}`;

function assertHostileContentConfined(value, { maxBytes = 4096 } = {}) {
  const serialized = JSON.stringify(value);
  for (const carrier of [
    "github_pat_", "ghp_", "gho_", "x-access-token", HOSTILE_SENTINEL,
    "attacker-controlled-repeat-attacker-controlled-repeat-"
  ]) {
    assert.equal(serialized.includes(carrier), false, `returned data must not carry ${carrier}`);
  }
  assert.ok(Buffer.byteLength(serialized, "utf8") <= maxBytes,
    `returned data must stay bounded: ${Buffer.byteLength(serialized, "utf8")} > ${maxBytes}`);
  return serialized;
}

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
    baseSha: B,
    baseRef: "main",
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

function pullRequest(candidate, overrides = {}) {
  const number = Object.hasOwn(overrides, "number") ? overrides.number : 7;
  return {
    number,
    state: "open",
    merged: false,
    url: `https://${REPOSITORY.host}/${REPOSITORY.owner}/${REPOSITORY.name}/pull/${number}`,
    mergeable_state: "clean",
    base_ref: BASE_BRANCH,
    head_ref: handoffBranch(candidate),
    head_sha: candidate,
    repository: REPOSITORY,
    ...overrides
  };
}

function fakeForge(candidate, {
  branchSha = null,
  prs = [],

  filterExact = true,
  listPage = null,
  create = null
} = {}) {
  const branches = new Map(branchSha === null ? [] : [[handoffBranch(candidate), branchSha]]);
  const pullRequests = [...prs];
  const calls = { publish: 0, list: 0, create: 0 };
  return {
    repository: REPOSITORY,
    calls,
    pullRequests,
    probe: () => ({ state: "authenticated", default_branch: BASE_BRANCH }),
    observeRemoteBranch: async ({ branch }) => branches.has(branch)
      ? { kind: "present", sha: branches.get(branch) }
      : { kind: "absent" },
    publishBranchIfAbsent: async ({ branch, commit: sha }) => {
      calls.publish += 1;
      if (!branches.has(branch)) branches.set(branch, sha);
      return { kind: "published" };
    },
    listPullRequestPage: async (input) => {
      calls.list += 1;
      if (listPage !== null) return listPage(input);
      const items = filterExact
        ? pullRequests.filter((entry) => entry.base_ref === input.base && entry.head_ref === input.head)
        : [...pullRequests];
      return { kind: "ok", items, has_next: false };
    },
    createPullRequest: async ({ base, head }) => {
      calls.create += 1;
      if (create !== null) return create({ base, head, pullRequests });
      const created = pullRequest(candidate, {
        number: pullRequests.length + 1,
        base_ref: base,
        head_ref: head
      });
      pullRequests.push(created);
      return { kind: "created", pull_request: created };
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
  assert.equal(result.result.parent, state.B);
  assert.equal(result.result.tree, state.binding.candidate_tree);
  assert.equal(result.result.boundary_authorization.policy_posture, "free_substrate");
  assert.equal(calls.some((args) => new Set(["commit-tree", "merge-tree", "merge-base"]).has(args[0])), false);
});

test("absent branch is published and a single exact pull request is created automatically", async (t) => {
  const state = fixture(t);
  const forge = fakeForge(state.binding.candidate);
  const result = await publish(state, { forge });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.result.kind, "handed_off");
  assert.equal(forge.calls.publish, 1);
  assert.equal(forge.calls.create, 1);
  assert.equal(forge.pullRequests.length, 1);
  assert.equal(result.result.branch, handoffBranch(state.binding.candidate));
  assert.equal(result.result.base_branch, BASE_BRANCH);
  assert.equal(result.result.pull_request_state, "open_exact");
  assert.equal(result.result.pull_request.number, 1);
  assert.equal(result.result.pull_request.head_sha, state.binding.candidate);
  assert.equal(result.result.pull_request.state, "open");
  assert.equal(result.result.pull_request.merged, false);
});

test("an existing exact branch and exact open pull request are recovered without creation", async (t) => {
  const state = fixture(t);
  const forge = fakeForge(state.binding.candidate, {
    branchSha: state.binding.candidate,
    prs: [pullRequest(state.binding.candidate, { number: 42 })]
  });
  const result = await publish(state, { forge });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(forge.calls.publish, 0);
  assert.equal(forge.calls.create, 0);
  assert.equal(result.result.pull_request_state, "open_exact");
  assert.equal(result.result.pull_request.number, 42);
});

test("an exact already-merged pull request recovers as a typed successful handoff", async (t) => {
  const state = fixture(t);
  const forge = fakeForge(state.binding.candidate, {
    branchSha: state.binding.candidate,
    prs: [pullRequest(state.binding.candidate, { number: 9, state: "closed", merged: true })]
  });
  const result = await publish(state, { forge });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.result.kind, "handed_off");
  assert.equal(forge.calls.create, 0);
  assert.equal(result.result.pull_request_state, "already_merged");
  assert.equal(result.result.pull_request.merged, true);
  assert.equal(result.result.pull_request.number, 9);
});

test("repeating the handoff recovers the same proposal and never opens a duplicate", async (t) => {
  const state = fixture(t);
  const forge = fakeForge(state.binding.candidate);
  const first = await publish(state, { forge });
  const second = await publish(state, { forge });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(forge.calls.create, 1);
  assert.equal(forge.calls.publish, 1);
  assert.equal(forge.pullRequests.length, 1);
  assert.equal(second.result.pull_request.number, first.result.pull_request.number);
});

test("an uncertain create is reobserved: one exact observation recovers", async (t) => {
  const state = fixture(t);
  const forge = fakeForge(state.binding.candidate, {

    create: ({ base, head, pullRequests }) => {
      pullRequests.push(pullRequest(state.binding.candidate, { number: 5, base_ref: base, head_ref: head }));
      return { kind: "uncertain" };
    }
  });
  const result = await publish(state, { forge });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(forge.calls.create, 1);
  assert.equal(forge.calls.list, 2);
  assert.equal(result.result.pull_request.number, 5);
  assert.equal(result.result.pull_request_state, "open_exact");
});

test("an uncertain create with zero exact observations refuses instead of retrying", async (t) => {
  const state = fixture(t);
  const forge = fakeForge(state.binding.candidate, { create: () => ({ kind: "uncertain" }) });
  const result = await publish(state, { forge });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.category, WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE);
  assert.equal(result.detail.reason, "pull_request_not_exactly_observable_after_create");
  assert.equal(forge.calls.create, 1);
});

test("a thrown create is treated as uncertain and reobserved, never retried", async (t) => {
  const state = fixture(t);
  const forge = fakeForge(state.binding.candidate, {
    create: () => { throw new Error(HOSTILE_MESSAGE); }
  });
  const result = await publish(state, { forge });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.category, WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE);
  assert.equal(result.detail.reason, "pull_request_not_exactly_observable_after_create");
  assert.equal(forge.calls.create, 1);
  assert.equal(forge.calls.list, 2);
  assertHostileContentConfined(result);
});

test("a secret-bearing thrown create still converges after one exact reobservation", async (t) => {
  const state = fixture(t);
  const forge = fakeForge(state.binding.candidate, {
    create: ({ base, head, pullRequests }) => {
      pullRequests.push(pullRequest(state.binding.candidate, {
        number: 17,
        base_ref: base,
        head_ref: head
      }));
      throw HOSTILE_MESSAGE;
    }
  });
  const result = await publish(state, { forge });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.result.pull_request.number, 17);
  assert.equal(forge.calls.create, 1, "throwing create is never retried");
  assert.equal(forge.calls.list, 2, "one pre-create and one post-create observation");
  assertHostileContentConfined(result, { maxBytes: 8192 });
});

test("an uncertain create with multiple exact observations refuses", async (t) => {
  const state = fixture(t);
  const forge = fakeForge(state.binding.candidate, {
    create: ({ base, head, pullRequests }) => {
      pullRequests.push(pullRequest(state.binding.candidate, { number: 5, base_ref: base, head_ref: head }));
      pullRequests.push(pullRequest(state.binding.candidate, { number: 6, base_ref: base, head_ref: head }));
      return { kind: "uncertain" };
    }
  });
  const result = await publish(state, { forge });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.category, WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT);
  assert.equal(result.detail.reason, "multiple_exact_pull_requests_after_create");
});

test("multiple pre-existing exact pull requests fail closed without creating another", async (t) => {
  const state = fixture(t);
  const forge = fakeForge(state.binding.candidate, {
    branchSha: state.binding.candidate,
    prs: [
      pullRequest(state.binding.candidate, { number: 1 }),
      pullRequest(state.binding.candidate, { number: 2 })
    ]
  });
  const result = await publish(state, { forge });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.category, WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT);
  assert.equal(result.detail.reason, "multiple_exact_pull_requests");
  assert.equal(forge.calls.create, 0);
});

test("a pull request whose head SHA is not the exact candidate fails closed", async (t) => {
  const state = fixture(t);
  const forge = fakeForge(state.binding.candidate, {
    branchSha: state.binding.candidate,
    prs: [pullRequest(state.binding.candidate, { head_sha: state.L })]
  });
  const result = await publish(state, { forge });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.category, WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT);
  assert.equal(result.detail.reason, "pull_request_head_sha_disagrees");
  assert.equal(result.detail.expected, state.binding.candidate);
  assert.equal(result.detail.observed, state.L);
});

test("a pull request outside the exact repository, base, head, or number identity fails closed", async (t) => {
  const state = fixture(t);
  const mismatches = {
    repository: { repository: { host: "github.com", owner: "someone-else", name: "agent-chassis" } },
    base: { base_ref: "release/1.x" },
    head: { head_ref: "handoff/wk/IN-0034/WK-1718/deadbeef" },
    number: { number: 0 }
  };
  for (const [label, overrides] of Object.entries(mismatches)) {
    await t.test(label, async (st) => {
      const inner = fixture(st);
      const forge = fakeForge(inner.binding.candidate, {
        branchSha: inner.binding.candidate,
        filterExact: false,
        prs: [pullRequest(inner.binding.candidate, overrides)]
      });
      const result = await publish(inner, { forge });
      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.category, WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT);
      assert.equal(result.detail.reason, "observed_pull_request_identity_mismatch");
      assert.equal(forge.calls.create, 0);
    });
  }
});

test("a closed and unmerged exact pull request fails closed", async (t) => {
  const state = fixture(t);
  const forge = fakeForge(state.binding.candidate, {
    branchSha: state.binding.candidate,
    prs: [pullRequest(state.binding.candidate, { state: "closed", merged: false })]
  });
  const result = await publish(state, { forge });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.category, WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT);
  assert.equal(result.detail.reason, "closed_unmerged_or_unknown_pull_request_state");
  assert.equal(result.detail.state, "closed");
});

test("unusable pagination and proposal transport uncertainty fail closed", async (t) => {
  const cases = [
    ["transport", () => { throw new Error("gh exploded"); }, "pull_request_transport_failed"],
    ["unusable", () => ({ kind: "unusable" }), "pull_request_observation_unusable"],
    ["non-array", () => ({ kind: "ok", items: "not-a-list", has_next: false }), "pull_request_observation_unusable"],
    ["page-limit", () => ({ kind: "ok", items: [], has_next: true }), "pull_request_page_limit_exceeded"]
  ];
  for (const [label, listPage, reason] of cases) {
    await t.test(label, async (st) => {
      const state = fixture(st);
      const forge = fakeForge(state.binding.candidate, { branchSha: state.binding.candidate, listPage });
      const result = await publish(state, { forge });
      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.category, WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE);
      assert.equal(result.detail.stage, "pull_request");
      assert.equal(result.detail.reason, reason);
      assert.equal(forge.calls.create, 0);
      if (label === "page-limit") assert.equal(forge.calls.list, PULL_REQUEST_PAGE_LIMIT);
    });
  }
});

test("publishing the exact branch alone can never produce handed_off", async (t) => {
  const state = fixture(t);

  const forge = fakeForge(state.binding.candidate, { create: () => ({ kind: "uncertain" }) });
  const result = await publish(state, { forge });
  assert.equal(forge.calls.publish, 1, "the exact branch was published");
  assert.equal(forge.calls.create, 1, "exactly one create was attempted");
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.notEqual(result.result?.kind, "handed_off");
  assert.equal(result.detail.stage, "pull_request");
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
    assert.equal(result.result.pull_request_state, "open_exact");
  }
  assert.equal(git(state.repo, "rev-parse", "refs/heads/main"), movedLanding);
});

test("an open proposal the forge reports as conflicting or unmergeable is still a successful handoff", async (t) => {
  const state = fixture(t);
  for (const mergeableState of [
    "clean", "dirty", "unstable", "blocked", "behind", "has_hooks", "unknown", "draft"
  ]) {
    const forge = fakeForge(state.binding.candidate, {
      branchSha: state.binding.candidate,
      prs: [pullRequest(state.binding.candidate, { number: 3, mergeable_state: mergeableState })]
    });
    const result = await publish(state, { forge });
    assert.equal(result.ok, true, `${mergeableState}: ${JSON.stringify(result)}`);
    assert.equal(result.result.kind, "handed_off");
    assert.equal(result.result.pull_request.mergeable_state, mergeableState);
  }
});

test("the handed_off result carries bounded proposal detail and no credential or raw process output", async (t) => {
  const state = fixture(t);
  const result = await publish(state, {
    forge: fakeForge(state.binding.candidate, {
      branchSha: state.binding.candidate,
      prs: [pullRequest(state.binding.candidate, { number: 11 })]
    })
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(
    Object.keys(result.result.pull_request).sort(),
    ["head_sha", "merged", "mergeable_state", "number", "state", "url"].sort()
  );
  assert.equal(result.result.pull_request.url,
    "https://github.com/agent-chassis/agent-chassis/pull/11");
  assert.equal(result.result.proposal_authority, "configured_forge_and_human_merge_actor");
  const serialized = JSON.stringify(result);
  for (const carrier of [
    "ghp_", "gho_", "github_pat_", "x-access-token", "password", "stdout", "stderr", "spawn_error",
    "credential", "GIT_TERMINAL_PROMPT", "auth status"
  ]) {
    assert.equal(serialized.includes(carrier), false, `result must not carry ${carrier}`);
  }
});

test("malformed or secret-bearing pull-request projections refuse without reflecting forge fields", async (t) => {
  const secret = "github_pat_DO_NOT_RETURN_1234567890";
  const canonicalUrl = "https://github.com/agent-chassis/agent-chassis/pull/7";
  const malicious = {
    unsafe_number: { number: Number.MAX_SAFE_INTEGER + 1 },
    non_boolean_merged: { merged: "false" },
    secret_state: { state: secret },
    secret_mergeability: { mergeable_state: secret },
    oversized_url: { url: `${canonicalUrl}/${"x".repeat(PULL_REQUEST_URL_MAX_LENGTH)}` },
    credential_url: { url: `https://${secret}@github.com/agent-chassis/agent-chassis/pull/7` },
    secret_query: { url: `${canonicalUrl}?token=${secret}` },
    encoded_github_pat: { url: `${canonicalUrl}/%67ithub_pat_secret` },
    encoded_ghp: { url: `${canonicalUrl}/%67%68%70%5Fsecret` },
    encoded_x_access_token: { url: `${canonicalUrl}/x%2Daccess%2Dtoken` },
    encoded_colon: { url: `${canonicalUrl}/%3Asecret` },
    encoded_slash: { url: `${canonicalUrl}/%2fsecret` },
    encoded_at: { url: `${canonicalUrl}/%40secret` },
    encoded_cr: { url: `${canonicalUrl}/%0Dsecret` },
    encoded_lf: { url: `${canonicalUrl}/%0asecret` },
    encoded_nul: { url: `${canonicalUrl}/%00secret` },
    encoded_query: { url: `${canonicalUrl}/%3fsecret` },
    encoded_fragment: { url: `${canonicalUrl}/%23secret` },
    malformed_escape: { url: `${canonicalUrl}/%zz` },
    mixed_case_escape: { url: `${canonicalUrl}/%6a%6B%4c` },
    malformed_url: { url: "not-an-absolute-url" },
    abbreviated_head: { head_sha: "a".repeat(12) }
  };
  for (const [label, overrides] of Object.entries(malicious)) {
    await t.test(label, async (st) => {
      const inner = fixture(st);
      const result = await publish(inner, {
        forge: fakeForge(inner.binding.candidate, {
          branchSha: inner.binding.candidate,
          prs: [pullRequest(inner.binding.candidate, overrides)]
        })
      });
      assert.equal(result.ok, false, label);
      assert.equal(result.category, WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT);
      assert.equal(result.detail.reason, "observed_pull_request_identity_mismatch");
      const serialized = JSON.stringify(result);
      assert.equal(serialized.includes(secret), false, `${label} must not reflect the secret`);
      assert.equal(serialized.includes("x".repeat(128)), false, `${label} must not reflect oversized input`);
    });
  }
});

test("throwing PR getters fail closed with bounded constant-only refusals", async (t) => {
  assert.ok(Buffer.byteLength(HOSTILE_MESSAGE, "utf8") >= 20_000);
  for (const field of ["state", "url", "mergeable_state", "head_sha"]) {
    await t.test(field, async (st) => {
      const state = fixture(st);
      const hostile = pullRequest(state.binding.candidate);
      Object.defineProperty(hostile, field, {
        enumerable: true,
        get() { throw new Error(HOSTILE_MESSAGE); }
      });
      const forge = fakeForge(state.binding.candidate, {
        branchSha: state.binding.candidate,
        filterExact: false,
        prs: [hostile]
      });
      const result = await publish(state, { forge });
      assert.equal(result.ok, false, field);
      assert.equal(result.detail.reason, "observed_pull_request_identity_mismatch");
      assert.equal(forge.calls.create, 0);
      assertHostileContentConfined(result);
    });
  }
});

test("throwing proxies in PR access and observation iteration fail closed without reflection", async (t) => {
  const cases = [
    ["item_get", (state) => ({
      filterExact: false,
      prs: [new Proxy(pullRequest(state.binding.candidate), {
        get() { throw HOSTILE_MESSAGE; }
      })]
    }), "observed_pull_request_identity_mismatch"],
    ["response_get", () => ({
      listPage: () => new Proxy({ kind: "ok", items: [], has_next: false }, {
        get() { throw { sentinel: HOSTILE_SENTINEL, message: HOSTILE_MESSAGE }; }
      })
    }), "pull_request_transport_failed"],
    ["items_iteration", () => ({
      listPage: () => ({
        kind: "ok",
        items: new Proxy([], {
          get(target, property, receiver) {
            if (property === Symbol.iterator) throw HOSTILE_MESSAGE;
            return Reflect.get(target, property, receiver);
          }
        }),
        has_next: false
      })
    }), "pull_request_observation_unusable"]
  ];
  for (const [label, configure, reason] of cases) {
    await t.test(label, async (st) => {
      const state = fixture(st);
      const forge = fakeForge(state.binding.candidate, {
        branchSha: state.binding.candidate,
        ...configure(state)
      });
      const result = await publish(state, { forge });
      assert.equal(result.ok, false, label);
      assert.equal(result.detail.reason, reason);
      assert.equal(forge.calls.create, 0);
      assertHostileContentConfined(result);
    });
  }
});

test("forge list and create adapters may throw any value without reflecting it", async (t) => {
  const thrownValues = [
    new Error(HOSTILE_MESSAGE),
    HOSTILE_MESSAGE,
    { sentinel: HOSTILE_SENTINEL, token: "github_pat_object", repeated: HOSTILE_REPEAT }
  ];
  for (const [index, thrown] of thrownValues.entries()) {
    await t.test(`list_${index}`, async (st) => {
      const state = fixture(st);
      const forge = fakeForge(state.binding.candidate, {
        branchSha: state.binding.candidate,
        listPage: () => { throw thrown; }
      });
      const result = await publish(state, { forge });
      assert.equal(result.ok, false);
      assert.equal(result.detail.reason, "pull_request_transport_failed");
      assert.equal(forge.calls.create, 0);
      assertHostileContentConfined(result);
    });
    await t.test(`create_${index}`, async (st) => {
      const state = fixture(st);
      const forge = fakeForge(state.binding.candidate, {
        create: () => { throw thrown; }
      });
      const result = await publish(state, { forge });
      assert.equal(result.ok, false);
      assert.equal(result.detail.reason, "pull_request_not_exactly_observable_after_create");
      assert.equal(forge.calls.create, 1);
      assert.equal(forge.calls.list, 2);
      assertHostileContentConfined(result);
    });
  }
});

test("outer forge getter exceptions use only the closed launcher reason", async (t) => {
  const state = fixture(t);
  const forge = fakeForge(state.binding.candidate);
  Object.defineProperty(forge, "repository", {
    enumerable: true,
    get() { throw new Error(HOSTILE_MESSAGE); }
  });
  const result = await publish(state, { forge });
  assert.equal(result.ok, false);
  assert.equal(result.category, WK_FORGE_HANDOFF_FAILURE_CATEGORIES.INDETERMINATE);
  assert.deepEqual(result.detail, { reason: "terminal_candidate_publication_threw" });
  assertHostileContentConfined(result);
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

test("free-substrate handoff needs no local project-test or dependency evidence", async (t) => {
  const state = fixture(t);

  assert.equal(existsSync(path.join(state.repo, "node_modules")), false);
  assert.equal(existsSync(path.join(state.repo, "package.json")), false);
  for (const validationEvidence of [
    undefined,
    null,
    [],
    [{ candidate: state.binding.candidate, ok: false, advisory: true, target_available: false }]
  ]) {
    const forge = fakeForge(state.binding.candidate);
    const result = await defaultWkForgeHandoff({
      mainRepo: state.repo,
      assignedUnit: "WK-1718",
      deps: {
        forge,
        resolveTerminalCandidatePublicationState: async () => ({
          binding: state.binding,
          materialization: state.materialization,
          ...(validationEvidence === undefined ? {} : { validation_evidence: validationEvidence }),
          advisory_review_evidence: { authority: "advisory_only", reviews: [] }
        })
      }
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.result.kind, "handed_off");
    assert.equal(result.result.commit, state.binding.candidate);
    assert.equal(result.result.parent, state.B);
    assert.equal(result.result.boundary_authorization.policy_posture, "free_substrate");
    assert.equal(forge.calls.create, 1);
  }
});

test("the configured CCE request stays target-only and carries no validation evidence", async (t) => {
  const state = fixture(t);
  const requests = [];
  await publish(state, {
    forgeHandoffCcePolicy: {
      configured: true,
      authorize: async (value) => {
        requests.push(value);
        return {
          schema_version: WK_FORGE_HANDOFF_CCE_POLICY_DECISION_SCHEMA_VERSION,
          decision_id: "allow-shape",
          decision: "allow",
          ratified: true,
          attestation_valid: true,
          target: value.target
        };
      }
    }
  });
  assert.equal(requests.length, 1);
  const [request] = requests;

  assert.deepEqual(Object.keys(request).sort(), ["schema_version", "target"]);
  assert.equal(request.schema_version, "wk-forge-handoff-cce-policy-request.v1");
  assert.deepEqual(Object.keys(request.target).sort(), [
    "assigned_unit",
    "base_branch",
    "base_ref",
    "base_sha",
    "candidate_ref",
    "candidate_sha",
    "candidate_tree",
    "canonical_wk_digest",
    "handoff_branch",
    "initiative",
    "operation",
    "repository",
    "wk_ref",
    "wk_sha"
  ]);
  assert.deepEqual(Object.keys(request.target.repository).sort(), ["host", "name", "owner"]);
  assert.equal(request.target.candidate_sha, state.binding.candidate);
  assert.equal(request.target.base_sha, state.B);
  assert.equal(request.target.wk_sha, state.W);

  const serialized = JSON.stringify(request);
  for (const carrier of [
    "validation", "validation_evidence", "dependency", "node_modules", "package-lock",
    "install", "test", "projection", "steps", "exit_status", "reviewer_read_only"
  ]) {
    assert.equal(serialized.includes(carrier), false, `the CCE request must not carry ${carrier}`);
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
    landing: BASE_BRANCH,
    branch: handoffBranch(state.binding.candidate)
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.authorization.authority, "cce");
});

test("a denied CCE boundary never reaches the forge proposal surface", async (t) => {
  const state = fixture(t);
  const forge = fakeForge(state.binding.candidate);
  const denied = await publish(state, {
    forge,
    forgeHandoffCcePolicy: {
      configured: true,
      authorize: async (value) => ({
        schema_version: WK_FORGE_HANDOFF_CCE_POLICY_DECISION_SCHEMA_VERSION,
        decision_id: "deny-2",
        decision: "deny",
        ratified: true,
        attestation_valid: true,
        target: value.target
      })
    }
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.category, WK_FORGE_HANDOFF_FAILURE_CATEGORIES.CCE_POLICY);
  assert.equal(forge.calls.publish, 0);
  assert.equal(forge.calls.list, 0);
  assert.equal(forge.calls.create, 0);
});

test("remote branch disagreement remains a forge transport refusal", async (t) => {
  const state = fixture(t);
  const forge = fakeForge(state.binding.candidate, { branchSha: state.L });
  const result = await publish(state, { forge });
  assert.equal(result.ok, false);
  assert.equal(result.category, WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT);
  assert.equal(result.detail.stage, "branch");
  assert.equal(forge.calls.create, 0);
});
