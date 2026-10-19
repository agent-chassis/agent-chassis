
import {
  closeSync, constants, fstatSync, lstatSync, openSync, rmSync
} from "node:fs";
import { createTestResourceScope } from "./test-resource-scope.mjs";

export function createTestRunArtifactResources() {
  const scope = createTestResourceScope();
  function ownDirectory(runDir, preserve) {
    let handle = null;
    scope.add(`run artifacts ${runDir}`, () => {
      try {
        if (preserve) return;
        let current;
        try { current = lstatSync(runDir, { bigint: true }); }
        catch (error) {
          if (error.code === "ENOENT") return;
          throw error;
        }
        const held = handle === null ? null : fstatSync(handle, { bigint: true });
        if (!held || !current.isDirectory() || current.isSymbolicLink() ||
            current.dev !== held.dev || current.ino !== held.ino) {
          throw new Error(`refusing cleanup of substituted artifact directory ${runDir}`);
        }
        rmSync(runDir, { recursive: true, force: true });
      } finally {
        if (handle !== null) closeSync(handle);
      }
    });
    handle = openSync(runDir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  }
  return { add: scope.add, dispose: scope.dispose, ownDirectory };
}
