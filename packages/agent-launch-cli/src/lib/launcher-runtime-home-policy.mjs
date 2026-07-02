import { posix as pathPosix } from 'node:path';
import os from 'node:os';

const EMPTY_FROZEN_LIST = Object.freeze([]);

export const LAUNCHER_RUNTIME_HOME_FACT_RESOLUTION_REASON =
  'launcher_runtime_home_fact_unresolvable';

export const LAUNCHER_RUNTIME_HOME_POLICY_SYSTEM_PREFIXES = Object.freeze([
  '/usr',
  '/opt',
  '/bin',
  '/sbin',
  '/lib',
  '/lib64',
]);

function normalizeAbsolutePath(pathValue, label) {
  if (typeof pathValue !== 'string') {
    throw new TypeError(`${label} must be a non-empty absolute POSIX path string`);
  }

  const trimmedPath = pathValue.trim();
  if (trimmedPath.length === 0) {
    throw new TypeError(`${label} must be a non-empty absolute POSIX path string`);
  }

  const normalizedPath = pathPosix.normalize(trimmedPath);
  if (!normalizedPath.startsWith('/')) {
    throw new TypeError(`${label} must be an absolute POSIX path string`);
  }

  if (normalizedPath === '/') {
    throw new RangeError(`${label} must not resolve to the filesystem root`);
  }

  return normalizedPath;
}

function freezeUniqueList(values) {
  return Object.freeze([...new Set(values)]);
}

function deriveLauncherRuntimeHomePaths(launcherOwnedHostHome) {
  const hostHome = normalizeAbsolutePath(launcherOwnedHostHome, 'launcherOwnedHostHome');

  const paths = {
    hostHome,
    executable: pathPosix.join(hostHome, '.local', 'bin', 'claude'),
    readOnlyRoot: pathPosix.join(hostHome, '.local', 'share', 'claude'),
    credentialsFile: pathPosix.join(hostHome, '.claude', '.credentials.json'),
    configDirectory: pathPosix.join(hostHome, '.config'),
    gcloudDirectory: pathPosix.join(hostHome, '.config', 'gcloud'),
    gcpCredentialsDirectory: pathPosix.join(hostHome, 'gcp-credentials'),
    claudeDirectory: pathPosix.join(hostHome, '.claude'),
  };

  return Object.freeze(paths);
}

export function deriveLauncherRuntimeHomePolicyFacts({
  launcherOwnedHostHome,
  platform = 'linux',
  includeSystemRuntimePrefixes = true,
} = {}) {
  const paths = deriveLauncherRuntimeHomePaths(launcherOwnedHostHome);

  const approvedExecutablePaths = freezeUniqueList([paths.executable]);
  const approvedReadOnlyRoots = freezeUniqueList([paths.readOnlyRoot]);
  const approvedReadOnlyFiles = freezeUniqueList([paths.credentialsFile]);

  const deniedPaths = freezeUniqueList([
    paths.hostHome,
    paths.configDirectory,
    paths.gcloudDirectory,
    paths.gcpCredentialsDirectory,
    paths.claudeDirectory,
  ]);

  const deniedDirectories = freezeUniqueList([
    paths.hostHome,
    paths.configDirectory,
    paths.gcloudDirectory,
    paths.gcpCredentialsDirectory,
    paths.claudeDirectory,
  ]);

  const deniedParentDirectories = freezeUniqueList([
    paths.hostHome,
    paths.configDirectory,
    paths.gcpCredentialsDirectory,
    paths.claudeDirectory,
  ]);

  return Object.freeze({
    kind: 'launcher-runtime-home-policy-facts',
    platform,
    launcherOwnedHostHome: paths.hostHome,
    paths,
    approvedExecutablePaths,
    approvedReadOnlyRoots,
    approvedReadOnlyFiles,
    deniedPaths,
    deniedDirectories,
    deniedParentDirectories,
    systemRuntimePrefixes: includeSystemRuntimePrefixes
      ? LAUNCHER_RUNTIME_HOME_POLICY_SYSTEM_PREFIXES
      : EMPTY_FROZEN_LIST,
  });
}

export const createLauncherRuntimeHomePolicyFacts = deriveLauncherRuntimeHomePolicyFacts;

function defaultReadLauncherOwnedHostHome() {
  return os.userInfo().homedir;
}

function classifyHostHomeResolutionFailure(discovered, source = 'launcher_owned_host_home') {
  if (typeof discovered !== 'string') {
    return {
      kind: 'non_string',
      source,
      received_type: discovered === null ? 'null' : typeof discovered
    };
  }
  if (discovered.length === 0) {
    return { kind: 'empty', source };
  }
  if (!discovered.startsWith('/')) {
    return { kind: 'relative', source, value: discovered };
  }
  if (discovered === '/') {
    return { kind: 'root', source, value: discovered };
  }
  return null;
}

export function resolveLauncherOwnedHostHome({
  readHostHome = defaultReadLauncherOwnedHostHome,
  source = 'launcher_owned_host_home'
} = {}) {
  let discovered;
  try {
    discovered = readHostHome();
  } catch (err) {
    return {
      ok: false,
      reason: LAUNCHER_RUNTIME_HOME_FACT_RESOLUTION_REASON,
      detail: {
        fact: source,
        failure: 'threw',
        message: err?.message ?? String(err),
        code: err?.code ?? null
      }
    };
  }

  const failure = classifyHostHomeResolutionFailure(discovered, source);
  if (failure !== null) {
    return {
      ok: false,
      reason: LAUNCHER_RUNTIME_HOME_FACT_RESOLUTION_REASON,
      detail: { fact: source, failure: failure.kind, ...failure }
    };
  }
  return { ok: true, launcherOwnedHostHome: discovered };
}

export function resolveLauncherRuntimeHomePolicyFacts({
  readHostHome = defaultReadLauncherOwnedHostHome,
  launcherOwnedHostHome,
  platform = os.platform(),
  includeSystemRuntimePrefixes = true,
  source = 'launcher_owned_host_home'
} = {}) {
  const hostHome = typeof launcherOwnedHostHome === 'string'
    ? { ok: true, launcherOwnedHostHome }
    : resolveLauncherOwnedHostHome({ readHostHome, source });
  if (!hostHome.ok) return hostHome;

  try {
    return {
      ok: true,
      facts: deriveLauncherRuntimeHomePolicyFacts({
        launcherOwnedHostHome: hostHome.launcherOwnedHostHome,
        platform,
        includeSystemRuntimePrefixes
      })
    };
  } catch (err) {
    return {
      ok: false,
      reason: LAUNCHER_RUNTIME_HOME_FACT_RESOLUTION_REASON,
      detail: {
        fact: source,
        failure: 'policy_facts_invalid',
        launcherOwnedHostHome: hostHome.launcherOwnedHostHome,
        message: err?.message ?? String(err),
        code: err?.code ?? null
      }
    };
  }
}
