import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateVerificationProfileV1 } from
  "../lib/verification-profile-v1.mjs";

const exampleDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../legacy/examples/population-v034"
);
const manifest = JSON.parse(await readFile(path.join(exampleDirectory, "manifest.json")));
for (const [filename, expected] of Object.entries(manifest)) {
  const fixture = JSON.parse(await readFile(path.join(exampleDirectory, filename), "utf8"));
  const result = evaluateVerificationProfileV1(fixture);
  assert.equal(result.satisfaction, expected, `${filename}: ${JSON.stringify(result.diagnostics)}`);
  process.stdout.write(`${filename}\t${result.satisfaction}\n`);
}
