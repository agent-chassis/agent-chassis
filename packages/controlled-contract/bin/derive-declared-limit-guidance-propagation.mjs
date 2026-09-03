#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { deriveDeclaredLimitGuidancePropagation } from
  "../lib/declared-limit-guidance-propagation.mjs";

const values = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, argv) => {
  if (index % 2 === 0) pairs.push([value, argv[index + 1]]);
  return pairs;
}, []));
if (!values["--policy"] || !values["--guidance"]) {
  process.stderr.write("Usage: controlled-contract-derive-declared-limit-guidance-propagation --policy <json> --guidance <file>\n");
  process.exitCode = 1;
} else {
  process.stdout.write(deriveDeclaredLimitGuidancePropagation({
    policyBytes: await readFile(values["--policy"]),
    guidanceBytes: await readFile(values["--guidance"])
  }));
}
