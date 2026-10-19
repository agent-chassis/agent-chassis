import { lstat, open, readFile } from "node:fs/promises";
import path from "node:path";
import { buildGeneratedViews } from "./generate.mjs";
import { scanInternalLeaks } from "./generate-area-readme-projection.mjs";
import {
  buildExpectedMetadata,
  compareContractMetadata,
  pathExists,
  validateContractMetadataShape
} from "../lib/wiki.mjs";
import { walkFilesUnder } from "./lint-shared.mjs";

const ALLOWED_DOC_SUFFIXES = new Set([
  ".md", ".json", ".txt", ".yml", ".yaml", ".csv"
]);

const ALLOWED_DOC_PLACEHOLDER_FILENAMES = new Set([".gitkeep", ".keep"]);

export async function lintRepoContract({
  targetDir,
  manifest,
  rawMetadata,
  metadata,
  profile,
  resolvedExtensionNamespaces,
  requestedProfile,
  extensionNamespaces,
  addFinding
}) {
  let allocatorState = null;
  let allocatorStateValid = false;

  const profileConfig = manifest.profiles[profile];
  const docsPath = path.join(
    targetDir,
    profileConfig.durableKnowledgeLayer.path.replace(/\/$/, "")
  );
  if (profileConfig.durableKnowledgeLayer.required && !(await pathExists(docsPath))) {
    addFinding(
      "error",
      `Missing required durable knowledge layer for profile '${profile}': ${profileConfig.durableKnowledgeLayer.path}`,
      { code: "missing_durable_knowledge_layer", path: profileConfig.durableKnowledgeLayer.path }
    );
  }

  for (const relativePath of manifest.coreFiles) {
    if (!(await pathExists(path.join(targetDir, relativePath)))) {
      addFinding("error", `Missing core contract file: ${relativePath}`, {
        code: "missing_core_file",
        path: relativePath
      });
    }
  }

  for (const relativePath of manifest.requiredSurfaces) {
    if (!(await pathExists(path.join(targetDir, relativePath)))) {
      addFinding("error", `Missing required surface: ${relativePath}/`, {
        code: "missing_surface",
        path: relativePath
      });
    }
  }

  const allocatorStatePath = path.join(targetDir, "wiki", ".id-state.json");
  if (!(await pathExists(allocatorStatePath))) {
    if (metadata) {
      addFinding("error", `Missing runtime contract file: ${allocatorStatePath}`, {
        code: "missing_allocator_state",
        path: "wiki/.id-state.json"
      });
    } else if (requestedProfile || extensionNamespaces !== null) {
      addFinding(
        "warning",
        "Missing runtime contract file: wiki/.id-state.json (bootstrap or sync-contract will create it)",
        { code: "missing_allocator_state", path: "wiki/.id-state.json" }
      );
    }
  } else {
    try {
      allocatorState = JSON.parse(await readFile(allocatorStatePath, "utf8"));
      allocatorStateValid = true;
    } catch {
      addFinding("error", `Allocator state is not valid JSON: ${allocatorStatePath}`, {
        code: "invalid_allocator_state",
        path: "wiki/.id-state.json"
      });
    }
  }

  if (!metadata) {
    if (requestedProfile || extensionNamespaces !== null) {
      addFinding(
        "warning",
        "Missing local contract metadata: wiki/.wiki-contract.json (first-run lint can proceed with explicit profile/extensions, but sync-contract should enroll the repo)",
        { code: "missing_contract_metadata", path: "wiki/.wiki-contract.json" }
      );
    } else {
      addFinding(
        "error",
        "Missing local contract metadata: wiki/.wiki-contract.json (run bootstrap or sync-contract, or pass --profile/--extensions for first-run linting)",
        { code: "missing_contract_metadata", path: "wiki/.wiki-contract.json" }
      );
    }
  } else {
    const expectedMetadata = buildExpectedMetadata(manifest, {
      repo: metadata.repo,
      profile,
      extensionNamespaces: resolvedExtensionNamespaces
    });
    for (const message of compareContractMetadata(metadata, expectedMetadata)) {
      addFinding("error", message, {
        code: "contract_metadata_mismatch",
        path: "wiki/.wiki-contract.json"
      });
    }

    for (const message of validateContractMetadataShape(rawMetadata || metadata, manifest, profile,
      { includeArtifactLint: false })) {
      addFinding("error", message, {
        code: "invalid_contract_metadata",
        path: "wiki/.wiki-contract.json"
      });
    }
  }

  for (const namespace of resolvedExtensionNamespaces) {
    if (!(await pathExists(path.join(targetDir, "wiki", namespace)))) {
      addFinding("error", `Missing declared extension namespace: wiki/${namespace}/`, {
        code: "missing_extension_namespace",
        path: `wiki/${namespace}`
      });
    }
  }

  return { allocatorState, allocatorStateValid };
}

async function readFirstTwoBytes(filePath) {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(2);
    const { bytesRead } = await handle.read(buffer, 0, 2, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function lintExecutableArtifacts({
  targetDir,
  scope,
  addFinding,
  getCanonicalPrefix = null,
  instrumentation = null,
  readPrefix = readFirstTwoBytes,
  inspectPath = lstat,
  readDirectory
}) {
  if (!scope || !scope.ok) {
    for (const diagnostic of scope?.diagnostics ?? [{ code: "artifact-scope-invalid",
      path: "wiki/.wiki-contract.json", message: "Artifact scope was not resolved; artifact checks were not evaluated; all artifact scope remains unverified. Runtime maintainer: supply the resolved contract context and rerun lint." }]) {
      addFinding("error", diagnostic.message, diagnostic);
    }
    return;
  }
  const relative = file => path.relative(targetDir, file).split(path.sep).join("/");
  const reportedFailures = new Set();
  const reportFailure = (code, file, error) => {
    const relPath = relative(file);
    const identity = `${code}:${relPath}`;
    if (reportedFailures.has(identity)) return;
    reportedFailures.add(identity);
    addFinding("error", `${relPath}: ${error.message}; artifact checks for this path/subtree could not complete; independent selected paths continue. Repository maintainer: repair the path kind, permissions or I/O cause, replace symbolic links with regular content, and rerun lint.`, {
      code, path: relPath, cause: error.message, cause_code: error.code ?? null,
      effects: "no artifact content changed; independent selected paths continue",
      unverified_scope: relPath,
      recovery: { actor: "repository maintainer", action: "repair the path kind, permissions or I/O cause; replace symbolic links with regular content; rerun lint" }
    });
  };

  const inspectSelection = async (selected, directory) => {
    const parts = selected.replace(/\/$/u, "").split("/");
    let current = targetDir;
    for (let index = 0; index < parts.length; index++) {
      current = path.join(current, parts[index]);
      let info;
      try { info = await inspectPath(current); }
      catch (error) {
        if (error.code !== "ENOENT") reportFailure("artifact-read-failed", current, error);
        return null;
      }
      if (info.isSymbolicLink()) {
        reportFailure("artifact-path-symlink", current, new Error("symbolic link is unsupported and was not followed"));
        return null;
      }
      const wantsDirectory = index < parts.length - 1 || directory;
      if (wantsDirectory ? !info.isDirectory() : !info.isFile()) {
        reportFailure("artifact-path-kind-invalid", current, new Error(wantsDirectory ? "expected directory" : "expected regular file"));
        return null;
      }
      if (index === parts.length - 1) return info;
    }
  };
  const checked = new Set();
  const checkFile = async (filePath, knownStat = null) => {
    if (checked.has(filePath)) return;
    checked.add(filePath);
    const relPath = relative(filePath);
    instrumentation?.artifactPathVisited?.(relPath);
    let info = knownStat;
    try { info ??= await inspectPath(filePath); }
    catch (error) { reportFailure("artifact-read-failed", filePath, error); return; }
    if (info.isSymbolicLink() || !info.isFile()) {
      reportFailure(info.isSymbolicLink() ? "artifact-path-symlink" : "artifact-path-kind-invalid", filePath,
        new Error(info.isSymbolicLink() ? "symbolic link is unsupported and was not followed" : "expected regular file"));
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    if (!ALLOWED_DOC_PLACEHOLDER_FILENAMES.has(path.basename(filePath)) && !ALLOWED_DOC_SUFFIXES.has(ext)) {
      const extLabel = ext.length > 0 ? `'${ext}'` : "(no extension)";
      addFinding("error", `${relPath}: suffix ${extLabel} is not allowed in selected artifact scope; allowed suffixes: .md .json .txt .yml .yaml .csv`, {
        code: "executable_artifact_disallowed_suffix", path: relPath
      });
    }
    if ((info.mode & 0o111) !== 0) {
      addFinding("error", `${relPath}: file has executable mode bit set in selected artifact scope`, {
        code: "executable_artifact_mode_bit", path: relPath
      });
    }
    try {
      const capturedPrefix = typeof getCanonicalPrefix === "function" ? getCanonicalPrefix(relPath) : null;
      const raw = capturedPrefix === null ? await readPrefix(filePath) : capturedPrefix;
      if (capturedPrefix === null) {
        instrumentation?.increment?.("shebang_prefix_bytes_read", raw.length);
        instrumentation?.artifactPrefixRead?.(relPath, raw.length);
      }
      if (raw.length >= 2 && raw[0] === 0x23 && raw[1] === 0x21) {
        addFinding("error", `${relPath}: file begins with shebang (#!) at byte zero in selected artifact scope`, {
          code: "executable_artifact_shebang", path: relPath
        });
      }
    } catch (error) { reportFailure("artifact-read-failed", filePath, error); }
  };
  for (const root of scope.roots) {
    if (!(await inspectSelection(root, true))) continue;
    for await (const file of walkFilesUnder(path.join(targetDir, root), { onFailure: reportFailure, readDirectory })) {
      await checkFile(file);
    }
  }
  for (const file of scope.files) {
    const info = await inspectSelection(file, false);
    if (info) await checkFile(path.join(targetDir, file), info);
  }
}

export async function lintGeneratedViews({
  targetDir,
  profile,
  resolvedExtensionNamespaces,
  addFinding,
  generatedBuild = null
}) {
  const generated = generatedBuild || (await buildGeneratedViews({
    dir: targetDir,
    profile,
    extensionNamespaces: resolvedExtensionNamespaces
  }));
  const areaReadmePaths = generated.areaReadmePaths || new Set();
  for (const [filePath, expectedContent] of generated.outputs) {
    const relativePath = path.relative(targetDir, filePath).replaceAll(path.sep, "/");
    let actualContent = null;
    try {
      actualContent = await readFile(filePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        addFinding(
          "warning",
          `${relativePath}: generated view is missing; run \`wiki generate\``,
          { code: "missing_generated_view", path: relativePath }
        );
        continue;
      }
      addFinding(
        "error",
        `${relativePath}: failed to read generated view: ${error.message}`,
        { code: "generated_view_read_failed", path: relativePath }
      );
      continue;
    }

    if (actualContent !== `${expectedContent.trimEnd()}\n`) {
      addFinding(
        "warning",
        `${relativePath}: generated view is stale; run \`wiki generate\``,
        { code: "stale_generated_view", path: relativePath }
      );
    }

    if (areaReadmePaths.has(filePath)) {
      for (const leak of scanInternalLeaks(actualContent)) {
        addFinding(
          "error",
          `${relativePath}:${leak.line}: shipped README leaks internal-only reference (${leak.kind}) '${leak.token}'`,
          { code: "package_readme_internal_leak", path: relativePath }
        );
      }
    }
  }
}
