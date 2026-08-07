import { runCleanup } from "./commands/cleanup.mjs";
import { runForgeMerge } from "./commands/forge-merge.mjs";
import {
  runCodexOrchestratorList,
  runCodexRole
} from "./commands/codex-role.mjs";
import { runInitConfig } from "./commands/init-config.mjs";
import { runInitiative } from "./commands/initiative.mjs";
import { runInstallDriftCheck } from "./commands/install-drift-check.mjs";
import { runLaunch } from "./commands/launch.mjs";
import { runOrchestrator } from "./commands/orchestrator.mjs";
import { runProvenance } from "./commands/provenance.mjs";
import { runRedteam } from "./commands/redteam.mjs";
import { runResume } from "./commands/resume.mjs";
import { runReview } from "./commands/review.mjs";
import { runRoleGuard } from "./commands/role-guard.mjs";
import { runRoleGuardClaudeHook } from "./commands/role-guard-claude-hook.mjs";
import { runWorker } from "./commands/worker.mjs";
import { WIKI_MCP_WORKSPACE_DIR_ENV_VAR } from "./lib/codex-role-mcp-env.mjs";

const HELP_TEXT = `agent-launch <command> [options]

Canonical role commands (operator surface):
  worker <unit-address> [--profile <profile>] [--app <app>] [--model <model>] [--spark]
                                             Dispatch an implementation worker
                                             (--spark is shorthand for
                                             --profile worker_spark)
  review <unit-address> [--profile <profile>] [--app <app>] [--model <model>]
                                             Dispatch a findings-only review worker
  redteam <subject> [--profile <profile>] [--app <app>] [--model <model>]
                                             Dispatch a findings-only redteam worker
                                             (subject: WK-####[#slice-id] or IN-####;
                                             IN-#### subjects are supported only with
                                             --app codex)
  orchestrator <IN-####> [--model <model>] [--effort <effort>] [focus...]
                                             Start an initiative orchestrator
                                             (model may come from ORCHESTRATOR_MODEL)
  orchestrator list [--json]                 List Codex orchestrator runtime history
  resume <IN-####> [--model <model>] [--effort <effort>]
                                             Resume an initiative orchestrator
  orchestrators [--json]                     Compatibility alias for orchestrator list

Canonical option grammar: \`role\` is authority/work mode only; \`--profile\`
selects a canonical launcher profile (default: same name as the role);
\`--app codex|claude\` overrides the profile's default app binding;
\`--app agy\` is roadmap/WIP and limited to planning or experimental validation;
\`--model <model>\` overrides the selected binding's default model.
\`--family\` is a deprecated alias for \`--app\`.

Maintenance and supporting commands:
  forge-merge WK-####                         Merge the exact reviewed pull request
  init-config [--force]                      Write a default local launcher registry
  initiative <status|start|redteam> <IN-ID>  Plan initiative workflows; dispatch is internal/deferred
  install-drift-check [--target-dir <path>] [--json]
                                             Read-only drift report comparing the
                                             package bin map against an operator
                                             PATH directory (exits non-zero on drift)
  review <instruction_path> --agent <name>   DEACTIVATED: reviewed blackboard review fails closed
      --reviewed-and-accept-risks            Flag retained for compatibility; does not re-enable review
      --allow-legacy-implementation-mode-handoff-review
                                             Flag retained for compatibility; does not re-enable review
      --allow-missing-graph-impact-checkpoint
                                             Flag retained for compatibility; does not re-enable review
  launch <review_id>                         DEACTIVATED: reviewed blackboard launch fails closed (no child agent spawn)
  provenance <run_dir|provenance_path>       Inspect a direct-wrapper or reviewed-launcher run
      --json                                 Emit machine-readable output
      --tail-lines <N>                       Include bounded runtime-evidence tail snapshots
  role-guard <check-write|check-diff|check-command|explain>
                                             Evaluate role guard CLI/hook actions
  role-guard claude-hook                     Process a Claude PreToolUse JSON payload from stdin
  cleanup                                    Remove stale local launcher artifacts
  help                                       Show this help text
`;

const TEMPORAL_WRAPPER_UNSUPPORTED_MESSAGE =
  "temporal-wrapper-dry-run is an internal/deferred Temporal surface and is not a supported agent-launch operator command in this release.";

export async function run(argv, { cwd = process.cwd(), env = process.env, io = {} } = {}) {
  const [command, ...rest] = argv;

  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP_TEXT);
      return;
    case "worker":
      await runWorker(rest);
      return;
    case "forge-merge":

      await runForgeMerge(rest, io, null, {
        env: {
          ...env,
          [WIKI_MCP_WORKSPACE_DIR_ENV_VAR]: cwd
        }
      });
      return;
    case "review":
      await runReview(rest);
      return;
    case "redteam":
      await runRedteam(rest);
      return;
    case "orchestrator":
      await runOrchestrator(rest);
      return;
    case "resume":
      await runResume(rest);
      return;
    case "orchestrators":
      await runCodexOrchestratorList(rest);
      return;
    case "init-config":
      await runInitConfig(rest);
      return;
    case "initiative":
      await runInitiative(rest);
      return;
    case "install-drift-check":
      await runInstallDriftCheck(rest);
      return;
    case "launch":
      await runLaunch(rest);
      return;
    case "provenance":
      await runProvenance(rest);
      return;
    case "role-guard":
      if (rest[0] === "claude-hook") {
        await runRoleGuardClaudeHook(rest.slice(1));
        return;
      }
      await runRoleGuard(rest);
      return;
    case "cleanup":
      await runCleanup(rest);
      return;
    case "codex-role":
      await runCodexRole(rest);
      return;
    case "temporal-wrapper-dry-run":
      throw new Error(TEMPORAL_WRAPPER_UNSUPPORTED_MESSAGE);
    default:
      throw new Error(`Unknown command: ${command}\n\n${HELP_TEXT}`);
  }
}
