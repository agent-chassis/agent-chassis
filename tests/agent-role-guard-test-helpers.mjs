import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  ROLE_GUARD_ADAPTER_AUTHORITY,
  ROLE_GUARD_LAUNCHER_AUTHORITY
} from "../packages/agent-launch-core/src/index.mjs";
import { run as runAgentLaunchCommand } from "../packages/agent-launch-cli/src/run.mjs";

function baseConfig(overrides = {}) {
  return {
    schema_version: 1,
    roles: {
      aliases: {
        redteam: "reviewer"
      },
      derive_from_session_name: {
        trusted_source_required: true,
        rules: [
          { role: "orchestrator", patterns: ["\\bIN-", "\\bOrchestrator\\b"] },
          { role: "worker", patterns: ["\\bWK-", "\\bImplement\\b"] },
          { role: "reviewer", patterns: ["\\bReview\\b", "\\bRedteam\\b"] },
          { role: "operator", patterns: ["\\bRuntime\\b", "\\bDeploy\\b", "\\bRestart\\b"] }
        ]
      }
    },
    worker: {
      wk_env: "AGENT_WK",
      wk_id_pattern: "^WK-[0-9]+$",
      issue_path_template: "wiki/issues/{wk}.md",
      write_scope_frontmatter_key: "write_scope",
      allow_wk_page_write: true,
      runtime_command_frontmatter_key: "runtime_command_policy"
    },
    operator: {
      write_scope_env: "AGENT_OPERATOR_WRITE_SCOPE",
      write_scope_env_format: "json_array"
    },
    path_policy: {
      deny: [".agent-runs/**", "wiki/generated/**"],
      reject_repo_wide_patterns: true
    },
    command_policy: {
      categories: ["denied", "read_only", "runtime", "repo_mutating_bounded", "operator_reviewed_broad"],
      patterns: [
        { argv: ["git", "status"], category: "read_only" },
        { argv: ["docker", "ps"], category: "runtime" },
        {
          argv: ["npm", "run", "wiki", "--", "generate"],
          category: "repo_mutating_bounded",
          target_requirement: "trusted_targets"
        },
        { argv: ["rm", "*"], category: "denied" }
      ],
      default_category: "denied",
      environment_pins: {
        NODE_OPTIONS: "--experimental-vm-modules"
      }
    },
    policies: {
      orchestrator: {
        write: { allow: ["wiki/issues/**", "wiki/handoffs/**", "wiki/initiatives/**", "wiki/decisions/**", "wiki/sources/**"] },
        commands: { default: "deny", runtime: "deny", read_only: "allow" }
      },
      worker: {
        write: { allow_from_wk_write_scope: true },
        commands: { default: "deny", runtime: "allow_from_wk_frontmatter", read_only: "allow" }
      },
      reviewer: {
        write: { allow: [] },
        commands: { default: "deny", runtime: "deny", read_only: "deny" }
      },
      unknown: {
        write: { allow: [] },
        commands: { default: "deny", runtime: "deny", read_only: "deny" }
      },
      operator: {
        write: { allow_from_operator_scope: true },
        commands: {
          default: "deny",
          read_only: "allow",
          runtime: "allow",
          repo_mutating_bounded: "allow_with_operator_write_scope",
          operator_reviewed_broad: "deny"
        }
      }
    },
    ...overrides
  };
}

function launcherProvenance(role = "worker", wk = "WK-0098") {
  return {
    caller: "agent_launch",
    [ROLE_GUARD_LAUNCHER_AUTHORITY]: true,
    role: { value: role, source: "launcher_metadata" },
    wk: { value: wk, source: "launcher_metadata" },
    config: { path: ".agent-role-guard.json", source: "repo_config" },
    session_name: { value: null, source: "absent", trusted: false }
  };
}

function operatorProvenance(scope = ["wiki/**"]) {
  return {
    ...launcherProvenance("operator", "WK-0098"),
    operator_write_scope: { value: scope, source: "operator_config" }
  };
}

function executionProof(argv, env = {}) {
  return {
    [ROLE_GUARD_ADAPTER_AUTHORITY]: true,
    executable: {
      resolved_realpath: "/usr/bin/git",
      digest: "sha256:abc123",
      resolution_inputs_digest: "sha256:path123"
    },
    spawn: {
      shell_mode: false,
      cwd: "/repo",
      raw_argv: argv,
      resolved_argv0: "/usr/bin/git"
    },
    environment: {
      mode: "closed",
      digest: "sha256:env123",
      variables: env
    }
  };
}

function trustedTargetProof(overrides = {}) {
  return {
    [ROLE_GUARD_ADAPTER_AUTHORITY]: true,
    adapter_id: "wiki-cli",
    capability_id: "bounded-generate",
    containment_mode: "write_ledger",
    ledger_digest: "sha256:ledger",
    observed_write_set: ["wiki/catalog.md"],
    ...overrides
  };
}

async function withTempRepo(fn) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "portfolio-role-guard-"));
  try {
    await mkdir(path.join(repoRoot, "wiki", "issues"), { recursive: true });
    await mkdir(path.join(repoRoot, "packages", "feature", "src"), { recursive: true });
    await writeFile(
      path.join(repoRoot, "wiki", "issues", "WK-0098.md"),
      [
        "---",
        "id: WK-0098",
        "write_scope:",
        "  - packages/feature/**",
        "runtime_command_policy: allow-docker",
        "---",
        "# Work"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(repoRoot, ".agent-role-guard.json"),
      `${JSON.stringify(baseConfig(), null, 2)}\n`,
      "utf8"
    );
    await fn(repoRoot);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

async function writeJson(repoRoot, name, value) {
  const filePath = path.join(repoRoot, name);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

async function runAgentLaunch(args, options = {}) {
  const originalLog = console.log;
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  let stdout = "";
  let stderr = "";
  process.exitCode = undefined;
  console.log = (...parts) => {
    stdout += `${parts.join(" ")}\n`;
  };
  console.error = (...parts) => {
    stderr += `${parts.join(" ")}\n`;
  };
  try {
    await runAgentLaunchCommand(args);
  } catch (error) {
    stderr += `${error instanceof Error ? error.message : String(error)}\n`;
    process.exitCode = 1;
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  const code = process.exitCode ?? 0;
  process.exitCode = originalExitCode;
  return { code, stdout, stderr };
}

function parseStdoutJson(result) {
  assert.notEqual(result.stdout, "", `expected JSON stdout, result was: ${JSON.stringify(result)}`);
  return JSON.parse(result.stdout);
}

export function installFixtureEnvGuard() {
  const originalTestFixtureEnv = process.env.AGENT_ROLE_GUARD_ALLOW_TEST_FIXTURE;
  test.before(() => {
    process.env.AGENT_ROLE_GUARD_ALLOW_TEST_FIXTURE = "1";
  });
  test.after(() => {
    if (originalTestFixtureEnv === undefined) {
      delete process.env.AGENT_ROLE_GUARD_ALLOW_TEST_FIXTURE;
    } else {
      process.env.AGENT_ROLE_GUARD_ALLOW_TEST_FIXTURE = originalTestFixtureEnv;
    }
  });
}

export {
  baseConfig,
  launcherProvenance,
  operatorProvenance,
  executionProof,
  trustedTargetProof,
  withTempRepo,
  writeJson,
  runAgentLaunch,
  parseStdoutJson
};
