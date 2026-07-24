

import {
  POST_WORKER_LIFECYCLE_PHASES,
  resolveManagedLifecycleBindings,
  resolveRetainedManagedWorkerTuple
} from "./dispatch-post-worker-lifecycle-bindings.mjs";
import { runPostWorkerSliceLifecycleBody } from "./dispatch-post-worker-lifecycle-run.mjs";

export async function runPostWorkerSliceLifecycle({ workspace, status, deps = {} } = {}) {
  const result = await runPostWorkerSliceLifecycleBody({ workspace, status, deps });
  await retireSettledManagedRunIdentity({ workspace, status, deps, result });
  return result;
}

async function retireSettledManagedRunIdentity({ workspace, status, deps, result }) {
  if (typeof deps.retireManagedWorkerIdentity !== "function") return;
  if (result?.phase !== POST_WORKER_LIFECYCLE_PHASES.FINALIZED || result.integrated !== true) return;
  try {
    const bindings = resolveManagedLifecycleBindings({ workspaceDir: workspace.dir, status }, deps);
    const workerTuple = resolveRetainedManagedWorkerTuple({ status, bindings });
    const integration = result.integration ?? null;
    await deps.retireManagedWorkerIdentity({
      ...workerTuple,
      reason: "finalized_integration",
      evidence: {
        slice_ref: integration?.slice_ref ?? bindings.slice?.output_branch ?? null,
        integrated_sha: integration?.wk_sha ?? integration?.slice_sha ?? null
      }
    });
  } catch {

  }
}
