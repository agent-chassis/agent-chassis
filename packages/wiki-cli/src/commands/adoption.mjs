

import path from "node:path";
import { runAdoptionVerify, ADOPTION_VERIFY_REQUIRED_CHECK_IDS } from "@agent-chassis/wiki-core";
import { parseArgs, parseListOption, optionalOption } from "../lib/cli.mjs";

const HELP_TEXT = `Usage: wiki adoption verify [--dir <path>] [--repo <org/repo>] [--json] [--checks <ids>]

Run the structured first-run adoption readiness check against a bootstrapped
consuming repo. Five required, READ-ONLY verification checks run in a fixed
order; every check is reported even if an earlier one fails. The repo is
confirmed agent-operable only when all five required checks pass.

This command never persists graph-impact evidence, refreshes admission
metrics, or writes any repo file: it is read-only and persisted_evidence is
always false.

Subcommands:
  verify                Run the adoption readiness checks (default output is text).

Options:
  --dir <path>          Target repo directory (default: current directory).
  --repo <org/repo>     Optional repository identifier recorded in the output.
  --checks <ids>        Comma-separated check ids to run; others are reported as
                        skipped. Required ids: ${ADOPTION_VERIFY_REQUIRED_CHECK_IDS.join(", ")}.
  --json                Emit the adoption-verify.v1 envelope as JSON.
  --help                Show this help text.

Exit code: 0 only when the verdict is "ready" (all required checks pass);
non-zero otherwise, in both text and --json modes.`;

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function renderText(result) {
  for (const check of result.checks) {
    const tag = check.status.toUpperCase();
    const classLabel = check.required ? "required" : check.kind;
    console.log(`[${tag}] ${check.check} (${classLabel}): ${check.detail}`);
    if (check.required && check.status !== "pass" && check.remediation) {
      console.log(`        remediation: ${check.remediation}`);
    }
  }

  console.log("");

  const summary = result.summary;
  const requiredTotal = result.checks.filter((check) => check.required).length;
  if (result.verdict === "ready") {
    console.log(
      `Adoption verify: READY. All ${requiredTotal} required adoption checks passed ` +
        `(${summary.pass}/${summary.total} checks passing).`
    );
  } else {
    const requiredNotPassing = result.checks.filter(
      (check) => check.required && check.status !== "pass"
    ).length;
    console.log(
      `Adoption verify: BLOCKED (${requiredNotPassing}/${requiredTotal} required checks not passing). ` +
        "Repo is NOT confirmed agent-operable."
    );
  }
}

async function runVerify(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(HELP_TEXT);
    return;
  }

  const targetDir = path.resolve(String(options.dir || "."));
  const repo = optionalOption(options, "repo");
  const checks = "checks" in options ? parseListOption(options, "checks") : null;

  const result = await runAdoptionVerify({ dir: targetDir, repo, checks });

  if (options.json) {
    printJson(result);
  } else {
    renderText(result);
  }

  if (result.verdict !== "ready") {
    process.exitCode = 1;
  }
}

export async function runAdoption(argv) {
  const [subcommand, ...rest] = argv;

  if (subcommand === undefined) {
    console.log(HELP_TEXT);
    return;
  }

  switch (subcommand) {
    case "verify":
      await runVerify(rest);
      return;
    case "help":
    case "--help":
    case "-h":
      console.log(HELP_TEXT);
      return;
    default:
      if (subcommand.startsWith("--")) {

        await runVerify(argv);
        return;
      }
      throw new Error(`Unknown adoption subcommand: ${subcommand}\n\n${HELP_TEXT}`);
  }
}
