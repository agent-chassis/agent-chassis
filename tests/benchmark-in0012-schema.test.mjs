import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readJson(path) {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
}

const ZERO_SHA256 = "0".repeat(64);
const PLACEHOLDER_SHA256 = "f".repeat(64);

const RETIRED_SCHEMA_SKIP =
  "IN-0012 benchmark provenance/approval schemas retired (removed in 079e982, WK-0804 delete-historic-docs); restore the schema files to re-enable";

test("IN-0012 signer policy rejects zero and placeholder verifier digests", { skip: RETIRED_SCHEMA_SKIP }, async () => {
  const schema = await readJson("docs/benchmark-runs/IN-0012/provenance/signer-policy.schema.json");
  const binaryDigest = schema.properties.verifier.properties.binary_sha256;
  const publicKeyDigest = schema.properties.verifier.properties.invocation.properties.public_key_sha256;

  for (const digestSchema of [binaryDigest, publicKeyDigest]) {
    assert.deepEqual(digestSchema.not.enum, [ZERO_SHA256, PLACEHOLDER_SHA256]);
  }
});

test("IN-0012 approval schema binds credential_mode to auth_evidence.mode", { skip: RETIRED_SCHEMA_SKIP }, async () => {
  const schema = await readJson("docs/benchmark-runs/IN-0012/approvals/schema.json");

  for (const mode of ["env", "mounted-cli-auth", "vertex-ai"]) {
    assert.ok(
      schema.allOf.some((rule) =>
        rule?.if?.properties?.credential_mode?.const === mode
        && rule?.then?.properties?.auth_evidence?.properties?.mode?.const === mode
        && rule?.then?.properties?.auth_evidence?.required?.includes("mode")
      ),
      `missing credential_mode/auth_evidence binding for ${mode}`
    );
  }
});
