import { readFile, stat } from "node:fs/promises";
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

    for (const message of validateContractMetadataShape(rawMetadata || metadata, manifest, profile)) {
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

export async function lintExecutableArtifacts({ targetDir, addFinding }) {
  for (const tree of ["docs", "wiki"]) {
    const treePath = path.join(targetDir, tree);
    if (!(await pathExists(treePath))) {
      continue;
    }
    for await (const filePath of walkFilesUnder(treePath)) {
      const relPath = path.relative(targetDir, filePath).replaceAll(path.sep, "/");
      const ext = path.extname(filePath).toLowerCase();
      const basename = path.basename(filePath);
      const isPlaceholderFilename = ALLOWED_DOC_PLACEHOLDER_FILENAMES.has(basename);

      if (!isPlaceholderFilename && !ALLOWED_DOC_SUFFIXES.has(ext)) {
        const extLabel = ext.length > 0 ? `'${ext}'` : "(no extension)";
        addFinding("error", `${relPath}: suffix ${extLabel} is not allowed under ${tree}/; allowed suffixes: .md .json .txt .yml .yaml .csv`, {
          code: "executable_artifact_disallowed_suffix",
          path: relPath
        });
      }

      let fileStat = null;
      try {
        fileStat = await stat(filePath);
      } catch {

      }
      if (fileStat && (fileStat.mode & 0o111) !== 0) {
        addFinding("error", `${relPath}: file has executable mode bit set under ${tree}/`, {
          code: "executable_artifact_mode_bit",
          path: relPath
        });
      }

      try {
        const raw = await readFile(filePath);
        if (raw.length >= 2 && raw[0] === 0x23 && raw[1] === 0x21) {
          addFinding("error", `${relPath}: file begins with shebang (#!) at byte zero under ${tree}/`, {
            code: "executable_artifact_shebang",
            path: relPath
          });
        }
      } catch {

      }
    }
  }
}

export async function lintGeneratedViews({
  targetDir,
  profile,
  resolvedExtensionNamespaces,
  addFinding
}) {
  const generated = await buildGeneratedViews({
    dir: targetDir,
    profile,
    extensionNamespaces: resolvedExtensionNamespaces
  });
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
