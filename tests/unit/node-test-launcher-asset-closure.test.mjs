

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  NODE_TEST_PROOF_LAUNCHER_ASSETS,
  launcherNodeTestFaultLoaderUrl,
  launcherNodeTestReporterUrl
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-node-observation.mjs";

const IMPORT_SPECIFIER = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/gu;

function importClosure(entries) {
  const seen = new Set();
  const pending = [...entries];
  while (pending.length > 0) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (specifier.startsWith("node:")) continue;
      assert.ok(specifier.startsWith("./") || specifier.startsWith("../"),
        `${path.basename(file)} imports ${specifier}, which a read-only file projection cannot serve`);
      pending.push(path.resolve(path.dirname(file), specifier));
    }
  }
  return [...seen].sort();
}

test("the projected node:test assets are the reporter and loader import closure", () => {
  const reporter = fileURLToPath(launcherNodeTestReporterUrl());
  const loader = fileURLToPath(launcherNodeTestFaultLoaderUrl({}));
  assert.deepEqual(importClosure([reporter, loader]), [...NODE_TEST_PROOF_LAUNCHER_ASSETS].sort());
  for (const asset of NODE_TEST_PROOF_LAUNCHER_ASSETS) assert.ok(path.isAbsolute(asset), asset);
});
