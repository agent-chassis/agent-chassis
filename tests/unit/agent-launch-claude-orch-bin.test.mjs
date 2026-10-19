import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const REPO_ROOT = process.cwd();
const PACKAGE_JSON_PATH = `${REPO_ROOT}/packages/agent-launch-cli/package.json`;

async function readPackageJson() {
  return JSON.parse(await readFile(PACKAGE_JSON_PATH, "utf8"));
}

test("package.json bin map omits the deleted Claude orchestrator shim entrypoints", async () => {
  const pkg = await readPackageJson();
  assert.equal(Object.hasOwn(pkg, "bin"), false,
    "internal launcher exports no bins, including retired Claude orchestrator shims");
});
