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
  resolveAgentRoleGuidePath,
  resolveOrchestratorAuthoringVignettePath
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

const GUIDE_WORD_CAPS = Object.freeze({ orchestrator: 1070, "managed-worker": 600, reviewer: 600 });
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

test("orchestrator guide explains the read-only checkout and the supported test route", () => {
  const orchestrator = readAgentRoleGuide("orchestrator");
  const route = [
    "In the managed environment, the product checkout is read-only apart from authorized coordination writes.",
    "Run native tests with workspace_run_test and saved proofs with verify_proof; never modify the checkout, dependencies or configuration to make direct shell tests work.",
    "A direct shell test’s environment failure does not establish that the supported test runtime is broken; use that route and diagnose its actual result."
  ];
  for (const instruction of route) {
    assert.equal(occurrences(orchestrator, instruction), 1, instruction);
  }

  assert.ok(orchestrator.includes(`${route.join(" ")} verify_proof executes saved proofs against tested source;`));

  assert.doesNotMatch(orchestrator, /\bava\b|npm test/iu);
});

test("orchestrator guide decomposes the request before dispatch and bounds completion claims by evidence", () => {
  const orchestrator = readAgentRoleGuide("orchestrator");

  for (const [anchor, addition] of [
    ["Clarify ambiguity, narrowing or added scope with the user.",
      "Before dispatch, decompose the request into precise, independently checkable requirements, accounting for " +
      "every behavior-bearing clause, including the defaults, exceptions, options and interactions it states or " +
      "necessarily implies. Keep ambiguity that is not yet clarified explicit; never silently narrow the request or " +
      "invent requirements. Derive acceptance, contracts, obligations and assignments from these requirements,"],
    ["Saved proofs are primary acceptance checks: map every material requirement to the assertions or other " +
      "evidence that would establish it.",
    "Evidence may be shared where it genuinely establishes each requirement it is mapped to; this needs no " +
      "criterion, obligation or test per clause, no exhaustive combinations and no separate tracking document."],
    ["validity and passing checks establish neither semantic coverage nor discriminating assertions.",
      "Before accepting delivery, revisit that mapping against the delivered source and its actual assertions, and " +
      "bind evidence to source. Distinguish supported, unmet and unverified requirements; completion claims must " +
      "not exceed the evidence."]
  ]) {
    assert.equal(occurrences(orchestrator, `${anchor} ${addition}`), 1, addition);
  }

  assert.ok(!orchestrator.includes("map every material requirement to evidence."));
  assert.ok(!orchestrator.includes("Check delivered source and tests against requirements"));
});

test("orchestrator guide selects slice regressions and reads their outcomes beside the proofs", () => {
  const orchestrator = readAgentRoleGuide("orchestrator");

  for (const [anchor, addition] of [
    ["Limit write_scope independently to intended changes.",
      "When shaping a slice, select relevant existing regression test files and save them as its regression_tests; " +
      "prefer tests outside its write_scope, as advice rather than a gate."],
    ["prefer tests outside its write_scope, as advice rather than a gate.",
      "Use query_code_index references and impact information to identify affected callers and relevant existing " +
      "tests, including consumers outside the edit scope. Inspect candidates, assign appropriate regression_tests " +
      "to the relevant workers, and include necessary supporting context in read_scope. Account for incomplete " +
      "index coverage; absence from results does not establish irrelevance."],
    ["completion claims must not exceed the evidence.",
      "A slice verify_proof also runs each declared regression file once, on the host, even outside the worker's " +
      "read_scope and without widening access; an omitted list runs none and claims no regression pass, and a file " +
      "whose project configures no single runner is reported, never guessed. Inspect both proof and regression " +
      "outcomes before claiming verification succeeded."]
  ]) {
    assert.equal(occurrences(orchestrator, `${anchor} ${addition}`), 1, addition);
  }

  assert.equal(occurrences(orchestrator, "regression_tests"), 2);

  assert.doesNotMatch(orchestrator, /full (?:existing )?(?:test )?suite|entire (?:test )?suite|benchmark/iu);
  assert.doesNotMatch(orchestrator, /regression[^.]*\b(?:runner:|command|must not overlap|cannot be modified)/iu);

  assert.equal(occurrences(orchestrator, "Run native tests with workspace_run_test and saved proofs with verify_proof;"), 1);
});

test("orchestrator guide orders WK closeout before final publication", () => {
  const orchestrator = readAgentRoleGuide("orchestrator");
  const closeout = "Complete applicable WK closeout writes before final publication. If you change the WK after publication but before landing, refresh it with workspace_publish_work before exiting. Publication does not establish landing.";
  assert.equal(occurrences(orchestrator, closeout), 1);

  assert.ok(!orchestrator.includes("close explicitly through save_record"));
});

test("the authoring vignette ships beside the guides and the startup line requires it", () => {
  const orchestrator = readAgentRoleGuide("orchestrator");
  const reference = { tool_name: "save_record", path: "docs/orchestrator-authoring-vignette.md" };

  assert.equal(occurrences(orchestrator, "vignette"), 0);

  assert.equal(occurrences(orchestrator, "workspace_read_wiki initially returns compact context. When you need a " +
    "selected document or guidance topic, follow its returned read call to obtain the content; the summary is not " +
    "the selected content."), 1);

  const vignettePath = resolveOrchestratorAuthoringVignettePath();
  assert.equal(vignettePath, path.join(GUIDE_DIR, path.basename(reference.path)));
  assert.equal(path.dirname(vignettePath), resolveAgentRoleGuideDirectory());
  const canonical = readFileSync(path.join(REPO_ROOT, reference.path));
  assert.ok(readFileSync(vignettePath).equals(canonical), "the shipped vignette is the canonical document");
  assert.equal(renderAgentRoleGuideReadReference("orchestrator"),
    `Read your orchestrator guide at ${resolveAgentRoleGuidePath("orchestrator")} and the authoring vignette at ` +
    `${vignettePath} before authoring.`);

  for (const guide of ["managed-worker", "reviewer"]) {
    assert.equal(renderAgentRoleGuideReadReference(guide).includes("vignette"), false, guide);
  }

  const json = (relative) => JSON.parse(readFileSync(path.join(REPO_ROOT, relative), "utf8"));
  const row = json("packages/wiki-core/data/tool-discovery/mcp-tools.json").tools
    .find((tool) => tool.tool_name === reference.tool_name);
  assert.equal(row.docs_refs.filter((ref) => ref === reference.path).length, 1);
  const entry = json("packages/core/docs/public-docs-manifest.json").entries
    .find((candidate) => candidate.logical_path === reference.path);
  assert.deepEqual([entry?.available, entry?.advertised_by_built_in_descriptor, entry?.bundle_path],
    [true, true, reference.path]);
});

test("managed worker guide stops on a scope or access blocker and keeps tests to assigned verification", () => {
  const paragraphs = readAgentRoleGuide("managed-worker").split("\n\n");
  const managed = paragraphs.join("\n\n");
  const scope = [
    "Read and write only within the session's declared scopes.",
    "STOP IMMEDIATELY if completing the assignment requires missing information, additional access, broader scope, or an assignment correction.",
    "Report the specific blocker and what the coordinator must supply or change, then end the attempt as blocked.",
    "Do not continue implementation, guess the missing information, or find another route around the restriction.",
    "A tool's ability to perform an operation does not authorize it."
  ];
  const testUse = [
    "Use tests only to implement the verification described by your assignment: checking assigned behavior and required regressions.",
    "Do not create or repurpose tests as an information-gathering channel—for example, to inspect inaccessible source, enumerate unrelated files, read coordination records, or dump their contents through test output.",
    "If you need that information, STOP IMMEDIATELY and report the missing access to the coordinator; do not obtain it indirectly through test execution."
  ];
  for (const instruction of [...scope, ...testUse]) {
    assert.equal(occurrences(managed, instruction), 1, instruction);
  }

  const scopeIndex = paragraphs.indexOf(scope.join(" "));
  const testUseIndex = paragraphs.indexOf(testUse.join(" "));
  assert.ok(scopeIndex > 0, "scope and blocker paragraph");
  assert.ok(paragraphs[testUseIndex - 1]?.startsWith("Run tests through authorized structured execution."),
    "test-use paragraph sits beside the test-execution guidance");

  for (const replaced of ["If you encounter a blocker", "Do not invent missing requirements", "work around access limits"]) {
    assert.ok(!managed.includes(replaced), replaced);
  }

  for (const preserved of [
    "Run tests through authorized structured execution. Shell access alone does not authorize test execution.",
    "Do not weaken requirements or reshape production code to fit a proof mechanism.",
    "Use workspace_run_test for native tests, verify_proof for saved proof execution and get_run_result for returned or assigned results.",
    "Finish the implementation with workspace_deliver_work({}), the closed empty request bound to your launcher assignment, and use the runtime's result format."
  ]) {
    assert.equal(occurrences(managed, preserved), 1, preserved);
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
  return guide === "orchestrator"
    ? `Read your orchestrator guide at ${resolveAgentRoleGuidePath(guide)} and the authoring vignette at ` +
      `${resolveOrchestratorAuthoringVignettePath()} before authoring.`
    : `Read your ${guide} guide before acting: ${resolveAgentRoleGuidePath(guide)}`;
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
