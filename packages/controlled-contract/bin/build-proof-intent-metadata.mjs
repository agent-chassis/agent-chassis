

import { readFile, writeFile } from "node:fs/promises";

import { buildPackagedCompiledValidators } from "../lib/compiled-validator-cache.mjs";
import { buildProofIntentMetadata, PROOF_INTENT_DISCOVERY_RESULT_VALIDATOR,
  PROOF_INTENT_METADATA_PATH, proofIntentMetadataJson } from "../lib/proof-intent-metadata.mjs";

const [mode, ...extra] = process.argv.slice(2);
if (!["--check", "--write"].includes(mode) || extra.length) {
  throw new Error("usage: build-proof-intent-metadata.mjs --check|--write");
}
const write = mode === "--write";
const target = new URL(`../${PROOF_INTENT_METADATA_PATH}`, import.meta.url);
const expected = proofIntentMetadataJson(await buildProofIntentMetadata());
const current = await readFile(target, "utf8").catch((error) => {
  if (error?.code === "ENOENT") return null;
  throw error;
});
if (write && current !== expected) await writeFile(target, expected);
const { groupId, declaration, directory } = PROOF_INTENT_DISCOVERY_RESULT_VALIDATOR;
const validator = await buildPackagedCompiledValidators(groupId, declaration, directory, { write });
const changed = { metadata: current !== expected, validator: !validator.current };
const passed = write || (!changed.metadata && !changed.validator);
process.stdout.write(`${JSON.stringify({ mode, passed, changed })}\n`);
if (!passed) process.exitCode = 1;
