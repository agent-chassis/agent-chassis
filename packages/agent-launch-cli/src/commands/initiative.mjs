import { planInitiativeCommand, InitiativeCommandError } from "@agent-chassis/agent-launch-core";
import { parseArgs } from "../lib/cli.mjs";

const HELP_TEXT = `agent-launch initiative <status|start|redteam> <IN-ID> [options]

Options:
  --json                  Emit machine-readable JSON
  --dispatch              Request internal/deferred dispatch; default is planning only
  --execution-mode <mode> smoke or live; used only with --dispatch; default smoke
  --attempt <A001>        Attempt id for generated dispatch keys
`;

export async function runInitiative(argv) {
  const { positionals, options } = parseArgs(argv);
  const [action, initiativeId] = positionals;
  if (!action || action === "help" || options.help || options.h) {
    console.log(HELP_TEXT);
    return;
  }
  if (!initiativeId) {
    throw new Error(`Missing initiative id\n\n${HELP_TEXT}`);
  }

  try {
    const result = await planInitiativeCommand({
      action,
      initiativeId,
      dispatch: options.dispatch === true,
      json: options.json === true,
      executionMode: typeof options["execution-mode"] === "string" ? options["execution-mode"] : "smoke",
      attemptId: typeof options.attempt === "string" ? options.attempt : "A001"
    });
    if (options.json === true) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    printHuman(result);
  } catch (error) {
    if (options.json === true && error instanceof InitiativeCommandError) {
      console.log(JSON.stringify({
        ok: false,
        code: error.code,
        message: error.message,
        errors: error.errors
      }, null, 2));
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

function printHuman(result) {
  console.log(`${result.initiative.id}: ${result.initiative.title} (${result.initiative.status})`);
  console.log(`Dispatch: ${result.dispatch_requested ? result.dispatch_mode : "plan only"}`);
  console.log(`Live execution: ${result.live_execution.available ? "available" : `blocked by ${result.live_execution.blocked_by}`}`);
  if (result.implementation_candidates.length > 0) {
    console.log("Implementation candidates:");
    for (const candidate of result.implementation_candidates) {
      console.log(`  - ${candidate.id}: ${candidate.title} (${candidate.status})`);
    }
  } else {
    console.log("Implementation candidates: none");
  }
  if (result.active_redteam_candidates.length === 0) {
    console.log(`Redteam candidates: none (${result.active_redteam_reason})`);
  }
  if (result.redteam_plan?.not_implemented) {
    console.log(`Redteam dispatch: not implemented (${result.redteam_plan.reason})`);
  }
  if (result.dispatch_blockers?.length > 0) {
    console.log("Dispatch blockers:");
    for (const blocker of result.dispatch_blockers) {
      console.log(`  - ${blocker.code}: ${blocker.message}`);
    }
  }
  if (result.workflows.length > 0) {
    console.log("Deferred dispatch records:");
    for (const workflow of result.workflows) {
      console.log(`  - ${workflow.wk_id}: ${workflow.workflow_id} (${workflow.dispatch_mode})`);
    }
  }
}
