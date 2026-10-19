

import path from "node:path";
import { resolveLauncherRoleWritePosture, launcherRoleWritableRootPolicy } from "./workspace-agent-family-policy.mjs";
import { resolveLaunchRoleGuideGrant } from "./launch-isolation-plan.mjs";
import { assertFrozenWorkerScopeAuthority } from "./workspace-agent-launch-core.mjs";
import { DEFAULT_AGENT_LAUNCH_DIR_NAME, DEFAULT_REPO_ENV_FILE_NAME } from "./workspace-agent-family-bwrap-plan.mjs";
import { CONTROLLED_CONTRACT_PRIVATE_PATH_ROOT } from "@agent-chassis/wiki-core/src/lib/controlled-contract-private-path-policy.mjs";

const projections = new WeakSet();
const frozen = values => Object.freeze(values);
const membership = (root, members) => [
  ...members.files.map(file => frozen({ path: path.join(root, file), directory: false })),
  ...members.directories.map(dir => frozen({ path: path.join(root, dir), directory: true }))
];
const directory = value => frozen({ path: value, directory: true });

export function createLauncherNativePermissionFacts({ role, workspaceDir, workerScopeAuthority = null,
  registeredTier, publishControlledAcceptanceOptOut = true, mcpToolNames,
  responseStateDir = null, managedWorktreeRoot = null } = {}) {
  const posture = resolveLauncherRoleWritePosture({ role });
  if (!posture.ok || typeof workspaceDir !== "string" || !path.isAbsolute(workspaceDir) ||
      path.normalize(workspaceDir) !== workspaceDir) throw new TypeError("native_permission_launch_facts_invalid");
  if (!Array.isArray(mcpToolNames) || mcpToolNames.some(name => typeof name !== "string" || !/^[a-zA-Z0-9_]+$/.test(name))) {
    throw new TypeError("native_permission_tool_profile_invalid");
  }
  const scope = assertFrozenWorkerScopeAuthority(workerScopeAuthority, { role: posture.role,
    required: posture.scopeMount.requiresAssignedWriteScope });
  const reads = scope === null ? [directory(workspaceDir)] : [
    ...membership(workspaceDir, scope.resolved_scope.readable),
    ...membership(workspaceDir, scope.resolved_scope.writable)
  ];
  const writes = scope !== null ? membership(workspaceDir, scope.resolved_scope.writable)
    : launcherRoleWritableRootPolicy({ role: posture.role }).coordinationWriteRoots
      .map(root => directory(path.resolve(workspaceDir, root)));
  const guideGrant = resolveLaunchRoleGuideGrant(posture.coordinationWrite ? "orch" : posture.role,
    registeredTier, publishControlledAcceptanceOptOut);

  const guideFiles = new Set(guideGrant.requiredFiles);
  reads.push(...guideGrant.binds.map(bind => frozen({ path: bind.dst, directory: !guideFiles.has(bind.dst) })));
  const supportRoots = [responseStateDir, managedWorktreeRoot].filter(root => root !== null);
  if (!posture.coordinationWrite && supportRoots.length) throw new TypeError("native_permission_support_role_invalid");
  for (const root of supportRoots) {
    if (typeof root !== "string" || !path.isAbsolute(root) || path.normalize(root) !== root) {
      throw new TypeError("native_permission_support_root_invalid");
    }
    reads.push(directory(root));
  }
  const exclusions = scope?.scope_exclusions ?? [CONTROLLED_CONTRACT_PRIVATE_PATH_ROOT];
  const denied = [workspaceDir, ...(managedWorktreeRoot === null ? [] : [managedWorktreeRoot])]
    .flatMap(root => [DEFAULT_REPO_ENV_FILE_NAME, DEFAULT_AGENT_LAUNCH_DIR_NAME, ...exclusions]
      .map(relative => frozen({ root, relative, nested: root === managedWorktreeRoot })));
  const facts = frozen({ workspaceDir, reads: frozen(reads), writes: frozen(writes), denied: frozen(denied),
    commands: !posture.coordinationWrite, mcpToolNames: frozen([...new Set(mcpToolNames)].sort()) });
  projections.add(facts);
  return facts;
}

export function assertLauncherNativePermissionFacts(facts) {
  if (!projections.has(facts)) throw new TypeError("native_permission_facts_untrusted");
  return facts;
}
