

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const WIKI_PACKAGE_PROVENANCE_ERROR_CODES = Object.freeze({
  MANIFEST_UNREADABLE: "wiki_package_provenance.manifest_unreadable.v1",
  MANIFEST_INVALID_JSON: "wiki_package_provenance.manifest_invalid_json.v1",
  REPOSITORY_MISSING: "wiki_package_provenance.repository_missing.v1",
  REPOSITORY_URL_MISSING: "wiki_package_provenance.repository_url_missing.v1",
  REPOSITORY_URL_UNSUPPORTED: "wiki_package_provenance.repository_url_unsupported.v1"
});

export class WikiPackageProvenanceError extends Error {
  constructor(code, message, { packageManifestPath, field, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WikiPackageProvenanceError";
    this.code = code;
    this.packageManifestPath = packageManifestPath ?? null;
    this.field = field ?? null;
  }
}

export const WIKI_CORE_PACKAGE_MANIFEST_PATH = fileURLToPath(
  new URL("../../package.json", import.meta.url)
);

const SHIPPED_REPOSITORY_URL = /^git\+https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/;

function describePackage(manifest, packageManifestPath) {
  const name = typeof manifest?.name === "string" && manifest.name.trim() !== ""
    ? manifest.name.trim()
    : "(unnamed package)";
  return `${name} (${packageManifestPath})`;
}

function readPackageManifest(packageManifestPath) {
  let raw;
  try {
    raw = readFileSync(packageManifestPath, "utf8");
  } catch (error) {
    throw new WikiPackageProvenanceError(
      WIKI_PACKAGE_PROVENANCE_ERROR_CODES.MANIFEST_UNREADABLE,
      `Cannot resolve wiki contract sourceRepo: package manifest is unreadable at ${packageManifestPath} (${error?.code || error?.message || error})`,
      { packageManifestPath, field: "package.json", cause: error }
    );
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new WikiPackageProvenanceError(
      WIKI_PACKAGE_PROVENANCE_ERROR_CODES.MANIFEST_INVALID_JSON,
      `Cannot resolve wiki contract sourceRepo: package manifest is not valid JSON at ${packageManifestPath} (${error?.message || error})`,
      { packageManifestPath, field: "package.json", cause: error }
    );
  }
}

export function resolvePackageRepositoryCoordinate(
  packageManifestPath = WIKI_CORE_PACKAGE_MANIFEST_PATH
) {
  const manifest = readPackageManifest(packageManifestPath);
  const described = describePackage(manifest, packageManifestPath);
  const repository = manifest?.repository;

  if (repository === null || typeof repository !== "object" || Array.isArray(repository)) {
    throw new WikiPackageProvenanceError(
      WIKI_PACKAGE_PROVENANCE_ERROR_CODES.REPOSITORY_MISSING,
      `Cannot resolve wiki contract sourceRepo: ${described} declares no object 'repository' field`,
      { packageManifestPath, field: "repository" }
    );
  }

  const url = repository.url;
  if (typeof url !== "string" || url.trim() === "") {
    throw new WikiPackageProvenanceError(
      WIKI_PACKAGE_PROVENANCE_ERROR_CODES.REPOSITORY_URL_MISSING,
      `Cannot resolve wiki contract sourceRepo: ${described} declares no non-empty 'repository.url'`,
      { packageManifestPath, field: "repository.url" }
    );
  }

  const match = SHIPPED_REPOSITORY_URL.exec(url.trim());
  if (!match) {
    throw new WikiPackageProvenanceError(
      WIKI_PACKAGE_PROVENANCE_ERROR_CODES.REPOSITORY_URL_UNSUPPORTED,
      `Cannot resolve wiki contract sourceRepo: ${described} declares an unsupported 'repository.url': ${JSON.stringify(url)} (expected git+https://github.com/<owner>/<repository>[.git])`,
      { packageManifestPath, field: "repository.url" }
    );
  }

  return `${match[1]}/${match[2]}`;
}
