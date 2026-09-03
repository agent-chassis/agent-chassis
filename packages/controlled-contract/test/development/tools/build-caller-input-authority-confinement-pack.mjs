import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalJsonBytes,
  sha256
} from "../../../lib/exact-binding-common.mjs";
import { profileDigest as stableProfileDigest } from "../../support/stable-v1-proof-pack-runtime.mjs";
import {
  buildCallerInputAuthorityConfinementSources
} from "../../proof-packs/caller-input-authority-confinement-v1-fixture.mjs";
import {
  buildCallerInputAuthorityConfinementDeclaration,
  buildCallerInputAuthorityConfinementEvaluationInput,
  buildCallerInputAuthorityConfinementProfile
} from "../../proof-packs/caller-input-authority-confinement-v1-profile.mjs";
import {
  EXCLUSIONS,
  GUARANTEE
} from "../../proof-packs/caller-input-authority-confinement-v1-constants.mjs";
import {
  CONTROL_IDS,
  runExactBindingCertificationControls
} from "../../proof-packs/caller-input-authority-confinement-v1-exact-corpus.mjs";
import {
  runProofPackAdequacyControls
} from "../../proof-packs/caller-input-authority-confinement-v1-adequacy.mjs";

const packageRoot = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const repositoryRoot = path.resolve(packageRoot, "../..");
const certificationDirectory = path.join(
  packageRoot, "test", "certification", "profiles",
  "proof.input.caller-authority-confinement", "1.0.0"
);
const relative = (absolutePath) =>
  path.relative(repositoryRoot, absolutePath).replaceAll("\\", "/");

async function digest(absolutePath) {
  return sha256(await readFile(absolutePath));
}

function staticDependencies(source) {
  const specifiers = [];
  const importPattern =
    /(?:^|\n)\s*(?:import|export)\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']/gu;
  for (const match of source.matchAll(importPattern)) specifiers.push(match[1]);
  const resourcePattern =
    /new\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/gu;
  for (const match of source.matchAll(resourcePattern)) specifiers.push(match[1]);
  return specifiers.filter((specifier) =>
    specifier.startsWith("./") || specifier.startsWith("../"));
}

async function dependencyClosure(entryPath) {
  const entry = path.resolve(entryPath);
  const pending = [entry];
  const seen = new Set([entry]);
  while (pending.length > 0) {
    const current = pending.shift();
    const source = await readFile(current, "utf8");
    for (const specifier of staticDependencies(source)) {
      const resolved = path.resolve(path.dirname(current), specifier);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      if (resolved.endsWith(".mjs")) pending.push(resolved);
    }
  }
  seen.delete(entry);
  return Promise.all([...seen].sort().map(async (absolutePath) => ({
    path: relative(absolutePath),
    sha256: await digest(absolutePath)
  })));
}

const profile = buildCallerInputAuthorityConfinementProfile();
const profileDigest = stableProfileDigest(profile);
const declaration = buildCallerInputAuthorityConfinementDeclaration(profile);
const captured = buildCallerInputAuthorityConfinementSources();
const template = buildCallerInputAuthorityConfinementEvaluationInput(captured.projection);
const adequacyModule = path.join(
  packageRoot, "test", "proof-packs",
  "caller-input-authority-confinement-v1-adequacy.mjs"
);
const adequacyRun = await runProofPackAdequacyControls({
  profile, profile_digest: profileDigest
});
const controlIds = (category) => adequacyRun.controls
  .filter((control) => control.category === category)
  .map(({ control_id: controlId }) => controlId).sort();
const adequacy = {
  schema_version: "controlled-contract-proof-pack-adequacy.experimental.v0.1",
  profile_id: profile.profile_id,
  profile_version: profile.profile_version,
  profile_digest: profileDigest,
  guarantee: GUARANTEE,
  guarantee_digest: sha256(Buffer.from(GUARANTEE, "utf8")),
  required_positive_cases: controlIds("positive"),
  required_mutant_kills: controlIds("mutant"),
  required_profile_rejections: controlIds("profile_rejection"),
  explicit_exclusions: [...EXCLUSIONS].sort(),
  executable_module: relative(adequacyModule),
  executable_module_digest: await digest(adequacyModule),
  executable_dependency_digests: await dependencyClosure(adequacyModule)
};
const exactResult = await runExactBindingCertificationControls({
  certificationDirectory
});
if (exactResult.failed_control_ids.length > 0) {
  throw new Error(`exact controls failed: ${exactResult.failed_control_ids.join(", ")}`);
}
const exactModule = path.join(
  packageRoot, "test", "proof-packs",
  "caller-input-authority-confinement-v1-exact-corpus.mjs"
);
const corpusIdentity = {
  corpus_id: "proof-input-caller-authority-confinement-exact-binding",
  corpus_version: "1.0.0",
  controls: CONTROL_IDS
};
const exactCertification = {
  schema_version: "controlled-contract-exact-binding-certification-result.v1",
  profile_id: profile.profile_id,
  profile_version: profile.profile_version,
  profile_digest: profileDigest,
  exact_binding_declaration_digest: sha256(canonicalJsonBytes(declaration, { file: true })),
  corpus: {
    corpus_id: corpusIdentity.corpus_id,
    corpus_version: corpusIdentity.corpus_version,
    corpus_digest: sha256(canonicalJsonBytes(corpusIdentity)),
    executable_module: relative(exactModule),
    executable_module_digest: await digest(exactModule),
    executable_control_count: CONTROL_IDS.length
  },
  result: {
    status: "passed",
    passed_control_ids: exactResult.passed_control_ids,
    failed_control_ids: []
  }
};

await mkdir(certificationDirectory, { recursive: true });
await Promise.all([
  writeFile(path.join(certificationDirectory, "profile.json"),
    `${JSON.stringify(profile, null, 2)}\n`),
  writeFile(path.join(certificationDirectory, "evaluation-input.template.json"),
    `${JSON.stringify(template, null, 2)}\n`),
  writeFile(path.join(certificationDirectory, "exact-binding.json"),
    canonicalJsonBytes(declaration, { file: true })),
  writeFile(path.join(certificationDirectory, "adequacy.json"),
    `${JSON.stringify(adequacy, null, 2)}\n`),
  writeFile(path.join(certificationDirectory, "exact-binding-certification.json"),
    canonicalJsonBytes(exactCertification, { file: true }))
]);

process.stdout.write(`${JSON.stringify({
  certification_directory: relative(certificationDirectory),
  profile_digest: profileDigest,
  exact_binding_declaration_digest: exactCertification.exact_binding_declaration_digest,
  adequacy_control_count: adequacyRun.controls.length,
  exact_binding_control_count: CONTROL_IDS.length,
  dependency_count: adequacy.executable_dependency_digests.length
}, null, 2)}\n`);
