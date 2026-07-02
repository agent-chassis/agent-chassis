

import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

export async function withTempDir(fn) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wiki-bootstrap-test-"));
  try {
    await fn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export const WK0001_TEMPLATE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../packages/wiki-core/templates/WK-0001.adoption-tracker.json"
);
export const WK0001_TEMPLATE_DATA = JSON.parse(readFileSync(WK0001_TEMPLATE_PATH, "utf8"));
