

import { mkdtemp, rm } from "node:fs/promises";
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
