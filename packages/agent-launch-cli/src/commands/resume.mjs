import { dispatchOrchestrator } from "./orchestrator.mjs";

const HELP_TEXT = `agent-launch resume <IN-####> [options]

Resume a previously launched initiative-orchestrator session. The canonical
option grammar is
\`agent-launch resume <IN-####> [--model <model>] [--effort <effort>]\`.
The model may also be supplied by ORCHESTRATOR_MODEL. The launcher derives the
app/family from the model registry; \`--app\` remains a compatibility override.

Codex orchestrator profiles route through codex-role's buildOrchestratorPlan in
resume mode, which reuses the repo-disambiguated thread name, refreshes the
meta.env last_action/last_used fields, and re-applies the narrow orchestrator
permissions profile. The \`orchestrator_claude\` profile routes through the
launcher-owned Claude planner and host-server conduit. resume sends no instructions;
the resumed session carries its prior context.

Options:
  --profile <profile>    Canonical launcher profile (default: orchestrator;
                         orchestrator_xhigh for xhigh dispatch)
  --app codex|claude     Override the profile's default app binding
  --model <model>        Override the selected binding's default model
  --effort <effort>      Neutral effort flag; xhigh selects orchestrator_xhigh
  --dry-run-json         Emit the launch plan without spawning

Set CODEX_ORCH_THREAD_NAME=... to override the default repo-disambiguated
thread name.
`;

export async function runResume(argv, io = {}) {
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help" || argv[0] === "help") {
    writeLine(io.stdout, HELP_TEXT);
    if (argv.length === 0) {
      process.exitCode = 2;
    }
    return;
  }
  await dispatchOrchestrator({ argv, role: "orch-resume" }, io);
}

function writeLine(stream, value) {
  if (stream?.write) {
    stream.write(`${value}\n`);
  } else {
    process.stdout.write(`${value}\n`);
  }
}
