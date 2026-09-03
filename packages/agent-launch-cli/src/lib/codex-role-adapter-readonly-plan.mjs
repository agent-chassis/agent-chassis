

import path from "node:path";

import {
  assertNoConfiguredCodexRoleCommitCredential
} from "./codex-role-mcp-env.mjs";
import { renderFamilyNeutralAdvisoryReviewInput } from
  "./workspace-agent-advisory-review-contract.mjs";
import {
  ROLE_CONFIG,
  buildCodexApprovalArgsForRole,
  buildCodexSandboxArgsForRole,
  findRepoRoot
} from "./codex-role-adapter-isolation.mjs";
import { isDirectory } from "./codex-role-io.mjs";
import { buildHeadlessPlan } from "./codex-role-adapter-headless-plan.mjs";

export async function buildReadOnlyPlan({
  role,
  subject,
  promptArgs,
  env,
  cwd,
  resolvedProfile = null,
  workspaceAlias = null,
  workspaceDir = null,
  dispatchWorktreeRoot = null,
  terminalStructuredRoleResultMode = undefined,
  advisoryReviewInput = null
}) {
  const config = ROLE_CONFIG[role];
  if (advisoryReviewInput === null) {
    throw Object.assign(new Error("advisory_review_input_required"), {
      code: "advisory_review_input_required"
    });
  }
  assertNoConfiguredCodexRoleCommitCredential({ role, env });
  const hasLauncherBoundWorkspace = typeof workspaceDir === "string" && workspaceDir.length > 0;
  const repo = hasLauncherBoundWorkspace
    ? workspaceDir
    : await findRepoRoot(cwd);
  if (hasLauncherBoundWorkspace && !(await isDirectory(path.join(repo, "wiki")))) {
    throw new Error(`expected repo with wiki/ at: ${repo}`);
  }
  const profile = typeof resolvedProfile?.backend_profile_key === "string"
    && resolvedProfile.backend_profile_key.length > 0
    ? resolvedProfile.backend_profile_key
    : config.defaultProfile;
  const model = typeof resolvedProfile?.model === "string" && resolvedProfile.model.length > 0
    ? resolvedProfile.model
    : null;
  const renderedRolePrompt = renderFamilyNeutralAdvisoryReviewInput(advisoryReviewInput);
  const prompt = promptArgs.length > 0
    ? `${renderedRolePrompt}\n\nAdditional instructions:\n\n${promptArgs.join(" ")}`
    : renderedRolePrompt;
  const roleEnv = {
    ...env,
    AGENT_ROLE: config.envRole,
    AGENT_SUBJECT: subject
  };
  if (subject.startsWith("WK-")) roleEnv.AGENT_WK = subject.split("#", 1)[0];
  else if (subject.startsWith("IN-")) roleEnv.AGENT_IN = subject;

  const headlessPlan = await buildHeadlessPlan({
    role,
    subject,
    repo,
    env: roleEnv,
    logPrefix: config.logPrefix,
    verbose: env[config.verboseEnv] === "1",
    argsPrefix: [
      "--disable", "shell_snapshot",
      "-C", repo,
      ...buildCodexSandboxArgsForRole(role),
      ...buildCodexApprovalArgsForRole(role),
      "-p", profile,
      "exec",
      "--ignore-user-config",
      "--ignore-rules"
    ],
    model,
    prompt,
    workspaceAlias,
    workspaceDir,
    dispatchWorktreeRoot,
    additionalReadOnlyRoots: [],

    terminalStructuredRoleResultMode
  });

  if (headlessPlan && typeof headlessPlan === "object") {
    headlessPlan.advisory_review_input = advisoryReviewInput;
  }
  return headlessPlan;
}
