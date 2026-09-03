#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { deriveDeclaredBoundaryRecordConsistency } from
  "../lib/declared-boundary-record-consistency.mjs";

const values = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, argv) => {
  if (index % 2 === 0) pairs.push([value, argv[index + 1]]);
  return pairs;
}, []));
if (!values["--policy"] || !values["--observations"] || !values["--subjects"]) {
  process.stderr.write("Usage: controlled-contract-derive-declared-boundary-record-consistency --policy <json> --observations <json> --subjects <json>\n");
  process.exitCode = 1;
} else {
  process.stdout.write(deriveDeclaredBoundaryRecordConsistency({
    policyBytes: await readFile(values["--policy"]),
    observationBytes: await readFile(values["--observations"]),
    subjectsBytes: await readFile(values["--subjects"])
  }));
}
