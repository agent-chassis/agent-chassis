

import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const CORE_PACKAGE_DOCS_MANIFEST_SCHEMA_VERSION =
  "public-docs-manifest.v1";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_JSON_PATH = path.join(PACKAGE_ROOT, "package.json");
const DOCS_ROOT = path.join(PACKAGE_ROOT, "docs");
const MANIFEST_PATH = path.join(DOCS_ROOT, "public-docs-manifest.json");

export async function createCorePackageDocsCarrier() {
  const packageJson = JSON.parse(await readFile(PACKAGE_JSON_PATH, "utf8"));
  return Object.freeze({
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    packageRoot: PACKAGE_ROOT,
    docsRoot: DOCS_ROOT,
    manifestPath: MANIFEST_PATH
  });
}
