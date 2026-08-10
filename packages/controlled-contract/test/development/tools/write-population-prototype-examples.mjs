import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  p8Fixture,
  p12Fixture,
  p13Fixture
} from "../../support/population-v034-fixtures.mjs";

const outputDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../legacy/examples/population-v034"
);
await mkdir(outputDirectory, { recursive: true });

const fixtures = {
  "p8-n3-positive.json": p8Fixture(3),
  "p8-n3-missing-member-claim.json": p8Fixture(3, { omitLastClaim: true }),
  "p12-n25-positive.json": p12Fixture(25),
  "p12-n25-missing-identity.json": p12Fixture(25, { omitLastIdentity: true }),
  "p13-strict-subset-positive.json": p13Fixture({
    observedMembers: ["ref-a"],
    authorizedMembers: ["ref-a", "ref-b"]
  }),
  "p13-partial-overlap-negative.json": p13Fixture({
    observedMembers: ["ref-a", "ref-c"],
    authorizedMembers: ["ref-a", "ref-b"]
  }),
  "p13-empty-subset-positive.json": p13Fixture({
    observedMembers: [],
    authorizedMembers: []
  }),
  "p13-empty-not-subset-negative.json": p13Fixture({
    observedMembers: [],
    authorizedMembers: ["ref-a"],
    operator: "reference:not_subset_of"
  })
};
const manifest = {
  "p8-n3-positive.json": "satisfied",
  "p8-n3-missing-member-claim.json": "unsatisfied",
  "p12-n25-positive.json": "satisfied",
  "p12-n25-missing-identity.json": "unsatisfied",
  "p13-strict-subset-positive.json": "satisfied",
  "p13-partial-overlap-negative.json": "invalid",
  "p13-empty-subset-positive.json": "satisfied",
  "p13-empty-not-subset-negative.json": "invalid"
};

for (const [filename, fixture] of Object.entries(fixtures)) {
  const outputPath = path.join(outputDirectory, filename);
  await writeFile(outputPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  process.stdout.write(`${outputPath}\n`);
}
const manifestPath = path.join(outputDirectory, "manifest.json");
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`${manifestPath}\n`);
