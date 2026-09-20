import path from "node:path";

const COMMITTED_PATH_INFERENCE = "committed_path_inference";

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === "string" && value))];
}

function pathStem(relativePath) {
  const basename = path.posix.basename(relativePath);
  return basename.replace(/(?:\.test|\.spec)?\.[^.]+$/, "");
}

function defaultTestCandidates(relativePath) {
  const parsed = relativePath.match(/^(?<dir>.*\/)?(?<base>[^/.]+)\.[^.]+$/);
  if (!parsed?.groups?.base) {
    return [];
  }
  const directory = parsed.groups.dir || "";
  const basename = parsed.groups.base;
  return uniqueStrings([
    `${directory}${basename}.test.mjs`,
    `${directory}${basename}.test.js`,
    `${directory}${basename}.spec.mjs`,
    `${directory}${basename}.spec.js`,
    `tests/${basename}.test.mjs`,
    `tests/${basename}.test.js`
  ]);
}

function inferLikelyTests(inputPath, sourcePaths) {
  const candidates = new Set(defaultTestCandidates(inputPath));
  const stem = pathStem(inputPath);
  for (const sourcePath of sourcePaths) {
    const basename = path.posix.basename(sourcePath);
    if (
      sourcePath !== inputPath &&
      (sourcePath.startsWith("tests/") || /\.test\.|\.spec\./.test(basename)) &&
      pathStem(sourcePath) === stem
    ) {
      candidates.add(sourcePath);
    }
  }
  return [...candidates].filter((candidate) => sourcePaths.includes(candidate));
}

function inferRelatedCodePaths(inputPath, sourcePaths, likelyTests) {
  const inputDirectory = path.posix.dirname(inputPath);
  const likelyTestSet = new Set(likelyTests);
  return sourcePaths
    .filter((candidate) => candidate !== inputPath)
    .filter((candidate) => !likelyTestSet.has(candidate))
    .filter((candidate) => path.posix.dirname(candidate) === inputDirectory)
    .sort((left, right) => left.localeCompare(right));
}

function attributePaths(byPath, paths, inputPath) {
  for (const inferredPath of paths) {
    const existing = byPath.get(inferredPath);
    if (existing) {
      existing.input_paths.push(inputPath);
      continue;
    }
    byPath.set(inferredPath, {
      path: inferredPath,
      input_paths: [inputPath],
      evidence_basis: COMMITTED_PATH_INFERENCE
    });
  }
}

export function deriveSidecarPathContext({ inputPaths = [], sourcePaths = [] } = {}) {
  const inputs = uniqueStrings(inputPaths);
  const sources = uniqueStrings(sourcePaths);
  const inferredTestsByPath = new Map();
  const relatedPathsByPath = new Map();

  for (const inputPath of inputs) {
    const inferredTests = inferLikelyTests(inputPath, sources);
    attributePaths(inferredTestsByPath, inferredTests, inputPath);
    attributePaths(
      relatedPathsByPath,
      inferRelatedCodePaths(inputPath, sources, inferredTests),
      inputPath
    );
  }

  return {
    inferred_tests: [...inferredTestsByPath.values()],
    related_paths: [...relatedPathsByPath.values()]
  };
}
