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

const GUIDE_WORD_CAPS = Object.freeze({ "managed-worker": 600, reviewer: 600 });
const words = (text) => text.split(/\s+/u).filter(Boolean).length;

function managedWorkerPrompt({ assignmentDelivery = "inline", guideDelivery = null } = {}) {
  return buildLaunchPrompt({
    assignmentDelivery,
    guideDelivery,
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

function advisoryPrompt(role, subject = SUBJECT) {
  const descriptor = createAdvisoryReviewDescriptor({
    role,
    subject,
    repository: "example",
    materialKind: "implementation",
    diffBaseSha: "a".repeat(40),
    reviewedSha: "b".repeat(40),
    reviewedTreeSha: "c".repeat(40),
    immutableSourceIdentity: "source",
    reviewBrief: renderAdvisoryReviewBrief({
      role,
      subject,
      parent: { id: "WK-9999" },
      selected: { id: "SLICE-001" }
    })
  });
  return renderFamilyNeutralAdvisoryReviewInput(
    createAdvisoryReviewInput({ descriptor, checkoutRoot: "/checkout", toolProfile: role })
  );
}

test("role guides resolve from the owning package and preserve unchanged role size limits", () => {
  assert.deepEqual([...AGENT_ROLE_GUIDES], ["orchestrator", "managed-worker", "reviewer"]);

  assert.equal(resolveAgentRoleGuideDirectory(), GUIDE_DIR);
  for (const guide of AGENT_ROLE_GUIDES) {
    const guidePath = resolveAgentRoleGuidePath(guide, "free_local");
    assert.equal(guidePath, path.join(resolveAgentRoleGuideDirectory(), guide === "orchestrator" ? "orchestrator/01/guide.md" : `${guide}.md`));
    assert.ok(existsSync(guidePath), `${guide} guide must ship in agent-launch-core data/`);
    const text = readAgentRoleGuide(guide, "free_local");
    assert.equal(text, readFileSync(guidePath, "utf8").trim());
    assert.match(text, /^# /u);
    if (GUIDE_WORD_CAPS[guide] !== undefined) assert.ok(words(text) <= GUIDE_WORD_CAPS[guide],
      `${guide} guide must stay within ${GUIDE_WORD_CAPS[guide]} words; got ${words(text)}`);
  }
  assert.throws(() => resolveAgentRoleGuidePath("worker", "free_local"), /unknown agent role guide/u);
});

function requiresInstructions(text, instructions) {
  for (const instruction of instructions) assert.equal(occurrences(text, instruction), 1, instruction);
}

test("orchestrator guide owns blocked-validation recovery and accurate result reporting", () => {
  requiresInstructions(readAgentRoleGuide("orchestrator", "free_local"), [
    "When validation is blocked, follow the returned recovery within your authority.",
    "Delegate any required repository changes.",
    "If a worker reports missing access or context through `request_assignment_change`, correct the assignment.",
    "Follow the run result's recovery instructions and launch a replacement as directed.",
    "Retry validation when its prerequisite is restored; otherwise report the specific blocker.",
    "Do not weaken requirements or substitute narrower passing checks.",
    "Changing requirements needs user direction.",
    "Report failures, skipped checks and execution blockers accurately.",
    "Assign defects and missing evidence for repair.",
    "Run repaired checks even if they previously passed with inadequate assertions.",
    "Rerun other failed checks and required regressions on the repaired delivery.",
    "If repair or validation cannot proceed, leave the requirement unresolved and report its blocker.",
    "A review exemption does not waive repair."
  ]);
});

test("orchestrator guide explains the read-only checkout and the supported test route", () => {
  const guide = readAgentRoleGuide("orchestrator", "free_local");
  requiresInstructions(guide, [
    "Delegate assigned implementation and documentation changes; do not make them yourself.",
    "Follow user direction and repository policy for dispatch.",
    "After delivery, run native validation with `workspace_run_test` and selected saved proofs with `verify_proof`.",
    "Do not change checkout files, dependencies or configuration to bypass a validation failure or refusal.",
    "Use the delivery and validation calls returned by the tools."
  ]);
  assert.doesNotMatch(guide, /\bava\b|npm test/iu);
});

test("orchestrator guide decomposes the request and bounds completion claims by evidence", () => {
  const guide = readAgentRoleGuide("orchestrator", "free_local");
  for (const pattern of [
    /Save the complete current request through `changes.user_requirements` in `save_record`/u,
    /superseded instructions through `changes.entries`/u,
    /append a version under its returned ID/u,
    /Keep the current instruction clear in `sections.user_requirements`/u,
    /Follow the unit's entry schema and inventory reads/u,
    /Map each independently checkable requirement to evidence that would establish it/u,
    /which incorrect behavior they must reject/u,
    /do not assume that every clause needs a separate record or test/u,
    /Run checks and inspect files from the delivery being evaluated/u,
    /Check that test results and inspected files identify that same delivery/u,
    /Inspect the delivered implementation and test assertions against every requirement/u,
    /A passing test or detected fault supports only what the check observes/u,
    /Report supported requirements with their evidence/u
  ]) assert.match(guide, pattern);
});

test("orchestrator guide resolves authoring gaps without demanding execution before delivery", () => {
  const guide = readAgentRoleGuide("orchestrator", "paid_cce");
  for (const pattern of [
    /link each criterion to its requirement claims and selected proof through `obligations`/u,
    /then call `workspace_assess_contract`/u,
    /For each slice requiring controlled acceptance, create obligations for its own criteria and assess it before dispatch/u,
    /Do this even if assessment reports no problems/u,
    /Follow the returned corrections and assess again/u,
    /Read the user’s request and the saved requirements side by side/u,
    /Check implementation evidence after delivery/u,
    /do not claim that authoring or assessment has tested the implementation/u,
    /Check that their planned checks would fail when the required behavior is wrong/u,
    /Follow repository authorization and review requirements/u
  ]) assert.match(guide, pattern);
  assert.ok(guide.indexOf("returned corrections and assess again") < guide.indexOf("Delegate assigned implementation"));
});

test("orchestrator guide selects regressions without treating declarations as access", () => {
  const guide = readAgentRoleGuide("orchestrator", "free_local");
  requiresInstructions(guide, [
    "Select relevant existing files as `regression_tests`; prefer tests of unchanged dependencies outside `write_scope`.",
    "Do not use a regression declaration as an access grant or protection against edits.",
    "Inspect validation, proof and declared regression outcomes."
  ]);
  assert.equal(occurrences(guide, "regression_tests"), 1);
  assert.doesNotMatch(guide, /full (?:existing )?(?:test )?suite|entire (?:test )?suite|benchmark/iu);
});

test("orchestrator guide distinguishes delivery stages and follows publication recovery", () => {
  requiresInstructions(readAgentRoleGuide("orchestrator", "free_local"), [
    "Follow the returned calls to integrate the selected delivery, inspect or advance a candidate, and publish the work.",
    "Check integration confirmation before dependent work starts.",
    "Do not report landing from publication alone.",
    "Record required validation, review and closure evidence before publication.",
    "Use `workspace_check_landing` to check whether published work has landed.",
    "If supported record changes remain unpublished and the work has not landed, follow the publication call to include them.",
    "Follow returned recovery for refusals; do not alter records to bypass them."
  ]);
});

test("orchestrator guide binds the user-selected initiative and uses current revisions", () => {
  for (const tier of ["free_local", "paid_cce"]) requiresInstructions(readAgentRoleGuide("orchestrator", tier), [
    "Read the unit's current revision before saving.",
    "Pass it to `save_record`, save related changes together, and refresh the revision after changes.",
    "Before dispatch, read the existing initiative selected by the user and set the parent WK's `changes.initiative` to its returned identity.",
    "If that choice is missing, ask the user; do not infer it."
  ]);
});

test("the authoring vignette ships beside the guides and the startup line requires it", () => {
  const orchestrator = readAgentRoleGuide("orchestrator", "free_local");
  const reference = { tool_name: "save_record", path: "packages/agent-launch-core/data/role-guides/orchestrator/01/authoring-vignette.md" };

  assert.equal(occurrences(orchestrator, "Before preparing acceptance and assignments, read the authoring vignette:"), 1);

  requiresInstructions(orchestrator, [
    "Follow returned calls to read complete content, consult input schemas and recover from refusals."
  ]);

  const vignettePath = resolveOrchestratorAuthoringVignettePath("free_local");
  assert.equal(vignettePath, path.join(GUIDE_DIR, "orchestrator/01/authoring-vignette.md"));
  assert.equal(path.dirname(vignettePath), path.join(resolveAgentRoleGuideDirectory(), "orchestrator/01"));
  const canonical = readFileSync(path.join(REPO_ROOT, "packages/core/docs/_refs/packages/agent-launch-core/data/role-guides/orchestrator/01/authoring-vignette.md"));
  assert.ok(readFileSync(vignettePath).equals(canonical), "the shipped vignette is the canonical document");
  assert.equal(renderAgentRoleGuideReadReference("orchestrator", "free_local"),
    `Read your orchestrator guide at ${resolveAgentRoleGuidePath("orchestrator", "free_local")} and the authoring vignette at ` +
    `${vignettePath} before authoring.`);

  for (const guide of ["managed-worker", "reviewer"]) {
    assert.equal(renderAgentRoleGuideReadReference(guide, "free_local").includes("vignette"), false, guide);
  }

  const json = (relative) => JSON.parse(readFileSync(path.join(REPO_ROOT, relative), "utf8"));
  const row = json("packages/wiki-core/data/tool-discovery/mcp-tools.json").tools
    .find((tool) => tool.tool_name === reference.tool_name);
  assert.equal(row.docs_refs.filter((ref) => ref === reference.path).length, 1);
  const entry = json("packages/core/docs/public-docs-manifest.json").entries
    .find((candidate) => candidate.logical_path === reference.path);
  assert.deepEqual([entry?.available, entry?.advertised_by_built_in_descriptor, entry?.bundle_path],
    [true, true, `docs/_refs/${reference.path}`]);
});

test("guides explain each scope, writable-file readability and assignment freezing", () => {
  const ordinary = readAgentRoleGuide("orchestrator", "free_local");
  const index = readAgentRoleGuide("orchestrator", "paid_cce");
  for (const text of [ordinary, index]) {
    for (const pattern of [
      /`read_scope`: additional code, types, callers, helpers, fixtures and configuration the worker needs to read/u,
      /`write_scope`: exact existing or new files the worker may change/u,
      /These files are also readable/u,
      /`repo_paths`: files being changed and other likely affected source, tests, documentation or fixtures for retrieval and review/u,
      /Put files needed only for background reading in `read_scope`/u,
      /Name intended changes within those files in `expected_edit_targets`/u,
      /Put all required context in the saved assignment/u,
      /Editing the saved assignment does not update an active worker/u,
      /Resolve missing context and scope before dispatch/u
    ]) assert.match(text, pattern);
    assert.doesNotMatch(text, /paid_cce|free_local|paid tier|free tier/u);
  }
  assert.doesNotMatch(ordinary, /query_code_index|SCIP/u);
  assert.match(index, /Start code investigation with `query_code_index` for change impact/u);
  assert.match(index, /do not infer that missing results mean no other code depends on the change/u);
  assert.match(readAgentRoleGuide("managed-worker"), /Before editing, check \*\*Readable Paths\*\* and \*\*Writable Paths\*\*/u);
});

test("managed worker guide requests needs with evidence and distinguishes request acceptance from refusal", () => {
  const managed = readAgentRoleGuide("managed-worker", "free_local");
  for (const instruction of [
    "If a required change needs a file you cannot edit, call request_assignment_change IMMEDIATELY. If a required file is outside **Readable Paths**, request read access through the same tool IMMEDIATELY. If required instructions or context are missing or contradictory, call request_assignment_change immediately.",
    "Describe the gap, supporting evidence, the affected requirement and what you need to implement it.",
    "For scope gaps, name each path, whether you need read or write access, and why.",
    "Request what you need; don’t give instructions.",
    "Do not guess missing assignment facts.",
    "Include `completed_work` and `remaining_work` in the request, even if implementation is incomplete; there will be no final report or subsequent tool call.",
    "When `request_assignment_change` is accepted, this worker ends immediately and partial work is preserved.",
    "A refused request does not end the worker; follow any supported recovery within your authority.",
    "A request grants no access or assignment revision."
  ]) assert.equal(occurrences(managed, instruction), 1, instruction);
  assert.doesNotMatch(managed,
    /requested correction|work around missing required context in an accessible file|report the exact cause|Refusals allow recovery/u);
  assert.doesNotMatch(managed, /finish blocked|terminate normally|Acceptance does not prove process termination/u);
  const prompt = managedWorkerPrompt();
  assert.match(prompt, /An accepted request_assignment_change immediately ends this worker through the launcher/u);
  assert.match(prompt, /no final report, additional model turn, polling or subsequent tool call/u);
});

test("managed worker guide preserves authorized validation and delivery mechanics", () => {
  const managed = readAgentRoleGuide("managed-worker", "free_local");
  for (const instruction of [
    "Managed Claude workers have native editors disabled. Edit permitted files through `Bash`, writing in place when replacing a file by rename is unavailable.",
    "Run tests through the authorized test tools. Shell access alone does not authorize running tests.",
    "A missing shell command does not mean the test tools are unavailable.",
    "Do not weaken requirements or reshape production code to fit a proof mechanism.",
    "A test failure or recoverable tool refusal alone does not establish missing assignment information or access.",
    "Follow supported tool recovery within your authority.",
    "Do not dispatch agents, edit work-record state, integrate or land deliveries.",
    "The launcher has already created your working branch.",
    "Implement and validate there, leaving assigned changes uncommitted.",
    "Do not create another branch or make a separate Git commit before delivery; moving the assigned branch can cause delivery to refuse.",
    "Deliver completed implementation with its required validation through workspace_deliver_work({}), which commits and delivers the changes and fulfills the assignment's commit requirement. Then follow the runtime's diagnostic final-report and termination instructions.",
    "Report actual tests, proof results, remaining gaps and blockers accurately; completion claims must not exceed the evidence."
  ]) assert.equal(occurrences(managed, instruction), 1, instruction);
  assert.equal(occurrences(managed, "workspace_deliver_work({})"), 1);
  assert.ok(managed.indexOf("call request_assignment_change") < managed.indexOf("Deliver completed implementation"));
  assert.doesNotMatch(managed, /Use tests only to check assigned behavior and required regressions/u);
  const prompt = managedWorkerPrompt();
  assert.match(prompt, /for delivery, \(1\) successfully invoke workspace_deliver_work/u);
});

test("each guide carries only its own role's workflow", () => {
  const managed = readAgentRoleGuide("managed-worker", "free_local");
  const reviewer = readAgentRoleGuide("reviewer", "free_local");
  assert.doesNotMatch(managed, /\bpush\b|target branch|AGENTS\.md/iu);

  assert.doesNotMatch(managed, /workspace_verify_proof|then commit/u);
  assert.doesNotMatch(reviewer, /\bcommit\b|\bpush\b|workspace_agent_dispatch|AGENTS\.md/iu);
  assert.match(managed, /A missing shell command does not mean the test tools are unavailable/u);
  assert.match(readAgentRoleGuide("orchestrator", "free_local"),
    /Use the delivery and validation calls returned by the tools/u);
});

test("orchestrator startup prompts name the resolved guide path once without inlining it", () => {
  const guidePath = resolveAgentRoleGuidePath("orchestrator", "free_local");
  const guide = readAgentRoleGuide("orchestrator", "free_local");
  for (const appName of ["Claude", "Codex"]) {
    for (const headless of [true, false]) {
      const prompt = renderLauncherFamilyOrchestratorPrompt({
        appName,
        initiative: "IN-0016",
        threadName: "IN-0016",
        workspaceDir: "/work/repo",
        headless, registeredTier: "free_local"
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
    ? `Read your orchestrator guide at ${resolveAgentRoleGuidePath(guide, "free_local")} and the authoring vignette at ` +
      `${resolveOrchestratorAuthoringVignettePath("free_local")} before authoring.`
    : `Read your ${guide} guide before acting: ${resolveAgentRoleGuidePath(guide, "free_local")}`;
}

test("one shared helper renders every role's guide read reference", () => {
  for (const guide of AGENT_ROLE_GUIDES) {
    assert.equal(renderAgentRoleGuideReadReference(guide, "free_local"), readLine(guide), guide);
  }
  assert.throws(() => renderAgentRoleGuideReadReference("worker", "free_local"), /unknown agent role guide/u);
});

function guideBodyLines(guide) {
  return readAgentRoleGuide(guide, "free_local").split("\n").filter((line) => line.trim().length > 0);
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

  const guide = readAgentRoleGuide("managed-worker", "free_local");
  for (const forbidden of [/bwrap|namespace|mounts?\b/iu, /reviewer/iu]) {
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

test("redteam guide unconditionally challenges design and discovers parent slice assignments", () => {
  const guide = readAgentRoleGuide("reviewer", "free_local");
  requiresInstructions(guide, [
    "Redteam challenges the proposed design before implementation.",
    "Compare the proposed assignments with the complete user request and relevant source.",
    "Compare the obligations with the complete user request and relevant source, not just the saved requirements.",
    "Identify missing, weakened or unsupported interpretations.",
    "Return findings only; the orchestrator evaluates them and owns any saved-contract updates before implementation dispatch.",
    "Check that the proposed obligations cover the user’s requirements, including interactions and failure cases, and that their planned checks would fail if the required behavior were wrong.",
    "Report missing coverage and weak checks.",
    "For each gap, propose the smallest concrete correction to the assignment, requirement, obligation or planned check.",
    "Explain which missing behavior it covers and how the check would detect an incorrect implementation.",
    "If a correction requires an unresolved user decision, identify that decision rather than inventing an answer.",
    "This reviews obligation design; do not execute proofs or claim that the implementation satisfies the obligations.",
    "For a parent WK, use workspace_read_wiki and its returned references and selections to discover and read the proposed slice assignments, their requirements, obligations and planned checks.",
    "An empty parent summary does not establish that no design exists.",
    "Missing design material remains reportable; missing implementation is expected.",
    "Implementation commits are not required; their absence is not a finding or a reason to request implementation before completing the design challenge."
  ]);
  assert.doesNotMatch(guide, /For a design redteam/u);
});

test("root and slice redteam startup always names a design challenge with supporting checkout context", () => {
  for (const subject of ["WK-9999", SUBJECT]) {
    const prompt = advisoryPrompt("redteam", subject);
    requiresInstructions(prompt, [
      "Challenge the proposed design before implementation.",
      "Examine the user requirements, proposed assignments, obligations, assumptions, interactions and planned checks.",
      "Compare the obligations with the complete user request and relevant source, not just the saved requirements.",
      "Identify missing, weakened or unsupported interpretations.",
      "Return findings only; the orchestrator evaluates them and owns any saved-contract updates before implementation dispatch.",
      "Check that the proposed obligations cover the user’s requirements, including interactions and failure cases, and that their planned checks would fail if the required behavior were wrong.",
      "Report missing coverage and weak checks.",
      "For each gap, propose the smallest concrete correction to the assignment, requirement, obligation or planned check.",
      "Explain which missing behavior it covers and how the check would detect an incorrect implementation.",
      "If a correction requires an unresolved user decision, identify that decision rather than inventing an answer.",
      "This reviews obligation design; do not execute proofs or claim that the implementation satisfies the obligations.",
      "Implementation commits are not required. Their absence is not a finding or a reason to request implementation before completing the design challenge.",
      "An explicitly supplied SHA can select supporting checkout context; it never changes redteam into an implementation review.",
      `Supporting source context checkout: ${"b".repeat(40)}`,
      `Supporting source context tree: ${"c".repeat(40)}`
    ]);
    assert.doesNotMatch(prompt, /Reviewed range|Reviewed tree/u);
    assert.equal(prompt.includes(`${"a".repeat(40)}..${"b".repeat(40)}`), false);
    assert.ok(prompt.includes(JSON.stringify({ subject })));
  }
  const reviewer = advisoryPrompt("reviewer");
  assert.ok(reviewer.includes(`Reviewed range: ${"a".repeat(40)}..${"b".repeat(40)}`));
  assert.ok(reviewer.includes(`Reviewed tree: ${"c".repeat(40)}`));
  assert.doesNotMatch(reviewer, /Challenge the proposed design|Supporting source context|proposed obligations|For each gap/u);
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

test("complete orchestrator guidance preserves acceptance policy and owns exception lookups in the vignette", () => {
  for (const tier of ["free_local", "paid_cce"]) {
    const guide = readAgentRoleGuide("orchestrator", tier);
    for (const pattern of [
      /under user direction and repository policy/u,
      /Unavailable capability, difficulty, risk, scope or time does not authorize changing them/u,
      /Save the complete written request, criteria, validation and planned scopes/u,
      /stop before dispatch/u,
      /Delegate assigned implementation and documentation changes; do not make them yourself/u,
      /tool_name:"workspace_record_feedback",path:"docs\/agent-feedback.md"/u
    ]) assert.match(guide, pattern);
    const vignette = readFileSync(resolveOrchestratorAuthoringVignettePath(tier), "utf8");
    assert.match(`${guide}\n${vignette}`, /Do not report the written acceptance or exception as evidence that tests or proofs passed|do not claim that authoring or assessment has tested the implementation/u);
    if (tier === "free_local") {
      assert.match(vignette, /operator has explicitly selected ordinary acceptance under applicable repository policy, independently of the authoring limitation/u);
      assert.match(vignette, /"operation": "exception"/u);
      assert.match(vignette, /"kind": "controlled_acceptance"/u);
      assert.match(vignette, /Complete the required native validation and review/u);
    }
  }
  const ordinary = readAgentRoleGuide("orchestrator", "free_local");
  assert.match(ordinary, /Use your source tools to inspect relevant code, callers, dependencies/u);
  assert.doesNotMatch(ordinary, /query_code_index|paid_cce|free_local/u);
});

 test("both startup renderers omit only the reference when the guide is injected", () => {
  for (const highPriority of [true, false]) {
    const guideDelivery = { highPriority };
    for (const assignmentDelivery of ["inline", "read_page"]) {
      const prompt = managedWorkerPrompt({ assignmentDelivery, guideDelivery });
      assert.equal(prompt.includes("Read your managed-worker guide"), !highPriority);
      assert.ok(prompt.includes(SUBJECT));
    }
    const prompt = renderLauncherFamilyRoleContract({ role: "worker", subject: SUBJECT, guideDelivery });
    assert.equal(prompt.includes("Read your managed-worker guide"), !highPriority);
  }
});
