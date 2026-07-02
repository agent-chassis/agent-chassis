import {
  launchWorkspaceAgentFamilyLaunchLifecycle
} from "./workspace-agent-family-launch-lifecycle.mjs";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resolveLaunchEnvelope(options) {
  if (isPlainObject(options.launchPlanEnvelope)) {
    return options.launchPlanEnvelope;
  }
  if (isPlainObject(options.admittedLaunch)) {
    return options.admittedLaunch;
  }
  return null;
}

export async function launchWorkspaceAgentFamilyFailOpenPlainSpawn(options = {}) {
  const launchEnvelope = resolveLaunchEnvelope(options);
  const launchPlan = isPlainObject(options.launchPlan)
    ? options.launchPlan
    : launchEnvelope?.plan;
  if (!isPlainObject(launchPlan)) {
    return null;
  }

  return launchWorkspaceAgentFamilyLaunchLifecycle({
    command: launchPlan.command,
    args: launchPlan.args,
    cwd: launchPlan.cwd,
    env: launchPlan.env,
    options: {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false
    },
    spawn: options.plainSpawn,
    superviseChildLaunch: options.superviseChildLaunch,
    parseFinalResult: options.parseFinalResult,
    passthrough: options.passthrough ?? {},
    role: options.role ?? null,
    subject: options.subject ?? null,
    kind: options.family ?? null,
    killTimeoutMs: options.killTimeoutMs ?? null,
    warning: options.warning ?? launchEnvelope?.warning,
    enforcement: options.enforcement ?? launchEnvelope?.enforcement,
    buildSpawnThrewRefusal: (detail) =>
      options.buildRefusal("plain_spawn_threw", detail),
    buildNoChildRefusal: () => options.buildRefusal("plain_spawn_no_child", null),
    adaptSupervisedResult: (supervised) =>
      typeof options.adaptSupervisedResult === "function"
        ? options.adaptSupervisedResult(supervised, {
            launchPlan,
            launchPlanEnvelope: launchEnvelope,
            passthrough: options.passthrough ?? {}
          })
        : supervised
  });
}
