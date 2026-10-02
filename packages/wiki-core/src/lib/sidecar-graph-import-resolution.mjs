import path from "node:path";

import { resolveRustImportFact, SIDECAR_RUST_CRATE_SET_CANDIDATE } from "./sidecar-graph-rust-imports.mjs";

export const LOCAL_IMPORT_PREFIX = /^\.{1,2}\//;

export const SIDECAR_GO_MODULE_SET_CANDIDATE = "go.mod:*";

function directoryCandidate(directory) {
  return `${directory}/`;
}

function goDirectory(relativePath) {
  const directory = path.posix.dirname(relativePath);
  return directory === "" ? "." : directory;
}

export function sidecarResolutionCandidateKeys(changedPath) {
  const keys = [changedPath, directoryCandidate(goDirectory(changedPath))];
  if (path.posix.basename(changedPath) === "go.mod") keys.push(SIDECAR_GO_MODULE_SET_CANDIDATE);
  if (path.posix.basename(changedPath) === "Cargo.toml") keys.push(SIDECAR_RUST_CRATE_SET_CANDIDATE);
  return keys;
}

const goPackageIndexes = new WeakMap();

function goPackageIndex(sourcePathSet) {
  let index = goPackageIndexes.get(sourcePathSet);
  if (!index) {
    index = new Map();
    for (const candidate of sourcePathSet) {
      if (!candidate.endsWith(".go") || candidate.endsWith("_test.go")) continue;
      const directory = goDirectory(candidate);
      index.set(directory, [...(index.get(directory) ?? []), candidate].sort());
    }
    goPackageIndexes.set(sourcePathSet, index);
  }
  return index;
}

function resolveGoImport(specifier, sourcePathSet, goModules) {
  const matches = goModules.filter(({ module }) => specifier === module || specifier.startsWith(`${module}/`));
  if (matches.length === 0) {
    return { external: true, resolved: false, unresolvedReason: "external_or_unresolved", packageDir: null };
  }
  const longest = Math.max(...matches.map(({ module }) => module.length));
  const owners = matches.filter(({ module }) => module.length === longest);
  if (owners.length > 1) {
    return { external: false, resolved: false, unresolvedReason: "ambiguous_go_module",
      candidatePaths: owners.map(({ go_mod }) => go_mod).sort(), packageDir: null };
  }
  const [owner] = owners;
  const suffix = specifier.slice(owner.module.length + 1);
  const packageDir = suffix === "" ? owner.dir : owner.dir === "." ? suffix : `${owner.dir}/${suffix}`;
  const targets = goPackageIndex(sourcePathSet).get(packageDir) ?? [];
  return targets.length === 0
    ? { external: false, resolved: false, unresolvedReason: "local_path_unresolved", packageDir }
    : { external: false, resolved: true, targetPaths: targets, resolutionBasis: "go_package_directory",
        packageDir };
}

export function localImportCandidates(basePath, languageKey) {
  if (path.posix.extname(basePath)) {
    return [basePath];
  }

  if (languageKey === "python") {
    return [`${basePath}.py`, path.posix.join(basePath, "__init__.py")];
  }

  return [
    `${basePath}.mjs`,
    `${basePath}.js`,
    `${basePath}.ts`,
    `${basePath}.cjs`,
    `${basePath}.mts`,
    `${basePath}.cts`,
    `${basePath}.jsx`,
    `${basePath}.tsx`,
    `${basePath}.py`,
    path.posix.join(basePath, "index.mjs"),
    path.posix.join(basePath, "index.js"),
    path.posix.join(basePath, "index.ts"),
    path.posix.join(basePath, "__init__.py")
  ];
}

export function resolveLocalImport(
  fromPath,
  specifier,
  sourcePathSet,
  { languageKey = null } = {}
) {
  if (!LOCAL_IMPORT_PREFIX.test(specifier)) {
    return {
      targetPath: null,
      moduleKey: null,
      external: true,
      resolved: false,
      unresolvedReason: "external_or_unresolved"
    };
  }

  const basePath = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), specifier));
  const candidates = localImportCandidates(basePath, languageKey);
  const matchedCandidates = candidates.filter((candidate) => sourcePathSet.has(candidate));
  if (matchedCandidates.length > 1) {
    return {
      targetPath: null,
      moduleKey: null,
      external: false,
      resolved: false,
      unresolvedReason: "ambiguous_local_path",
      candidatePaths: matchedCandidates
    };
  }
  const targetPath = matchedCandidates[0] ?? null;
  const resolutionBasis =
    targetPath && targetPath === basePath ? "exact_path" : targetPath ? "extension_guess" : null;
  return {
    targetPath,
    moduleKey: targetPath,
    external: false,
    resolved: Boolean(targetPath),
    unresolvedReason: targetPath ? null : "local_path_unresolved",
    resolutionBasis
  };
}

export function resolveImportFacts({ facts, relativePath, sourcePathSet, goModules = [], rustCrates = [] }) {
  return facts.map((fact) => {
    if (fact.dynamic || !fact.specifier) {
      return {
        ...fact,
        resolutionState: "dynamic",
        unresolvedReason: "non_literal_specifier"
      };
    }
    if (fact.languageKey === "rust") {
      const { dependencies: _dependencies, ...target } = resolveRustImportFact({ fact, relativePath,
        sourcePathSet, rustCrates });
      return target.resolved
        ? { ...fact, external: false, resolutionState: "resolved", targetPath: null,
            targetPaths: target.targetPaths, resolutionBasis: "rust_module_file" }
        : { ...fact, external: target.external, resolutionState: "unresolved", targetPath: null,
            unresolvedReason: target.unresolvedReason, candidatePaths: target.candidatePaths };
    }
    if (fact.languageKey === "go") {
      const target = resolveGoImport(fact.specifier, sourcePathSet, goModules);
      return target.resolved
        ? { ...fact, external: false, resolutionState: "resolved", targetPath: null,
            targetPaths: target.targetPaths, resolutionBasis: target.resolutionBasis }
        : { ...fact, external: target.external, resolutionState: "unresolved", targetPath: null,
            unresolvedReason: target.unresolvedReason, candidatePaths: target.candidatePaths ?? [] };
    }
    const target = resolveLocalImport(relativePath, fact.specifier, sourcePathSet, {
      languageKey: fact.languageKey
    });
    if (!target.resolved) {
      return {
        ...fact,
        external: target.external,
        resolutionState: "unresolved",
        targetPath: null,
        unresolvedReason: target.unresolvedReason,
        candidatePaths: target.candidatePaths ?? []
      };
    }
    return {
      ...fact,
      external: target.external,
      resolutionState: "resolved",
      targetPath: target.targetPath,
      moduleKey: target.moduleKey,
      resolutionBasis: target.resolutionBasis
    };
  });
}

export function importFactResolutionDependencies({ facts, relativePath, sourcePathSet, goModules = [],
  rustCrates = [] }) {
  const dependencies = [];
  for (const fact of facts) {
    if (fact.languageKey === "rust" && !fact.dynamic && fact.specifier) {
      for (const dependency of resolveRustImportFact({ fact, relativePath, sourcePathSet, rustCrates })
        .dependencies) {
        dependencies.push({ candidate_path: dependency.candidate_path,
          candidate_ordinal: dependencies.length, resolution_state: dependency.resolution_state });
      }
      continue;
    }
    if (fact.languageKey === "go" && !fact.dynamic && fact.specifier) {
      const target = resolveGoImport(fact.specifier, sourcePathSet, goModules);
      dependencies.push({ candidate_path: SIDECAR_GO_MODULE_SET_CANDIDATE,
        candidate_ordinal: dependencies.length, resolution_state: "present" });
      if (target.packageDir !== null) {
        dependencies.push({ candidate_path: directoryCandidate(target.packageDir),
          candidate_ordinal: dependencies.length, resolution_state: target.resolved ? "present" : "absent" });
      }
      continue;
    }
    if (fact.dynamic || !fact.specifier || !LOCAL_IMPORT_PREFIX.test(fact.specifier)) continue;
    const basePath = path.posix.normalize(
      path.posix.join(path.posix.dirname(relativePath), fact.specifier)
    );
    const candidates = localImportCandidates(basePath, fact.languageKey);
    const matched = candidates.filter((candidatePath) => sourcePathSet.has(candidatePath));
    for (const candidatePath of candidates) {
      dependencies.push({
        candidate_path: candidatePath,
        candidate_ordinal: dependencies.length,
        resolution_state: !sourcePathSet.has(candidatePath)
          ? "absent"
          : matched.length > 1 ? "ambiguous" : "present"
      });
    }
  }
  return dependencies;
}
