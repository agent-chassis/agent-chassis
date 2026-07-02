import path from "node:path";
import { bootstrapRepo } from "@agent-chassis/wiki-core";
import {
  parseArgs,
  parseListOption,
  optionalOption
} from "../lib/cli.mjs";

const HELP_TEXT = `Usage: wiki bootstrap [--repo <org/repo>] [--dir <path>] [--profile <standard|research>] [--extensions a,b,c]

Static instruction seeding only. Seeds wiki core surfaces and IN-0001
adoption work into the target repo directory. The target repo owns
running its own MCP setup, wiki search/read, work-record validation,
graph-impact, preflight, and dispatch verification from its own context.
No MCP, dispatch, graph-impact, preflight, or readiness work runs against
the target repo as part of this command.

Options:
  --repo <org/repo>     Optional override. Repository identifier (e.g. org/repo).
  --dir <path>          Target repo directory (default: current directory).
  --profile <name>      Profile to apply: standard or research (default: standard).
  --extensions a,b,c    Comma-separated extension namespaces (default: none).
  --help                Show this help text.`;

export async function runBootstrap(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(HELP_TEXT);
    return;
  }
  const targetDir = path.resolve(String(options.dir || "."));
  const repo = optionalOption(options, "repo");
  const profile = optionalOption(options, "profile") || "standard";
  const extensionNamespaces = parseListOption(options, "extensions");

  const result = await bootstrapRepo({
    dir: targetDir,
    repo,
    profile,
    extensionNamespaces
  });

  console.log(`Bootstrapped wiki surfaces in ${targetDir}`);
  console.log(`Contract version: ${result.contractVersion}`);
  console.log(`Profile: ${result.profile}`);
  console.log(
    `Extensions: ${result.extensionNamespaces.length > 0 ? result.extensionNamespaces.join(", ") : "none"}`
  );
  console.log(
    `Catalog: ${result.catalog.created ? "created" : "kept"} ${result.catalog.catalogPath}`
  );
  console.log(`Templates synced: ${result.templates.length}`);
  console.log(`Metadata written: ${result.metadataPath}`);

  const ai = result.adoptionInitiative;
  const adoptionState = ai.created ? "created" : "kept";
  console.log(`IN-0001 adoption initiative: ${adoptionState} ${ai.path}`);
  console.log(
    `  Required checks: ${ai.requiredChecks.length} | Owned work items: ${ai.ownedWork.length}`
  );
  if (ai.created) {
    console.log(`  Owned work: ${ai.ownedWork.join(", ")}`);
  }

  const ad = result.adoptionDoc;
  if (ad) {
    const adState = ad.state === "created" ? "created" : "kept (preserved your edits)";
    console.log(`Adoption guide: ${adState} ${ad.path}`);
  }

  const ci = result.cacheAndIgnores;
  if (ci) {
    const searchState = ci.searchIndex.rebuilt ? "built" : "kept";
    console.log(
      `Search index: ${searchState} ${ci.searchIndex.indexPath} (${ci.searchIndex.chunkCount} chunks)`
    );
    if (ci.gitignore.updated) {
      console.log(
        `Gitignore: updated ${ci.gitignore.path} (added: ${ci.gitignore.added.join(", ")})`
      );
    } else {
      console.log(`Gitignore: no changes needed in ${ci.gitignore.path}`);
    }
  }

  const wm = result.wikiMcpDeclaration;
  if (wm) {
    console.log(
      `Wiki MCP declaration: ${wm.state} ${wm.path} (alias: ${wm.alias}) — generated, gitignored local artifact (not committed)`
    );
    if (wm.malformed) {
      console.log(
        `  Note: a malformed ${wm.path} was found${wm.malformedReason ? ` (${wm.malformedReason})` : ""} and rewritten fresh.`
      );
    }
  }

  const awr = result.adoptionWorkRecords;
  const trackerId = awr
    ? (awr.created[0]?.recordId || awr.kept[0]?.recordId || "WK-0001")
    : "WK-0001";
  if (awr) {
    const seeded = [
      ...awr.created.map((r) => `${r.recordId} (created)`),
      ...awr.kept.map((r) => `${r.recordId} (kept)`)
    ];
    console.log(
      `Adoption work records: ${seeded.length > 0 ? seeded.join(", ") : "none"}`
    );
  }

  console.log("");
  console.log("Next steps:");
  console.log("  1. Inspect the bootstrap-created files:");
  console.log("       git status --short");
  console.log(
    "  2. Commit the bootstrap-created wiki surfaces, docs/adoption.md, and .gitignore:"
  );
  console.log("       git add wiki docs/adoption.md .gitignore");
  console.log('       git commit -m "bootstrap wiki adoption surfaces"');
  console.log(
    "  3. Optional, only after the worktree is clean: build the repo-code-index"
  );
  console.log("     sidecar:");
  console.log('       npx wiki code-index build --dir "$PWD"');
  console.log("       # or, when the repo defines the wiki script:");
  console.log('       npm run wiki -- code-index build --dir "$PWD"');
  console.log("       # zero-local-script fallback:");
  console.log('       npx -p @agent-chassis/core wiki code-index build --dir "$PWD"');
  console.log(
    `  4. Launch the seeded IN-0001 adoption orchestrator (it drives the ${trackerId}`
  );
  console.log(
    "     adoption slices; do not run them by hand). Orchestrator launch is a"
  );
  console.log(
    "     human/operator action; choose an explicit model:"
  );
  console.log(
    "       npx agent-launch orchestrator IN-0001 --model gpt-5.5"
  );
  console.log(
    "       npx agent-launch orchestrator IN-0001 --model opus"
  );
  console.log("       # zero-local-script fallback:");
  console.log(
    "       npx -p @agent-chassis/core agent-launch orchestrator IN-0001 --model gpt-5.5"
  );
  console.log(
    "       npx -p @agent-chassis/core agent-launch orchestrator IN-0001 --model opus"
  );
  console.log(
    `  5. After the orchestrator completes the ${trackerId} adoption work, run the`
  );
  console.log(
    "     structured first-run adoption readiness check. Bootstrap does not run it"
  );
  console.log(
    "     and makes no readiness claim; the check reports per-check status and is"
  );
  console.log("     read-only (it persists no evidence):");
  console.log('       npx wiki adoption verify --dir "$PWD" --json');
  console.log("       # optional shorthand, only when the repo defines a wiki npm script:");
  console.log('       npm run wiki -- adoption verify --dir "$PWD" --json');
  console.log("       # zero-local-script fallback:");
  console.log('       npx -p @agent-chassis/core wiki adoption verify --dir "$PWD" --json');
  console.log("");
  console.log(
    `Bootstrap seeds adoption surfaces only. ${trackerId} is the seeded adoption`
  );
  console.log(
    "tracker the orchestrator drives. Bootstrap writes the gitignored local"
  );
  console.log(
    "wiki/.wiki-mcp.json declaration (regenerated each run, not committed) and"
  );
  console.log(
    "seeds the committed docs/adoption.md operator guide from a template"
  );
  console.log(
    "(preserved if you have customized it), but does not create AGENTS.md and"
  );
  console.log(
    "does not configure global MCP client settings. The IN-0001 orchestrator owns"
  );
  console.log("completing the adoption work above.");
}
