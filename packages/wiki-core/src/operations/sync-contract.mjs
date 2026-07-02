import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  buildExpectedMetadata,
  compareContractMetadata,
  ensureAllocatorState,
  ensureCoreSurfaces,
  pathExists,
  readTemplate,
  resolveContractContext,
  syncCoreFiles,
  syncTemplates,
  validateContractMetadataShape,
  writeContractMetadata
} from "../lib/wiki.mjs";

export async function checkContractSync({
  dir = ".",
  repo = null,
  profile = null,
  extensionNamespaces = null
}) {
  const targetDir = path.resolve(String(dir));
  const context = await resolveContractContext(targetDir, {
    repo,
    profile,
    extensionNamespaces
  });
  const { manifest, metadata, rawMetadata } = context;
  const problems = [];

  for (const definition of Object.values(manifest.types)) {
    const expected = await readTemplate(definition.template);
    const localPath = path.join(targetDir, "wiki", "templates", definition.template);
    if (!(await pathExists(localPath))) {
      problems.push(`Missing synced template: ${localPath}`);
      continue;
    }

    const local = await readFile(localPath, "utf8");
    if (local !== expected) {
      problems.push(`Out-of-sync template: ${localPath}`);
    }
  }

  const expectedMetadata = buildExpectedMetadata(manifest, {
    repo: context.repo,
    profile: context.profile,
    extensionNamespaces: context.extensionNamespaces
  });
  problems.push(...compareContractMetadata(metadata, expectedMetadata));
  problems.push(...validateContractMetadataShape(rawMetadata || metadata, manifest, context.profile));

  for (const relativePath of manifest.coreFiles) {
    const absolutePath = path.join(targetDir, relativePath);
    if (!(await pathExists(absolutePath))) {
      problems.push(`Missing core contract file: ${absolutePath}`);
    }
  }

  for (const relativePath of manifest.runtimeFiles || []) {
    if (relativePath === "wiki/.wiki-contract.json") {
      continue;
    }
    const absolutePath = path.join(targetDir, relativePath);
    if (!(await pathExists(absolutePath))) {
      problems.push(`Missing runtime contract file: ${absolutePath}`);
    }
  }

  return {
    ok: problems.length === 0,
    targetDir,
    contractVersion: manifest.contractVersion,
    profile: context.profile,
    extensionNamespaces: context.extensionNamespaces,
    problems
  };
}

export async function syncContract({
  dir = ".",
  repo = null,
  profile = null,
  extensionNamespaces = null
}) {
  const targetDir = path.resolve(String(dir));
  const context = await resolveContractContext(targetDir, {
    repo,
    profile,
    extensionNamespaces
  });
  const resolvedRepo = repo || context.repo;
  if (!resolvedRepo) {
    throw new Error("syncContract requires repo when local metadata does not provide one");
  }

  await ensureCoreSurfaces(targetDir, {
    profile: context.profile,
    extensionNamespaces: context.extensionNamespaces
  });
  const coreFiles = await syncCoreFiles(targetDir, {
    repo: resolvedRepo,
    profile: context.profile,
    extensionNamespaces: context.extensionNamespaces
  });
  const { copied, manifest } = await syncTemplates(targetDir);
  const allocatorState = await ensureAllocatorState(targetDir, manifest);
  const contractMetadata = await writeContractMetadata(targetDir, manifest, {
    repo: resolvedRepo,
    profile: context.profile,
    extensionNamespaces: context.extensionNamespaces
  });

  return {
    targetDir,
    repo: resolvedRepo,
    profile: contractMetadata.metadata.profile,
    extensionNamespaces: contractMetadata.metadata.extensionNamespaces,
    contractVersion: manifest.contractVersion,
    coreFiles: coreFiles.files,
    createdCoreFiles: coreFiles.created,
    preservedCoreFiles: coreFiles.preserved,
    templates: copied,
    allocatorState,
    metadataPath: contractMetadata.metadataPath,
    metadata: contractMetadata.metadata
  };
}
