import path from "node:path";
import { statSync } from "node:fs";

export const MCP_SANDBOX_PROFILE_SCHEMA_VERSION = "mcp-sandbox-profile.v0";

export const MCP_SANDBOX_RUNTIME_BLOCKER_CODES = Object.freeze({
  READ_ONLY_MOUNT: "read_only_mount",
  SANDBOX_WRITE_DENIAL: "sandbox_write_denial"
});

export const MCP_SANDBOX_CAPABILITIES = Object.freeze({
  CACHE_WRITE: "mcp_cache_write",
  RUNTIME_STATE_WRITE: "mcp_runtime_state_write",
  GENERATED_PACKAGE_README_WRITE: "mcp_generated_package_readme_write"
});

export const MCP_SANDBOX_PATH_CLASSES = Object.freeze({
  WIKI_SEARCH_CACHE: "wiki_search_cache",
  REPO_CODE_INDEX_CACHE: "repo_code_index_cache",
  MCP_RUNTIME_STATE: "mcp_runtime_state",
  GENERATED_PACKAGE_README_PROJECTIONS: "generated_package_readme_projections"
});

export const MCP_SANDBOX_ORCHESTRATOR_REQUIRED_CAPABILITIES = Object.freeze([
  MCP_SANDBOX_CAPABILITIES.CACHE_WRITE,
  MCP_SANDBOX_CAPABILITIES.RUNTIME_STATE_WRITE,
  MCP_SANDBOX_CAPABILITIES.GENERATED_PACKAGE_README_WRITE
]);

const FIXED_IN_REPO_SUBBIND = "fixed_in_repo_subbind";
const FIXED_IN_REPO_EXACT_FILES = "fixed_in_repo_exact_files";
const RELOCATABLE_RUNTIME_DIR = "relocatable_runtime_dir";
const OMIT_IF_PARENT_DIRECTORY_MISSING = "omit_if_parent_directory_missing";

const GENERATED_PACKAGE_README_PROJECTION_FILES = Object.freeze([
  "packages/agent-launch-cli/README.md",
  "packages/agent-launch-core/README.md",
  "packages/wiki-cli/README.md",
  "packages/wiki-core/README.md",
  "packages/wiki-core/data/README.md",
  "packages/wiki-mcp/README.md"
]);

const PROFILE = Object.freeze({
  schema_version: MCP_SANDBOX_PROFILE_SCHEMA_VERSION,
  capabilities: Object.freeze({
    [MCP_SANDBOX_CAPABILITIES.CACHE_WRITE]: Object.freeze({
      path_classes: Object.freeze([
        MCP_SANDBOX_PATH_CLASSES.WIKI_SEARCH_CACHE,
        MCP_SANDBOX_PATH_CLASSES.REPO_CODE_INDEX_CACHE
      ])
    }),
    [MCP_SANDBOX_CAPABILITIES.RUNTIME_STATE_WRITE]: Object.freeze({
      path_classes: Object.freeze([MCP_SANDBOX_PATH_CLASSES.MCP_RUNTIME_STATE])
    }),
    [MCP_SANDBOX_CAPABILITIES.GENERATED_PACKAGE_README_WRITE]: Object.freeze({
      path_classes: Object.freeze([
        MCP_SANDBOX_PATH_CLASSES.GENERATED_PACKAGE_README_PROJECTIONS
      ])
    })
  }),
  roles: Object.freeze({
    orchestrator: Object.freeze({
      capabilities: Object.freeze([
        MCP_SANDBOX_CAPABILITIES.CACHE_WRITE,
        MCP_SANDBOX_CAPABILITIES.RUNTIME_STATE_WRITE,
        MCP_SANDBOX_CAPABILITIES.GENERATED_PACKAGE_README_WRITE
      ])
    })
  }),
  path_classes: Object.freeze({
    [MCP_SANDBOX_PATH_CLASSES.WIKI_SEARCH_CACHE]: Object.freeze({
      binding_mode: FIXED_IN_REPO_SUBBIND,
      repo_relative_root: ".cache/wiki-search",
      paths: Object.freeze([".cache/wiki-search/**"])
    }),
    [MCP_SANDBOX_PATH_CLASSES.REPO_CODE_INDEX_CACHE]: Object.freeze({
      binding_mode: FIXED_IN_REPO_SUBBIND,
      repo_relative_root: ".cache/repo-code-index",
      paths: Object.freeze([".cache/repo-code-index/**"])
    }),
    [MCP_SANDBOX_PATH_CLASSES.MCP_RUNTIME_STATE]: Object.freeze({
      binding_mode: RELOCATABLE_RUNTIME_DIR,
      env: "WIKI_MCP_RESPONSE_STATE_DIR"
    }),
    [MCP_SANDBOX_PATH_CLASSES.GENERATED_PACKAGE_README_PROJECTIONS]: Object.freeze({
      binding_mode: FIXED_IN_REPO_EXACT_FILES,
      missing_parent_policy: OMIT_IF_PARENT_DIRECTORY_MISSING,
      paths: GENERATED_PACKAGE_README_PROJECTION_FILES
    })
  })
});

export class McpSandboxProfileError extends Error {
  constructor(message, { detail = null, cause = null } = {}) {
    super(message);
    this.name = "McpSandboxProfileError";
    this.code = MCP_SANDBOX_RUNTIME_BLOCKER_CODES.SANDBOX_WRITE_DENIAL;
    if (detail !== null) {
      this.detail = detail;
    }
    if (cause !== null) {
      this.cause = cause;
    }
  }
}

function freezeClone(value) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => freezeClone(entry)));
  }
  if (value && typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freezeClone(entry)]))
    );
  }
  return value;
}

export function getMcpSandboxProfile() {
  return freezeClone(PROFILE);
}

export function buildOrchestratorMcpSandboxProfileRequest() {
  return Object.freeze({
    launcherRole: "orchestrator",
    capabilities: Object.freeze([...MCP_SANDBOX_ORCHESTRATOR_REQUIRED_CAPABILITIES])
  });
}

function denial(message, detail) {
  throw new McpSandboxProfileError(`mcp sandbox profile: ${message}`, {
    detail: Object.freeze({
      runtime_blocker_code: MCP_SANDBOX_RUNTIME_BLOCKER_CODES.SANDBOX_WRITE_DENIAL,
      schema_version: MCP_SANDBOX_PROFILE_SCHEMA_VERSION,
      ...detail
    })
  });
}

function roleProfileFor(launcherRole, detail = {}) {
  if (typeof launcherRole !== "string" || launcherRole.length === 0) {
    denial("launcher role is required", {
      reason: "missing_role",
      launcher_role: launcherRole ?? null,
      available_roles: Object.freeze(Object.keys(PROFILE.roles)),
      ...detail
    });
  }
  const roleProfile = PROFILE.roles[launcherRole];
  if (!roleProfile) {
    denial(`launcher role '${launcherRole}' has no MCP sandbox profile`, {
      reason: "missing_role",
      launcher_role: launcherRole,
      available_roles: Object.freeze(Object.keys(PROFILE.roles)),
      ...detail
    });
  }
  return roleProfile;
}

function capabilityProfileFor(capability) {
  const capabilityProfile = PROFILE.capabilities[capability];
  if (!capabilityProfile) {
    denial(`MCP sandbox capability '${capability}' is not declared`, {
      reason: "missing_capability",
      capability,
      available_capabilities: Object.freeze(Object.keys(PROFILE.capabilities))
    });
  }
  return capabilityProfile;
}

function pathClassProfileFor(pathClass) {
  const pathClassProfile = PROFILE.path_classes[pathClass];
  if (!pathClassProfile) {
    denial(`MCP sandbox path class '${pathClass}' is not declared`, {
      reason: "missing_path_class",
      path_class: pathClass,
      available_path_classes: Object.freeze(Object.keys(PROFILE.path_classes))
    });
  }
  return pathClassProfile;
}

function pathClassesForCapabilities(capabilities) {
  return Object.freeze(
    capabilities.flatMap((capability) => {
      const capabilityProfile = PROFILE.capabilities[capability];
      return capabilityProfile ? [...capabilityProfile.path_classes] : [];
    })
  );
}

function denyMissingRequiredCapabilities({ launcherRole, roleProfile, capabilities }) {
  const requestedCapabilities = Array.isArray(capabilities)
    ? Object.freeze([...capabilities])
    : Object.freeze([]);
  const requestedCapabilitySet = new Set(requestedCapabilities);
  const missingCapabilities = roleProfile.capabilities.filter(
    (capability) => !requestedCapabilitySet.has(capability)
  );
  if (missingCapabilities.length === 0) return;
  const missingPathClasses = pathClassesForCapabilities(missingCapabilities);
  denial("required capabilities are missing for MCP sandbox profile mount planning", {
    reason: "missing_capability",
    launcher_role: launcherRole,
    capability: missingCapabilities[0] ?? null,
    path_class: missingPathClasses[0] ?? null,
    required_capabilities: Object.freeze([...roleProfile.capabilities]),
    requested_capabilities: requestedCapabilities,
    missing_capabilities: Object.freeze([...missingCapabilities]),
    missing_path_classes: missingPathClasses
  });
}

export function assertMcpSandboxCapability({
  launcherRole,
  capability,
  pathClass = null
} = {}) {
  const roleProfile = roleProfileFor(launcherRole, {
    capability,
    path_class: pathClass
  });
  const capabilityProfile = capabilityProfileFor(capability);
  if (!roleProfile.capabilities.includes(capability)) {
    denial(`launcher role '${launcherRole}' is not granted '${capability}'`, {
      reason: "role_missing_capability",
      launcher_role: launcherRole,
      capability,
      granted_capabilities: Object.freeze([...roleProfile.capabilities])
    });
  }
  if (pathClass !== null) {
    pathClassProfileFor(pathClass);
    if (!capabilityProfile.path_classes.includes(pathClass)) {
      denial(`capability '${capability}' does not grant path class '${pathClass}'`, {
        reason: "capability_missing_path_class",
        launcher_role: launcherRole,
        capability,
        path_class: pathClass,
        capability_path_classes: Object.freeze([...capabilityProfile.path_classes])
      });
    }
  }
  return Object.freeze({
    launcher_role: launcherRole,
    capability,
    path_class: pathClass,
    granted_capabilities: Object.freeze([...roleProfile.capabilities])
  });
}

function normalizeCandidatePath({ repo, candidatePath }) {
  if (typeof repo !== "string" || repo.length === 0 || !path.isAbsolute(repo)) {
    throw new TypeError("repo must be an absolute path");
  }
  if (typeof candidatePath !== "string" || candidatePath.length === 0) {
    throw new TypeError("candidatePath must be a non-empty string");
  }
  const repoNormalized = path.normalize(repo);
  const absolute = path.isAbsolute(candidatePath)
    ? path.normalize(candidatePath)
    : path.normalize(path.join(repoNormalized, candidatePath));
  const relative = path.relative(repoNormalized, absolute).split(path.sep).join(path.posix.sep);
  return { absolute, relative };
}

function isPathInsideRepoRelativeRoot(relativePath, repoRelativeRoot) {
  const normalizedRoot = repoRelativeRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  return relativePath === normalizedRoot || relativePath.startsWith(`${normalizedRoot}/`);
}

function isExactRepoRelativeFile(relativePath, repoRelativeFiles) {
  return repoRelativeFiles.includes(relativePath);
}

function hasExistingParentDirectory(absoluteFile, { pathClass, repoRelativePath }) {
  const parent = path.dirname(absoluteFile);
  try {
    return statSync(parent).isDirectory();
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
      return false;
    }
    denial("generated package README parent directory could not be inspected", {
      reason: "exact_file_parent_stat_failed",
      path_class: pathClass,
      repo_relative_path: repoRelativePath,
      parent,
      errno: err?.code ?? null
    });
  }
  return false;
}

export function assertMcpSandboxWriteAllowed({
  launcherRole,
  capability,
  pathClass,
  repo,
  candidatePath
} = {}) {
  assertMcpSandboxCapability({ launcherRole, capability, pathClass });
  const pathClassProfile = pathClassProfileFor(pathClass);
  if (
    pathClassProfile.binding_mode !== FIXED_IN_REPO_SUBBIND &&
    pathClassProfile.binding_mode !== FIXED_IN_REPO_EXACT_FILES
  ) {
    denial(`path class '${pathClass}' is not a writable fixed in-repo path class`, {
      reason: "path_class_not_writable_fixed_in_repo",
      launcher_role: launcherRole,
      capability,
      path_class: pathClass,
      binding_mode: pathClassProfile.binding_mode
    });
  }
  const { absolute, relative } = normalizeCandidatePath({ repo, candidatePath });
  if (relative.startsWith("../") || relative === ".." || path.isAbsolute(relative)) {
    denial("candidate path escapes the repository", {
      reason: "path_outside_repo",
      launcher_role: launcherRole,
      capability,
      path_class: pathClass,
      candidate_path: candidatePath,
      resolved_path: absolute
    });
  }
  const allowed =
    pathClassProfile.binding_mode === FIXED_IN_REPO_SUBBIND
      ? isPathInsideRepoRelativeRoot(relative, pathClassProfile.repo_relative_root)
      : isExactRepoRelativeFile(relative, pathClassProfile.paths);
  if (!allowed) {
    denial("candidate path is outside the declared MCP sandbox path class", {
      reason: "path_outside_class",
      launcher_role: launcherRole,
      capability,
      path_class: pathClass,
      declared_paths: Object.freeze([...pathClassProfile.paths]),
      candidate_path: candidatePath,
      resolved_path: absolute
    });
  }
  return Object.freeze({
    launcher_role: launcherRole,
    capability,
    path_class: pathClass,
    candidate_path: absolute,
    repo_relative_path: relative
  });
}

export function buildMcpSandboxProfileMountPlan({
  repo,
  launcherRole,
  capabilities
} = {}) {
  const roleProfile = roleProfileFor(launcherRole, {
    requested_capabilities: Array.isArray(capabilities)
      ? Object.freeze([...capabilities])
      : null
  });
  if (capabilities === undefined || capabilities === null || (Array.isArray(capabilities) && capabilities.length === 0)) {
    const missingCapabilities = Object.freeze([...roleProfile.capabilities]);
    const missingPathClasses = pathClassesForCapabilities(missingCapabilities);
    denial("capabilities are required for MCP sandbox profile mount planning", {
      reason: "missing_capability",
      launcher_role: launcherRole,
      capability: missingCapabilities[0] ?? null,
      path_class: missingPathClasses[0] ?? null,
      required_capabilities: missingCapabilities,
      requested_capabilities: Object.freeze([]),
      missing_capabilities: missingCapabilities,
      missing_path_classes: missingPathClasses
    });
  }
  if (!Array.isArray(capabilities)) {
    denial("capabilities must be an array", {
      reason: "profile_request_invalid",
      launcher_role: launcherRole,
      capability: null,
      path_class: null,
      requested_capabilities_type: typeof capabilities
    });
  }
  const writableRoots = [];
  const writableFiles = [];
  const fixedPathClasses = [];
  const exactFilePathClasses = [];
  const runtimePathClasses = [];
  const capabilityProfiles = [];
  for (const capability of capabilities) {
    const capabilityProfile = capabilityProfileFor(capability);
    assertMcpSandboxCapability({ launcherRole, capability });
    capabilityProfiles.push([capability, capabilityProfile]);
  }
  denyMissingRequiredCapabilities({ launcherRole, roleProfile, capabilities });
  for (const [, capabilityProfile] of capabilityProfiles) {
    for (const pathClass of capabilityProfile.path_classes) {
      const pathClassProfile = pathClassProfileFor(pathClass);
      if (pathClassProfile.binding_mode === FIXED_IN_REPO_SUBBIND) {
        writableRoots.push(path.join(repo, pathClassProfile.repo_relative_root));
        fixedPathClasses.push(pathClass);
      } else if (pathClassProfile.binding_mode === FIXED_IN_REPO_EXACT_FILES) {
        for (const file of pathClassProfile.paths) {
          const absoluteFile = path.join(repo, file);
          if (
            pathClassProfile.missing_parent_policy === OMIT_IF_PARENT_DIRECTORY_MISSING &&
            !hasExistingParentDirectory(absoluteFile, {
              pathClass,
              repoRelativePath: file
            })
          ) {
            continue;
          }
          writableFiles.push(absoluteFile);
        }
        exactFilePathClasses.push(pathClass);
      } else if (pathClassProfile.binding_mode === RELOCATABLE_RUNTIME_DIR) {
        runtimePathClasses.push(pathClass);
      }
    }
  }
  return Object.freeze({
    schemaVersion: MCP_SANDBOX_PROFILE_SCHEMA_VERSION,
    launcherRole,
    grantedCapabilities: Object.freeze([...roleProfile.capabilities]),
    requestedCapabilities: Object.freeze([...capabilities]),
    writableRoots: Object.freeze([...new Set(writableRoots)]),
    writableFiles: Object.freeze([...new Set(writableFiles)]),
    fixedPathClasses: Object.freeze([...new Set(fixedPathClasses)]),
    exactFilePathClasses: Object.freeze([...new Set(exactFilePathClasses)]),
    runtimePathClasses: Object.freeze([...new Set(runtimePathClasses)])
  });
}

export function classifyMcpSandboxWriteFailure({
  error,
  failedPath,
  expectedCapability,
  pathClass
} = {}) {
  if (!error || error.code !== "EROFS") return null;
  return Object.freeze({
    code: MCP_SANDBOX_RUNTIME_BLOCKER_CODES.READ_ONLY_MOUNT,
    failed_path: failedPath ?? null,
    expected_capability: expectedCapability ?? null,
    path_class: pathClass ?? null
  });
}
