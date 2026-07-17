import { spawn } from "node:child_process";
import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  BUBBLEWRAP_LAUNCH_PLAN_SCHEMA_VERSION,
  fail
} from "./launch-isolation-errors.mjs";
import { assertBubblewrapAvailable } from "./launch-isolation-bwrap.mjs";

export function spawnIsolated(plan, stdioOptions = {}) {
  if (!plan || typeof plan !== "object" || plan.schemaVersion !== BUBBLEWRAP_LAUNCH_PLAN_SCHEMA_VERSION) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PLAN_INVALID,
      `spawnIsolated requires a plan from buildBubblewrapLaunchPlan (schema ${BUBBLEWRAP_LAUNCH_PLAN_SCHEMA_VERSION})`
    );
  }
  const parentEnv = stdioOptions.env && typeof stdioOptions.env === "object" ? stdioOptions.env : process.env;
  const resolved = assertBubblewrapAvailable({
    env: parentEnv,
    bwrapPath: plan.bwrapPath
  });
  let child;
  try {
    child = spawn(resolved, plan.bwrapArgs, {
      stdio: stdioOptions.stdio ?? "inherit",
      env: parentEnv,
      detached: stdioOptions.detached === true,
      signal: stdioOptions.signal ?? undefined
    });
  } catch (err) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_SPAWN_FAILED,
      `bwrap child failed to spawn: ${resolved}`,
      { errno: err?.code ?? null, message: err?.message ?? null }
    );
  }
  return child;
}
