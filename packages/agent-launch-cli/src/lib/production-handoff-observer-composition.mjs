import {
  buildDispatchRuntime,
  createTerminalCandidateCoordinator,
  createWkForgeHandoffAuthenticationObserver,
  resolveDispatchWorktreeProvisioningConfig
} from "../../../wiki-mcp/src/lib/dispatch-launch-runtime.mjs";

export function createProductionHandoffObserverComposition({
  env = process.env,
  composition = null,
  command
} = {}) {
  const provisioning = resolveDispatchWorktreeProvisioningConfig(env, {
    testWorktreeRoot: composition?.worktreeRoot ?? null
  });
  if (provisioning === null) {
    throw new Error(`${command} requires launcher-minted workspace provisioning`);
  }

  const runtime = buildDispatchRuntime(env, { testComposition: composition });
  if (!runtime.dispatchBackend) {
    throw new Error(`${command} trusted launcher runtime is unavailable`);
  }
  const terminalCandidateCoordinator = createTerminalCandidateCoordinator({
    mainRepo: provisioning.mainRepo,
    worktreeRoot: provisioning.worktreeRoot
  });
  return {
    mainRepo: provisioning.mainRepo,

    resolveAuthenticatedWkForgeHandoff: createWkForgeHandoffAuthenticationObserver({
      mainRepo: provisioning.mainRepo,
      terminalCandidateCoordinator
    })
  };
}
