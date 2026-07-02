import path from "node:path";
import { createWikiRecord } from "@agent-chassis/wiki-core";
import { parseArgs } from "../lib/cli.mjs";

export async function runCreate(argv) {
  const { positionals, options } = parseArgs(argv);
  if (options.help) {
    console.log(`Usage: wiki create <type> <title> [--dir <path>] [--id <allocated-id>]
Examples:
  wiki create issue "Honor reserved IDs during record creation" --dir /path/to/repo
    writes wiki/work-records/<ID>.json
  wiki create decision "Standardize cross-repo links" --dir /path/to/repo
  wiki create area "Example Project" --dir /path/to/repo`);
    return;
  }
  const targetDir = path.resolve(String(options.dir || "."));
  const [type, ...titleParts] = positionals;
  const title = titleParts.join(" ").trim();
  const requestedId =
    options.id && options.id !== true ? String(options.id).trim() : null;

  if (!type || !title) {
    throw new Error(
      'create requires a type and title, for example: wiki create issue "Honor reserved IDs during record creation"'
    );
  }

  const result = await createWikiRecord({
    dir: targetDir,
    type,
    title,
    id: requestedId
  });

  console.log(`Created ${result.id}`);
  if (type === "issue" && result.jsonRelativeFile) {
    console.log(`Work record: ${result.jsonRelativeFile}`);
    return;
  }

  console.log(`Path: ${result.relativeFile}`);
}
