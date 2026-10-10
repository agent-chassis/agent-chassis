import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  CACHE_ROOT_SUFFIX,
  compiledValidatorCacheRoot
} from "@agent-chassis/controlled-contract/validator-cache";

function validatorCacheBackingError(code, message, details = null, cause = null) {
  const error = Object.assign(new Error(message), { code, details });
  if (cause !== null) error.cause = cause;
  return error;
}

function isContainedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && !path.isAbsolute(relative) &&
    relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

function assertOwnedReadOnlyValidatorCachePath(candidate, root) {
  let entry;
  let resolved;
  try {
    entry = lstatSync(candidate);
    resolved = realpathSync(candidate);
  } catch (error) {
    throw validatorCacheBackingError(
      "validator_cache_unavailable",
      "compiled-validator cache backing is unavailable",
      { path: candidate },
      error
    );
  }
  const launcherUid = typeof process.getuid === "function" ? process.getuid() : null;
  if (!entry.isDirectory() || entry.isSymbolicLink() || resolved !== candidate ||
      (launcherUid !== null && entry.uid !== launcherUid) || (entry.mode & 0o002) !== 0 ||
      (candidate !== root && !isContainedPath(root, candidate))) {
    throw validatorCacheBackingError(
      "validator_cache_containment_violation",
      "compiled-validator cache backing is redirected, writable, or not launcher-owned",
      { path: candidate, cache_root: root }
    );
  }
}

function prepareStandaloneValidatorCacheMountpoint(workspaceDir) {
  const launcherUid = typeof process.getuid === "function" ? process.getuid() : null;
  let current = workspaceDir;
  for (const segment of CACHE_ROOT_SUFFIX.slice(0, -1)) {
    current = path.join(current, segment);
    let entry;
    try {
      entry = lstatSync(current);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw validatorCacheBackingError(
          "validator_cache_containment_violation",
          "compiled-validator cache mountpoint parent could not be inspected",
          { path: current },
          error
        );
      }
      mkdirSync(current, { mode: 0o700 });
      entry = lstatSync(current);
    }
    if (!entry.isDirectory() || entry.isSymbolicLink() || realpathSync(current) !== current ||
        (launcherUid !== null && entry.uid !== launcherUid) || (entry.mode & 0o002) !== 0) {
      throw validatorCacheBackingError(
        "validator_cache_containment_violation",
        "compiled-validator cache mountpoint parent is redirected or not launcher-owned",
        { path: current }
      );
    }
  }
}

export function standaloneValidatorCacheBinds({ ensured, verified, workspaceDir }) {
  const packageRoot = path.resolve(compiledValidatorCacheRoot());
  if (ensured?.cache_root !== packageRoot || verified?.cache_root !== packageRoot ||
      ensured?.toolchain_digest !== verified?.toolchain_digest ||
      verified?.mode !== "verify" || verified?.result !== "hit" ||
      !/^[0-9a-f]{64}$/u.test(verified?.toolchain_digest ?? "") ||
      !Array.isArray(verified?.groups) || verified.groups.length === 0 ||
      verified.group_count !== verified.groups.length ||
      verified.groups.some((group) => group?.result !== "hit")) {
    throw validatorCacheBackingError(
      "validator_cache_unavailable",
      "compiled-validator cache backing did not verify against the package-owned identity"
    );
  }
  assertOwnedReadOnlyValidatorCachePath(packageRoot, packageRoot);
  const sourceParent = path.join(packageRoot, verified.toolchain_digest);
  if (verified.directory !== sourceParent) {
    throw validatorCacheBackingError(
      "validator_cache_containment_violation",
      "compiled-validator cache artifact root does not match its verified identity"
    );
  }
  assertOwnedReadOnlyValidatorCachePath(sourceParent, packageRoot);
  for (const group of verified.groups) {
    if (path.dirname(group.directory) !== sourceParent ||
        path.basename(group.directory).startsWith(".")) {
      throw validatorCacheBackingError(
        "validator_cache_containment_violation",
        "compiled-validator cache group escaped its verified artifact root",
        { path: group?.directory ?? null }
      );
    }
    assertOwnedReadOnlyValidatorCachePath(group.directory, packageRoot);
  }

  prepareStandaloneValidatorCacheMountpoint(workspaceDir);
  return Object.freeze([Object.freeze({
    src: packageRoot,
    dst: path.join(workspaceDir, ...CACHE_ROOT_SUFFIX)
  })]);
}

export function assertNoOverlappingValidatorCacheBinds(existingBinds, validatorCacheBinds) {
  const validatorDestinations = validatorCacheBinds.map(({ dst }) => dst);
  if (existingBinds.some(({ dst }) => validatorDestinations.some((candidate) =>
    dst === candidate || isContainedPath(dst, candidate) || isContainedPath(candidate, dst)))) {
    throw validatorCacheBackingError(
      "validator_cache_containment_violation",
      "compiled-validator cache destination overlaps another reviewer projection"
    );
  }
}
