import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AGENT_ROLE_GUIDES,
  readAgentRoleGuide,
  renderAgentRoleGuideReadReference,
  resolveAgentRoleGuideDirectory,
  resolveAgentRoleGuidePath
} from "../../packages/agent-launch-core/src/lib/agent-role-guides.mjs";
import {
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

const GUIDE_WORD_CAPS = Object.freeze({ orchestrator: 700, "managed-worker": 600, reviewer: 600 });
const words = (text) => text.split(/\s+/u).filter(Boolean).length;

function managedWorkerPrompt({ assignmentDelivery = "inline" } = {}) {
  return buildLaunchPrompt({
    assignmentDelivery,
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
  assert.deepEqual([...AGENT_ROLE_GUIDES], ["orchestrator", "managed-worker", "reviewer"]);

  assert.equal(resolveAgentRoleGuideDirectory(), GUIDE_DIR);
  for (const guide of AGENT_ROLE_GUIDES) {
    const guidePath = resolveAgentRoleGuidePath(guide);
    assert.equal(guidePath, path.join(resolveAgentRoleGuideDirectory(), `${guide}.md`));
    assert.ok(existsSync(guidePath), `${guide} guide must ship in agent-launch-core data/`);
    const text = readAgentRoleGuide(guide);
    assert.equal(text, readFileSync(guidePath, "utf8").trim());
    assert.match(text, /^# /u);
    assert.ok(words(text) <= GUIDE_WORD_CAPS[guide],
      `${guide} guide must stay within ${GUIDE_WORD_CAPS[guide]} words; got ${words(text)}`);
  }
  assert.throws(() => resolveAgentRoleGuidePath("worker"), /unknown agent role guide/u);
});

test("orchestrator guide owns blocked-validation recovery and accurate result reporting", () => {
  const orchestrator = readAgentRoleGuide("orchestrator");
  for (const instruction of [
    "Never bypass controls or fabricate evidence.",
    "When a worker reports that required validation is blocked, repair the assignment’s execution prerequisites and retry.",
    "Do not waive or weaken the requirement merely to unblock delivery, or substitute narrower passing checks for it.",
    "If recovery requires changing requirements, explain the proposed change and obtain user direction.",
    "Keep task instructions, acceptance criteria, and validation consistent.",
    "Missing fixtures establish an execution-environment problem, not a passing regression result.",
    "A test that ran and failed must not be reported as ‘not run.’"
  ]) {
    assert.equal(occurrences(orchestrator, instruction), 1, instruction);
  }

  assert.ok(!orchestrator.includes("fabricate evidence or weaken requirements"));

  for (const [anchor, addition] of [
    ["Report the exact blocker with its supported or missing recovery route.", "When a worker reports that required validation is blocked"],
    ["Missing shell commands do not establish provider unavailability.", "Missing fixtures establish an execution-environment problem"],
    ["State what passed, failed or did not run with exact identities and actionable corrections.", "A test that ran and failed must not be reported"]
  ]) {
    assert.ok(orchestrator.includes(`${anchor} ${addition}`), addition);
  }
});

test("each guide carries only its own role's workflow", () => {
  const managed = readAgentRoleGuide("managed-worker");
  const reviewer = readAgentRoleGuide("reviewer");
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
      assert.equal(occurrences(prompt, readLine("orchestrator")), 1, `${appName} headless=${headless}`);
      assert.ok(!prompt.includes(guide.split("\n")[2]), "guide text is referenced, not inlined");
      assert.match(prompt, new RegExp(`You are the ${appName} orchestrator for IN-0016\\.`, "u"));
      assert.match(prompt, /Workspace directory: \/work\/repo\./u);
      assert.equal(prompt.includes("Run UNATTENDED to completion"), headless);
    }
  }
});

function readLine(guide) {
  return `Read your ${guide} guide before acting: ${resolveAgentRoleGuidePath(guide)}`;
}

test("one shared helper renders every role's guide read reference", () => {
  for (const guide of AGENT_ROLE_GUIDES) {
    assert.equal(renderAgentRoleGuideReadReference(guide), readLine(guide), guide);
  }
  assert.throws(() => renderAgentRoleGuideReadReference("worker"), /unknown agent role guide/u);
});

function guideBodyLines(guide) {
  return readAgentRoleGuide(guide).split("\n").filter((line) => line.trim().length > 0);
}

function assertNoGuideBody(prompt, label) {
  for (const guide of AGENT_ROLE_GUIDES) {
    for (const line of guideBodyLines(guide)) {
      assert.ok(!prompt.includes(line), `${label}: embeds ${guide} guide text: ${line}`);
    }
  }
}

test("managed worker prompt names the managed-worker guide path once before the completion protocol", () => {
  for (const assignmentDelivery of ["inline", "read_page"]) {
    const prompt = managedWorkerPrompt({ assignmentDelivery });
    const line = readLine("managed-worker");
    assert.equal(occurrences(prompt, line), 1, assignmentDelivery);
    assert.equal(occurrences(prompt, "guide before acting:"), 1, assignmentDelivery);
    assertNoGuideBody(prompt, assignmentDelivery);
    assert.ok(prompt.indexOf(`Role: implementation worker for ${SUBJECT}.`) < prompt.indexOf(line));
    assert.ok(prompt.indexOf(line) < prompt.indexOf("Completion protocol, in this order"));
    assert.ok(!prompt.includes("AGENTS.md"));
  }
  const inline = managedWorkerPrompt({ assignmentDelivery: "inline" });

  for (const prompt of [inline, managedWorkerPrompt({ assignmentDelivery: "read_page" })]) {
    assert.doesNotMatch(prompt,
      /Implement the assigned task|acceptance validation outside this assignment|Do not rely on hidden coordinator chat context/u);
  }
  assert.ok(inline.indexOf(readLine("managed-worker")) < inline.indexOf("## Canonical Record"));

  const guide = readAgentRoleGuide("managed-worker");
  for (const forbidden of [/\bCodex\b/u, /\bClaude\b/u, /\bBash\b/u, /bwrap|namespace|mounts?\b/iu, /reviewer/iu]) {
    assert.doesNotMatch(guide, forbidden);
  }
});

test("managed reviewer and redteam inputs name the reviewer guide path once", () => {
  for (const role of ["reviewer", "redteam"]) {
    const prompt = advisoryPrompt(role);
    assert.equal(occurrences(prompt, readLine("reviewer")), 1, role);
    assert.equal(occurrences(prompt, "guide before acting:"), 1, role);
    assertNoGuideBody(prompt, role);
    assert.match(prompt, new RegExp(`Canonical role: ${role}`, "u"));
    assert.match(prompt, /Return advisory text\. Structured formatting is optional/u);
    assert.match(prompt, /Your assignment is not included in this startup text/u);
  }
});

test("generic launcher role contracts name the role's guide path once", () => {
  const cases = [
    ["worker", "managed-worker"],
    ["reviewer", "reviewer"],
    ["redteam", "reviewer"]
  ];
  for (const appName of ["Claude", "Codex"]) {
    for (const [role, guideName] of cases) {
      const contract = renderLauncherFamilyRoleContract({ appName, role, subject: SUBJECT });
      assert.equal(occurrences(contract, readLine(guideName)), 1, `${appName} ${role}`);
      assert.equal(occurrences(contract, "guide before acting:"), 1, `${appName} ${role}`);
      assertNoGuideBody(contract, `${appName} ${role}`);
      assert.ok(!contract.includes("AGENTS.md"));
    }
  }
});
