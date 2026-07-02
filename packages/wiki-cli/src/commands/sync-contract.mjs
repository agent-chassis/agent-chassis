import path from "node:path";
import {
  checkContractSync,
  syncContract
} from "@agent-chassis/wiki-core";
import { optionalListOption, optionalOption, parseArgs } from "../lib/cli.mjs";

export async function runSyncContract(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki sync-contract [--dir <path>] [--check] [--repo <org/repo>] [--profile <standard|research>] [--extensions a,b,c]"
    );
    return;
  }
  const targetDir = path.resolve(String(options.dir || "."));
  const repo = optionalOption(options, "repo");
  const profile = optionalOption(options, "profile");
  const extensionNamespaces = optionalListOption(options, "extensions");

  if (options.check) {
    const result = await checkContractSync({
      dir: targetDir,
      repo,
      profile,
      extensionNamespaces
    });
    if (!result.ok) {
      for (const problem of result.problems) {
        console.error(problem);
      }
      throw new Error(
        `sync-contract --check failed with ${result.problems.length} problem(s)`
      );
    }

    console.log(`Contract check passed for ${targetDir}`);
    return;
  }

  const result = await syncContract({
    dir: targetDir,
    repo,
    profile,
    extensionNamespaces
  });

  console.log(`Synced contract ${result.contractVersion} into ${targetDir}`);
  console.log(`Profile: ${result.profile}`);
  console.log(
    `Extensions: ${result.extensionNamespaces.length > 0 ? result.extensionNamespaces.join(", ") : "none"}`
  );
  console.log(`Core files created: ${result.createdCoreFiles.length}`);
  console.log(`Core files preserved: ${result.preservedCoreFiles.length}`);
  console.log(`Templates synced: ${result.templates.length}`);
  console.log(`Metadata written: ${result.metadataPath}`);
}
