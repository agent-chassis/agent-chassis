import path from "node:path";
import { bootstrapRepo } from "@agent-chassis/wiki-core";
import {
  parseArgs,
  parseListOption,
  optionalOption
} from "../lib/cli.mjs";

const HELP_TEXT = `Usage: wiki bootstrap [--repo <org/repo>] [--dir <path>] [--profile <standard|research>] [--extensions a,b,c]

Static instruction seeding only. Seeds wiki core surfaces and an in-progress
IN-0001 placeholder for the target repository's first real work. The target repo owns
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
  console.log(`IN-0001 first-work placeholder: ${adoptionState} ${ai.path}`);
  console.log(
    `  Required checks: ${ai.requiredChecks.length} | Owned work items: ${ai.ownedWork.length}`
  );
  if (ai.created && ai.ownedWork.length > 0) {
    console.log(`  Owned work: ${ai.ownedWork.join(", ")}`);
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

  console.log("");
  console.log("Next steps for a new repository:");
  console.log("  1. Inspect the bootstrap-created files:");
  console.log("       git status --short");
  console.log(
    "  2. Run AgentChassis setup for launcher configuration and the exact root-guidance commands:"
  );
  console.log("       npx agent-chassis setup");
  console.log(
    "  3. Follow setup's printed commands to create AGENTS.md and CLAUDE.md, stage the new-repository surfaces, build the code index, and start IN-0001."
  );
  console.log("");
  console.log(
    "Bootstrap writes the gitignored local"
  );
  console.log(
    "wiki/.wiki-mcp.json declaration (regenerated each run, not committed) and"
  );
  console.log(
    "creates no root AGENTS.md or CLAUDE.md. Fresh bootstrap creates only the"
  );
  console.log(
    "in-progress IN-0001 first-work placeholder and no work record. Existing-repository"
  );
  console.log(
    "adoption is deferred and is not part of this path."
  );
  console.log(
    "Bootstrap also does not configure global MCP client settings."
  );
}
