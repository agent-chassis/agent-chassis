import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AGENT_ROLE_GUIDES,
  readAgentRoleGuide,
  resolveAgentRoleGuidePath
} from "../../packages/agent-launch-core/src/lib/agent-role-guides.mjs";
import {
  IMPLEMENTATION_WORKER_INSTRUCTION,
  buildLaunchPrompt
} from "../../packages/agent-launch-core/src/lib/work-record-launch-prompt.mjs";
import {
  createAdvisoryReviewDescriptor,
  createAdvisoryReviewInput,
  renderAdvisoryReviewBrief,
  renderFamilyNeutralAdvisoryReviewInput
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-advisory-review-contract.mjs";
import {
  renderLauncherFamilyOrchestratorPrompt,
  renderLauncherFamilyRoleContract
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-role-contract.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const GUIDE_DIR = path.join(REPO_ROOT, "packages/agent-launch-core/data/role-guides");
const SUBJECT = "WK-9999#SLICE-001";

const occurrences = (text, needle) => text.split(needle).length - 1;
const words = (text) => text.split(/\s+/u).filter(Boolean).length;

function managedWorkerPrompt() {
  return buildLaunchPrompt({
    role: "worker",
    unit: { address: SUBJECT },
    canonicalSummary: {
      record_id: "WK-9999",
      repo: "example",
      title: "Example",
      docs: ["docs/a.md"],
      repo_paths: [],
      write_scope: ["packages/x/"],
      acceptance_criteria: ["Behavior X holds."],
      validation_commands: [],
      dispatch_intent: {}
    },
    readiness: {
      schema_version: "readiness.v1",
      decision_code: "ok",
      dispatchable: true,
      unit: { address: SUBJECT, slice_id: "SLICE-001" },
      record_id: "WK-9999",
      reasons: [],
      validation_hints: [],
      canonical_refs: [],
      derived_evidence: []
    },
    agentBrief: { brief: "Brief." },
    launchTimestamp: "2026-09-24T00:00:00Z"
  });
}

function advisoryPrompt(role) {
  const descriptor = createAdvisoryReviewDescriptor({
    role,
    subject: SUBJECT,
    repository: "example",
    materialKind: "implementation",
    diffBaseSha: "a".repeat(40),
    reviewedSha: "b".repeat(40),
    reviewedTreeSha: "c".repeat(40),
    immutableSourceIdentity: "source",
    reviewBrief: renderAdvisoryReviewBrief({
      role,
      subject: SUBJECT,
      parent: { id: "WK-9999" },
      selected: { id: "SLICE-001" }
    })
  });
  return renderFamilyNeutralAdvisoryReviewInput(
    createAdvisoryReviewInput({ descriptor, checkoutRoot: "/checkout", toolProfile: role })
  );
}

test("role guides resolve from the owning package and stay concise", () => {
  assert.deepEqual([...AGENT_ROLE_GUIDES], ["orchestrator", "direct-worker", "managed-worker", "reviewer"]);
  for (const guide of AGENT_ROLE_GUIDES) {
    const guidePath = resolveAgentRoleGuidePath(guide);
    assert.equal(guidePath, path.join(GUIDE_DIR, `${guide}.md`));
    assert.ok(existsSync(guidePath), `${guide} guide must ship in agent-launch-core data/`);
    const text = readAgentRoleGuide(guide);
    assert.equal(text, readFileSync(guidePath, "utf8").trim());
    assert.match(text, /^# /u);
    assert.ok(words(text) <= 400, `${guide} guide must stay concise; got ${words(text)} words`);
  }
  assert.throws(() => resolveAgentRoleGuidePath("worker"), /unknown agent role guide/u);
});

test("each guide carries only its own role's workflow", () => {
  const direct = readAgentRoleGuide("direct-worker");
  const managed = readAgentRoleGuide("managed-worker");
  const reviewer = readAgentRoleGuide("reviewer");
  assert.doesNotMatch(direct, /workspace_|writable|readable scope/u);
  assert.doesNotMatch(managed, /\bpush\b|target branch|AGENTS\.md/iu);

  assert.doesNotMatch(managed, /workspace_verify_proof|then commit/u);
  assert.doesNotMatch(reviewer, /\bcommit\b|\bpush\b|workspace_agent_dispatch|AGENTS\.md/iu);
  for (const guide of [managed, readAgentRoleGuide("orchestrator")]) {
    assert.match(guide, /Missing shell (commands|tools) do not establish (structured-)?provider unavailability/u);
  }
});

test("orchestrator startup prompts name the resolved guide path once without inlining it", () => {
  const guidePath = resolveAgentRoleGuidePath("orchestrator");
  const guide = readAgentRoleGuide("orchestrator");
  for (const appName of ["Claude", "Codex"]) {
    for (const headless of [true, false]) {
      const prompt = renderLauncherFamilyOrchestratorPrompt({
        appName,
        initiative: "IN-0016",
        threadName: "IN-0016",
        workspaceDir: "/work/repo",
        headless
      });
      assert.equal(occurrences(prompt, guidePath), 1, `${appName} headless=${headless}`);
      assert.ok(!prompt.includes(guide.split("\n")[2]), "guide text is referenced, not inlined");
      assert.match(prompt, new RegExp(`You are the ${appName} orchestrator for IN-0016\\.`, "u"));
      assert.match(prompt, /Workspace directory: \/work\/repo\./u);
      assert.equal(prompt.includes("Run UNATTENDED to completion"), headless);
    }
  }
});

test("managed worker prompt inlines the managed-worker guide once before the completion protocol", () => {
  const prompt = managedWorkerPrompt();
  const guide = readAgentRoleGuide("managed-worker");
  assert.equal(occurrences(prompt, guide), 1);
  assert.equal(occurrences(prompt, IMPLEMENTATION_WORKER_INSTRUCTION), 1, "runtime instruction is preserved");
  assert.ok(prompt.indexOf(`Role: implementation worker for ${SUBJECT}.`) < prompt.indexOf(guide));
  assert.ok(prompt.indexOf(guide) < prompt.indexOf("## Canonical Record"));
  assert.ok(prompt.indexOf(guide) < prompt.indexOf("Completion protocol, in this order"));
  assert.ok(!prompt.includes(resolveAgentRoleGuidePath("managed-worker")), "confined prompt carries text, not a path");
  for (const other of ["# Direct implementation worker", "# Reviewer", "# Orchestrator"]) {
    assert.ok(!prompt.includes(other));
  }

  for (const forbidden of [/\bCodex\b/u, /\bClaude\b/u, /\bBash\b/u, /bwrap|namespace|mounts?\b/iu, /reviewer/iu]) {
    assert.doesNotMatch(guide, forbidden);
  }
  assert.ok(!prompt.includes("AGENTS.md"));
});

test("managed reviewer and redteam inputs inline the reviewer guide once", () => {
  const guide = readAgentRoleGuide("reviewer");
  for (const role of ["reviewer", "redteam"]) {
    const prompt = advisoryPrompt(role);
    assert.equal(occurrences(prompt, guide), 1, role);
    assert.ok(!prompt.includes(resolveAgentRoleGuidePath("reviewer")));
    assert.match(prompt, new RegExp(`Canonical role: ${role}`, "u"));
    assert.match(prompt, /Return advisory text\. Structured formatting is optional/u);
    assert.ok(!prompt.includes("# Managed implementation worker"));
  }
});

test("generic launcher role contracts inline the same guide once per role", () => {
  const cases = [
    ["worker", "managed-worker", "# Reviewer\n"],
    ["reviewer", "reviewer", "# Managed implementation worker"],
    ["redteam", "reviewer", "# Managed implementation worker"]
  ];
  for (const appName of ["Claude", "Codex"]) {
    for (const [role, guideName, other] of cases) {
      const contract = renderLauncherFamilyRoleContract({ appName, role, subject: SUBJECT });
      assert.equal(occurrences(contract, readAgentRoleGuide(guideName)), 1, `${appName} ${role}`);
      assert.ok(!contract.includes(other), `${appName} ${role} carries only its own guide`);
      assert.ok(!contract.includes("AGENTS.md"));
    }
  }
});
