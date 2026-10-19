

import path from "node:path";
import { WORK_RECORD_DIRECTORY_NAME } from "./work-record-store.mjs";
import { CONTROLLED_CONTRACT_PRIVATE_PATH_ROOT } from "./controlled-contract-private-path-policy.mjs";
import { kindRecordDirectories } from "./kind-record-store.mjs";
import { AGENTS_BOILERPLATE_SEEDED_RELATIVE_PATH, WIKI_MCP_DECLARATION_RELATIVE_PATH } from "./wiki-scaffold.mjs";
import { parseRepositoryScopePath } from "./work-record-repository-path.mjs";

export function validateArtifactLintSetting(metadata) {
  if (!metadata || !Object.hasOwn(metadata, "artifactLint")) return [];
  const setting = metadata.artifactLint;
  const invalid = cause => [{
    code: "artifact-scope-invalid", path: "wiki/.wiki-contract.json",
    message: `wiki/.wiki-contract.json: ${cause}; artifact checks were not evaluated; all artifact scope remains unverified. Repository maintainer: correct artifactLint to {additionalRoots: [canonical relative directories ending in '/']} and rerun lint. Structural validation is independent.`
  }];
  if (!setting || typeof setting !== "object" || Array.isArray(setting) ||
      Object.keys(setting).some(key => key !== "additionalRoots") ||
      !Array.isArray(setting.additionalRoots)) {
    return invalid("artifactLint must contain only the required additionalRoots string array");
  }
  for (const entry of setting.additionalRoots) {
    const parsed = parseRepositoryScopePath(entry);
    if (!parsed.ok || !parsed.value.directory_hint || /[*?\[\]{}]/u.test(entry)) {
      return invalid(`invalid artifactLint.additionalRoots entry ${JSON.stringify(entry)}`);
    }
  }
  return [];
}

export function resolveArtifactLintScope(manifest, metadata) {
  const diagnostics = validateArtifactLintSetting(metadata);
  if (diagnostics.length) return { ok: false, roots: [], files: [], diagnostics };
  const wikiRoot = path.posix.dirname(WORK_RECORD_DIRECTORY_NAME);
  const roots = [...new Set([
    WORK_RECORD_DIRECTORY_NAME,
    CONTROLLED_CONTRACT_PRIVATE_PATH_ROOT,
    ...kindRecordDirectories(manifest),
    ...Object.values(manifest.types)
      .filter(type => type.publicKind === "source" || type.publicKind === "area")
      .map(type => type.directory),
    path.posix.dirname(AGENTS_BOILERPLATE_SEEDED_RELATIVE_PATH),

    manifest.workRecordAuthority.legacyMarkdownProjectionDirectory,
    manifest.generatedViews.defaultDirectory,
    ...(metadata?.artifactLint?.additionalRoots ?? [])
  ].map(root => root.replace(/\/?$/u, "/")))].sort();
  const selectedRoots = roots.filter(root => !roots.some(other => other !== root && root.startsWith(other)));
  const files = [...new Set([
    ...manifest.runtimeFiles,
    WIKI_MCP_DECLARATION_RELATIVE_PATH,
    ...manifest.generatedViews.standardFiles.filter(file => file.startsWith(`${wikiRoot}/`))
  ])].filter(file => !selectedRoots.some(root => file.startsWith(root))).sort();
  return { ok: true, roots: selectedRoots, files, diagnostics: [] };
}
