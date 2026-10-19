#!/usr/bin/env node

import { run } from "./run.mjs";

await run(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

await flushStream(process.stdout);
await flushStream(process.stderr);

function flushStream(stream) {
  return new Promise((resolve) => {
    stream.write("", resolve);
  });
}
