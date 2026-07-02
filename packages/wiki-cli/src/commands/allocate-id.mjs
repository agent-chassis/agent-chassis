import path from "node:path";
import { allocateId } from "@agent-chassis/wiki-core";
import { parseArgs } from "../lib/cli.mjs";

export async function runAllocateId(argv) {
  const { positionals, options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki allocate-id <type> [--repo <org/repo>] [--dir <path>] (reserves the next ID)"
    );
    return;
  }
  const targetDir = path.resolve(String(options.dir || "."));
  const type = positionals[0];
  if (!type) {
    throw new Error("allocate-id requires a type, for example: wiki allocate-id issue");
  }

  const result = await allocateId({
    dir: targetDir,
    type,
    repo: options.repo ? String(options.repo) : null
  });
  console.log(result.qualifiedId);
}
