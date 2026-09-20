import path from "node:path";

export const LOCAL_IMPORT_PREFIX = /^\.{1,2}\//;

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

export function resolveImportFacts({ facts, relativePath, sourcePathSet }) {
  return facts.map((fact) => {
    if (fact.dynamic || !fact.specifier) {
      return {
        ...fact,
        resolutionState: "dynamic",
        unresolvedReason: "non_literal_specifier"
      };
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

export function importFactResolutionDependencies({ facts, relativePath, sourcePathSet }) {
  const dependencies = [];
  for (const fact of facts) {
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
