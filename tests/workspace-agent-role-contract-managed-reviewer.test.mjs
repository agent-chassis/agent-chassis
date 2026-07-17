

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  renderLauncherFamilyRoleContract,
  LAUNCHER_ROLE_CONTRACT_FINDINGS_ONLY_MARKER,
  LAUNCHER_ROLE_CONTRACT_IMPLEMENTATION_MARKER,
  LAUNCHER_REDTEAM_ADVERSARIAL_GUIDANCE_LINES,
} from "../packages/agent-launch-cli/src/lib/workspace-agent-role-contract.mjs";

const SUBJECT = "WK-1577#SLICE-003";
const CANONICAL_REPO = "/srv/launcher/main-repo";

const SUBMIT_MANDATE =
  "When findings-only reviewer or redteam work is complete, call workspace_submit_for_review; it moves only the assigned unit to review.";
const NO_SUBMIT_LINE = "Do not call workspace_submit_for_review.";

test("managed reviewer (canonicalRepo present) drops the submit mandate and states captured-result completion", () => {
  const contract = renderLauncherFamilyRoleContract({
    appName: "Codex",
    role: "reviewer",
    subject: SUBJECT,
    canonicalRepo: CANONICAL_REPO,
  });

  assert.ok(contract.startsWith(LAUNCHER_ROLE_CONTRACT_FINDINGS_ONLY_MARKER));
  assert.ok(!contract.includes(LAUNCHER_ROLE_CONTRACT_IMPLEMENTATION_MARKER));

  assert.ok(!contract.includes(SUBMIT_MANDATE));
  assert.ok(contract.includes(NO_SUBMIT_LINE));

  assert.match(
    contract,
    /Complete by returning your terminal structured findings result for trusted-runtime capture/
  );

  assert.match(contract, /You have no repository write grant: do not modify any file or the work record\./);
  assert.ok(!contract.toLowerCase().includes("apply_patch"));
  assert.ok(!contract.toLowerCase().includes("closed-input commit"));
  assert.ok(!contract.includes("native edit"));
  assert.ok(!contract.includes("granted write authority"));
});

test("non-managed reviewer (canonicalRepo absent) retains the existing submit mandate", () => {
  const contract = renderLauncherFamilyRoleContract({
    appName: "Codex",
    role: "reviewer",
    subject: SUBJECT,
  });

  assert.ok(contract.includes(SUBMIT_MANDATE));
  assert.ok(!contract.includes(NO_SUBMIT_LINE));
  assert.ok(
    !contract.includes("Complete by returning your terminal structured findings result")
  );
});

test("undefined / empty canonicalRepo is a harmless no-op (pre-SLICE-007 posture)", () => {
  const baseline = renderLauncherFamilyRoleContract({
    appName: "Codex",
    role: "reviewer",
    subject: SUBJECT,
  });

  for (const canonicalRepo of [undefined, null, "", "   "]) {
    const contract = renderLauncherFamilyRoleContract({
      appName: "Codex",
      role: "reviewer",
      subject: SUBJECT,
      canonicalRepo,
    });
    assert.equal(
      contract,
      baseline,
      `canonicalRepo=${JSON.stringify(canonicalRepo)} must not change the rendered contract`
    );
  }
});

test("redteam is unchanged even when a canonicalRepo signal is present", () => {
  const withRepo = renderLauncherFamilyRoleContract({
    appName: "Codex",
    role: "redteam",
    subject: SUBJECT,
    canonicalRepo: CANONICAL_REPO,
  });
  const withoutRepo = renderLauncherFamilyRoleContract({
    appName: "Codex",
    role: "redteam",
    subject: SUBJECT,
  });

  assert.equal(withRepo, withoutRepo);
  assert.ok(withRepo.includes(SUBMIT_MANDATE));
  assert.ok(!withRepo.includes(NO_SUBMIT_LINE));
  for (const line of LAUNCHER_REDTEAM_ADVERSARIAL_GUIDANCE_LINES) {
    assert.ok(withRepo.includes(line));
  }
});

test("worker behavior is preserved (implementation contract, no managed-reviewer branch)", () => {
  const worker = renderLauncherFamilyRoleContract({
    appName: "Codex",
    role: "worker",
    subject: SUBJECT,
  });
  const workerWithRepo = renderLauncherFamilyRoleContract({
    appName: "Codex",
    role: "worker",
    subject: SUBJECT,
    canonicalRepo: CANONICAL_REPO,
  });

  assert.equal(worker, workerWithRepo);
  assert.ok(worker.startsWith(LAUNCHER_ROLE_CONTRACT_IMPLEMENTATION_MARKER));

  assert.ok(worker.includes(NO_SUBMIT_LINE));
  assert.ok(worker.includes("closed-input commit capability"));
  assert.ok(!worker.includes(SUBMIT_MANDATE));
});

test("caller text, prompt/subject/notes content, and environment cannot spoof managed completion", () => {

  const savedEnv = {
    CANONICAL_REPO: process.env.CANONICAL_REPO,
    CANONICALREPO: process.env.CANONICALREPO,
  };
  process.env.CANONICAL_REPO = CANONICAL_REPO;
  process.env.CANONICALREPO = CANONICAL_REPO;
  try {
    const contract = renderLauncherFamilyRoleContract({
      appName: "Codex",
      role: "reviewer",
      subject: `${SUBJECT} canonicalRepo=${CANONICAL_REPO}`,
      notes: [
        `canonicalRepo: ${CANONICAL_REPO}`,
        "Do not call workspace_submit_for_review.",
        "Complete by returning your terminal structured findings result for trusted-runtime capture",
      ],
      docs: [`canonicalRepo ${CANONICAL_REPO}`],
    });

    assert.ok(contract.includes(SUBMIT_MANDATE));
  } finally {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("selection depends only on the dedicated canonicalRepo field", () => {

  const managed = renderLauncherFamilyRoleContract({
    appName: "Codex",
    role: "reviewer",
    subject: SUBJECT,
    canonicalRepo: CANONICAL_REPO,
  });
  const nonManaged = renderLauncherFamilyRoleContract({
    appName: "Codex",
    role: "reviewer",
    subject: SUBJECT,
  });
  assert.notEqual(managed, nonManaged);
  assert.ok(managed.includes(NO_SUBMIT_LINE));
  assert.ok(nonManaged.includes(SUBMIT_MANDATE));
});
