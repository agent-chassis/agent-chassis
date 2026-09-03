

import { runPostWorkerSliceLifecycleBody } from "./dispatch-post-worker-lifecycle-run.mjs";

export async function runPostWorkerSliceLifecycle({ workspace, status, deps = {} } = {}) {
  return runPostWorkerSliceLifecycleBody({ workspace, status, deps });
}
