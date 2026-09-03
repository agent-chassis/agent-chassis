import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJsonBytes, sha256 } from "../../../lib/exact-binding-common.mjs";
import { profileDigest as stableProfileDigest } from "../../support/stable-v1-proof-pack-runtime.mjs";
import { EXCLUSIONS, GUARANTEES } from "../../proof-packs/bounded-policy-v1-constants.mjs";
import { buildBoundaryFixture, buildGuidanceFixture } from "../../proof-packs/bounded-policy-v1-fixture.mjs";
import {
  BOUNDARY_PROFILE_ID, GUIDANCE_PROFILE_ID, buildDeclaration, buildEvaluationInput, buildProfile
} from "../../proof-packs/bounded-policy-v1-profile.mjs";
import { runProofPackAdequacyControls } from "../../proof-packs/bounded-policy-v1-adequacy.mjs";
import {
  CONTROL_IDS, runExactBindingCertificationControls
} from "../../proof-packs/bounded-policy-v1-exact-corpus.mjs";

const packageRoot = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const repositoryRoot = path.resolve(packageRoot, "../..");
const relative = (value) => path.relative(repositoryRoot, value).replaceAll("\\", "/");
async function digest(value) { return sha256(await readFile(value)); }
function dependencies(source) {
  return [
    ...source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']/gu),
    ...source.matchAll(/new\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/gu)
  ].map((match) => match[1]).filter((value) => value.startsWith("."));
}
async function dependencyClosure(entryPath) {
  const pending = [path.resolve(entryPath)];
  const seen = new Set(pending);
  while (pending.length > 0) {
    const current = pending.shift();
    for (const specifier of dependencies(await readFile(current, "utf8"))) {
      const resolved = path.resolve(path.dirname(current), specifier);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      if (resolved.endsWith(".mjs")) pending.push(resolved);
    }
  }
  seen.delete(path.resolve(entryPath));
  return Promise.all([...seen].sort().map(async (value) => ({
    path: relative(value), sha256: await digest(value)
  })));
}

for (const [kind, profileId] of [["boundary", BOUNDARY_PROFILE_ID], ["guidance", GUIDANCE_PROFILE_ID]]) {
  const profile = buildProfile(kind);
  const profileDigest = stableProfileDigest(profile);
  const declaration = buildDeclaration(kind, profile);
  const fixture = kind === "boundary" ? buildBoundaryFixture() : buildGuidanceFixture();
  const template = buildEvaluationInput(kind, fixture.report);
  const adequacyModule = path.join(packageRoot, "test/proof-packs/bounded-policy-v1-adequacy.mjs");
  const adequacyRun = await runProofPackAdequacyControls({ profile, profile_digest: profileDigest });
  const ids = (category) => adequacyRun.controls.filter((item) => item.category === category)
    .map(({ control_id: id }) => id).sort();
  const adequacy = {
    schema_version: "controlled-contract-proof-pack-adequacy.experimental.v0.1",
    profile_id: profileId, profile_version: "2.0.0", profile_digest: profileDigest,
    guarantee: GUARANTEES[kind], guarantee_digest: sha256(Buffer.from(GUARANTEES[kind])),
    required_positive_cases: ids("positive"), required_mutant_kills: ids("mutant"),
    required_profile_rejections: ids("profile_rejection"),
    explicit_exclusions: [...EXCLUSIONS[kind]].sort(),
    executable_module: relative(adequacyModule),
    executable_module_digest: await digest(adequacyModule),
    executable_dependency_digests: await dependencyClosure(adequacyModule)
  };
  const exact = await runExactBindingCertificationControls({ kind });
  if (exact.failed_control_ids.length > 0) throw new Error(`${kind} exact controls failed`);
  const exactModule = path.join(packageRoot, "test/proof-packs/bounded-policy-v1-exact-corpus.mjs");
  const exactCertification = {
    schema_version: "controlled-contract-exact-binding-certification-result.v1",
    profile_id: profileId, profile_version: "2.0.0", profile_digest: profileDigest,
    exact_binding_declaration_digest: sha256(canonicalJsonBytes(declaration, { file: true })),
    corpus: {
      corpus_id: `proof-policy-${kind}-exact-binding`, corpus_version: "1.0.0",
      corpus_digest: sha256(canonicalJsonBytes({ kind, controls: CONTROL_IDS })),
      executable_module: relative(exactModule), executable_module_digest: await digest(exactModule),
      executable_control_count: CONTROL_IDS.length
    },
    result: { status: "passed", passed_control_ids: exact.passed_control_ids, failed_control_ids: [] }
  };
  const directory = path.join(packageRoot, "test/certification/profiles", profileId, "1.0.0");
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(path.join(directory, "profile.json"), `${JSON.stringify(profile, null, 2)}\n`),
    writeFile(path.join(directory, "evaluation-input.template.json"), `${JSON.stringify(template, null, 2)}\n`),
    writeFile(path.join(directory, "exact-binding.json"), canonicalJsonBytes(declaration, { file: true })),
    writeFile(path.join(directory, "adequacy.json"), `${JSON.stringify(adequacy, null, 2)}\n`),
    writeFile(path.join(directory, "exact-binding-certification.json"),
      canonicalJsonBytes(exactCertification, { file: true }))
  ]);
  process.stdout.write(`${profileId}@1.0.0 ${profileDigest} ${adequacyRun.controls.length} ${CONTROL_IDS.length}\n`);
}
