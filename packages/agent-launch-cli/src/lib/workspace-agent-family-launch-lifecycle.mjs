export const WORKSPACE_AGENT_FAMILY_LAUNCH_LIFECYCLE_SCHEMA_VERSION =
  "workspace-agent-family-launch-lifecycle.v1";

const TERMINAL_PROBE_STATUSES = Object.freeze(["succeeded", "failed"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} must be a function`);
  }
}

function spawnErrorDetail(err) {
  return Object.freeze({ message: err?.message ?? String(err) });
}

function buildSpawnOptions({ cwd, env, options }) {
  const base = isPlainObject(options) ? { ...options } : {};
  if (cwd !== undefined) base.cwd = cwd;
  if (env !== undefined) base.env = env;
  return base;
}

function isTerminalProbeResult(probed, terminalStatuses) {
  return (
    isPlainObject(probed) &&
    terminalStatuses.has(probed.status) &&
    isPlainObject(probed.final_result)
  );
}

function defaultAttachFinalResultField(finalResult, field, value) {
  return { ...finalResult, [field]: value };
}

function buildMappedCheckFailure({
  mapFailure,
  phase,
  err,
  baseline
}) {
  if (typeof mapFailure === "function") {
    return mapFailure({ phase, error: err, baseline });
  }
  throw err;
}

async function maybeCaptureBaseline({
  captureBaseline,
  mapFailure
}) {
  if (typeof captureBaseline !== "function") return null;
  try {
    return await captureBaseline();
  } catch (err) {
    return {
      earlyReturn: true,
      value: buildMappedCheckFailure({
        mapFailure,
        phase: "baseline",
        err,
        baseline: null
      })
    };
  }
}

function attachTerminalCheck({
  supervised,
  runCheck,
  mapFailure,
  baseline,
  finalResultField,
  attachFinalResult,
  adaptProbeResult,
  terminalStatuses
}) {
  if (!isPlainObject(supervised) || typeof supervised.probe !== "function") {
    return supervised;
  }
  if (typeof runCheck !== "function" && typeof adaptProbeResult !== "function") {
    return supervised;
  }

  let checkStarted = false;
  let checkPromise = null;
  const runOnce = () => {
    if (!checkStarted) {
      checkStarted = true;
      checkPromise = Promise.resolve()
        .then(() => runCheck({ baseline }))
        .catch((err) =>
          buildMappedCheckFailure({
            mapFailure,
            phase: "terminal",
            err,
            baseline
          })
        );
    }
    return checkPromise;
  };

  const innerProbe = supervised.probe;
  return {
    ...supervised,
    probe: async () => {
      const probed = await innerProbe();
      if (!isTerminalProbeResult(probed, terminalStatuses)) {
        return probed;
      }

      const checkResult =
        typeof runCheck === "function" ? await runOnce() : undefined;
      const attachContext = Object.freeze({
        baseline,
        checkResult,
        probed
      });

      let finalResult = probed.final_result;
      if (typeof attachFinalResult === "function") {
        finalResult = await attachFinalResult(finalResult, attachContext);
      } else if (finalResultField && typeof runCheck === "function") {
        finalResult = defaultAttachFinalResultField(
          finalResult,
          finalResultField,
          checkResult
        );
      }

      const nextProbed = { ...probed, final_result: finalResult };
      if (typeof adaptProbeResult === "function") {
        return adaptProbeResult(nextProbed, attachContext);
      }
      return nextProbed;
    }
  };
}

export async function launchWorkspaceAgentFamilyLaunchLifecycle({
  command,
  args = [],
  cwd,
  env,
  options = {},
  spawn,
  superviseChildLaunch,
  parseFinalResult,
  passthrough = {},
  role = null,
  subject = null,
  kind = null,
  killTimeoutMs = null,
  killSignal,
  buildSpawnThrewRefusal,
  buildNoChildRefusal,
  warning = undefined,
  enforcement = undefined,
  adaptSupervisedResult = null,
  adaptEnvelope = null,
  postRunVerification = null,

  preSpawnBarrier = null,
  buildPreSpawnBarrierRefusal = null,

  resolveSpawn = null
} = {}) {
  requireFunction(spawn, "spawn");
  requireFunction(superviseChildLaunch, "superviseChildLaunch");
  requireFunction(parseFinalResult, "parseFinalResult");
  requireFunction(buildSpawnThrewRefusal, "buildSpawnThrewRefusal");
  requireFunction(buildNoChildRefusal, "buildNoChildRefusal");

  const verification = isPlainObject(postRunVerification)
    ? postRunVerification
    : {};
  const baselineResult = await maybeCaptureBaseline({
    captureBaseline: verification.captureBaseline,
    mapFailure: verification.mapFailure
  });
  if (baselineResult?.earlyReturn) return baselineResult.value;
  const baseline = baselineResult;

  let spawnNow = spawn;
  if (typeof resolveSpawn === "function") {
    try {
      spawnNow = await resolveSpawn();
    } catch (err) {
      return buildSpawnThrewRefusal(spawnErrorDetail(err));
    }
    if (typeof spawnNow !== "function") {
      return buildNoChildRefusal(null);
    }
  }

  if (typeof preSpawnBarrier === "function") {
    requireFunction(buildPreSpawnBarrierRefusal, "buildPreSpawnBarrierRefusal");

    if (typeof resolveSpawn !== "function") {
      return buildPreSpawnBarrierRefusal({
        ok: false,
        reason: "terminal_review_spawn_primitive_unresolved",
        detail: { family: kind ?? null, subject: subject ?? null }
      });
    }
    const verdict = preSpawnBarrier();
    if (verdict?.ok !== true) {
      return buildPreSpawnBarrierRefusal(verdict ?? null);
    }
  }

  let child;
  try {

    child = await spawnNow(
      command,
      Array.isArray(args) ? [...args] : [],
      buildSpawnOptions({ cwd, env, options })
    );
  } catch (err) {
    return buildSpawnThrewRefusal(spawnErrorDetail(err));
  }

  if (!child || typeof child !== "object") {
    return buildNoChildRefusal(null);
  }

  const superviseOptions = {
    child,
    parseFinalResult,
    role,
    subject,
    family: kind,
    passthrough,
    killTimeoutMs
  };
  if (killSignal !== undefined) superviseOptions.killSignal = killSignal;

  let supervised = superviseChildLaunch(superviseOptions);
  if (warning !== undefined) supervised = { ...supervised, warning };
  if (enforcement !== undefined) supervised = { ...supervised, enforcement };

  supervised = attachTerminalCheck({
    supervised,
    runCheck: verification.run,
    mapFailure: verification.mapFailure,
    baseline,
    finalResultField: verification.finalResultField,
    attachFinalResult: verification.attachFinalResult,
    adaptProbeResult: verification.adaptProbeResult,
    terminalStatuses: new Set(
      Array.isArray(verification.terminalStatuses)
        ? verification.terminalStatuses
        : TERMINAL_PROBE_STATUSES
    )
  });

  const adapterContext = Object.freeze({
    command,
    args: Array.isArray(args) ? [...args] : [],
    cwd,
    env,
    options,
    passthrough,
    baseline
  });

  if (typeof adaptSupervisedResult === "function") {
    supervised = await adaptSupervisedResult(supervised, adapterContext);
  }
  if (typeof adaptEnvelope === "function") {
    return adaptEnvelope(supervised, adapterContext);
  }
  return supervised;
}
