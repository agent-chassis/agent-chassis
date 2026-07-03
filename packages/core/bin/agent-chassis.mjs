#!/usr/bin/env node

const [command, ...commandArgs] = process.argv.slice(2);

if (command === "setup") {
  const { runSetup } = await import("../scripts/setup.mjs");
  await runSetup({ argv: commandArgs });
} else {
  process.stderr.write("Usage: agent-chassis setup [--agent claude|codex] [--dry-run]\n");
  process.exitCode = 1;
}
