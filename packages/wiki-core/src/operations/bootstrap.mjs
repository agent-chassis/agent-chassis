import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ensureAdoptionInitiative,
  ensureAllocatorState,
  ensureCatalog,
  ensureCoreSurfaces,
  pathExists,
  syncCoreFiles,
  syncTemplates,
  writeContractMetadata
} from "../lib/wiki.mjs";
import {
  ensureAdoptionDoc,
  ensureAdoptionWorkRecords,
  ensureAgentsBoilerplateTemplate,
  ensureWikiMcpDeclaration,
  AGENTS_BOILERPLATE_SEEDED_RELATIVE_PATH,
  WIKI_MCP_DECLARATION_RELATIVE_PATH
} from "../lib/wiki-scaffold.mjs";
import { ensureLexicalSearchIndex } from "../lib/search.mjs";
import { SIDECAR_DEFAULT_CACHE_DIR } from "../lib/sidecar-status.mjs";
import { generateViews } from "./generate.mjs";

const BOOTSTRAP_SEARCH_CACHE_DIR = ".cache/wiki-search";

const BOOTSTRAP_GITIGNORE_ENTRIES = [
  `${SIDECAR_DEFAULT_CACHE_DIR}/`,
  `${BOOTSTRAP_SEARCH_CACHE_DIR}/`,

  WIKI_MCP_DECLARATION_RELATIVE_PATH
];

function isEntryAlreadyCovered(lines, entry) {
  const bareEntry = entry.replace(/\/$/, "");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const bareLine = line.replace(/\/$/, "");

    if (bareLine === bareEntry) {
      return true;
    }

    if (bareEntry.startsWith(`${bareLine}/`)) {
      return true;
    }
  }
  return false;
}

async function ensureGitignoreEntries(gitignorePath, entries) {
  let existing = "";
  if (await pathExists(gitignorePath)) {
    existing = await readFile(gitignorePath, "utf8");
  }

  const lines = existing.split("\n");
  const toAdd = entries.filter((entry) => !isEntryAlreadyCovered(lines, entry));

  if (toAdd.length === 0) {
    return { updated: false, added: [] };
  }

  const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  await writeFile(gitignorePath, `${existing}${sep}${toAdd.join("\n")}\n`, "utf8");
  return { updated: true, added: toAdd };
}

async function bootstrapCacheAndIgnores(targetDir, { profile, extensionNamespaces } = {}) {

  try {
    await mkdir(path.join(targetDir, BOOTSTRAP_SEARCH_CACHE_DIR), { recursive: true });
    await mkdir(path.join(targetDir, SIDECAR_DEFAULT_CACHE_DIR), { recursive: true });
  } catch (error) {
    throw new Error(
      `bootstrap: failed to create cache directories under ${targetDir}: ${error.message}. ` +
        `Ensure the target directory is writable.`
    );
  }

  const gitignorePath = path.join(targetDir, ".gitignore");
  let gitignoreResult;
  try {
    gitignoreResult = await ensureGitignoreEntries(gitignorePath, BOOTSTRAP_GITIGNORE_ENTRIES);
  } catch (error) {
    throw new Error(
      `bootstrap: failed to update .gitignore at ${gitignorePath}: ${error.message}. ` +
        `Ensure the file is writable.`
    );
  }

  let searchResult;
  try {
    searchResult = await ensureLexicalSearchIndex(targetDir, { profile, extensionNamespaces });
  } catch (error) {
    const indexPath = path.join(targetDir, BOOTSTRAP_SEARCH_CACHE_DIR, "index.json");
    throw new Error(
      `bootstrap: failed to create search index at ${indexPath}: ${error.message}. ` +
        `Run 'npm run wiki -- build-search-index --dir <repo>' to retry.`
    );
  }

  return {
    searchCacheDir: BOOTSTRAP_SEARCH_CACHE_DIR,
    codeIndexCacheDir: SIDECAR_DEFAULT_CACHE_DIR,
    gitignore: {
      path: ".gitignore",
      updated: gitignoreResult.updated,
      added: gitignoreResult.added
    },
    searchIndex: {
      indexPath: searchResult.indexPath,
      rebuilt: searchResult.rebuilt,
      indexState: searchResult.indexState,
      chunkCount: searchResult.index.chunkCount
    }
  };
}

export async function bootstrapRepo({
  dir = ".",
  repo,
  profile = "standard",
  extensionNamespaces = []
}) {
  const targetDir = path.resolve(String(dir));

  const resolvedRepo = repo || path.basename(targetDir);
  if (!resolvedRepo) {
    throw new Error(
      "bootstrapRepo requires repo, or a target directory with a usable basename"
    );
  }

  const { created: surfaces, manifest, extensionNamespaces: extensions } =
    await ensureCoreSurfaces(targetDir, { profile, extensionNamespaces });
  const coreFiles = await syncCoreFiles(targetDir, {
    repo: resolvedRepo,
    profile,
    extensionNamespaces: extensions
  });
  const catalog = await ensureCatalog(targetDir, resolvedRepo);
  const sync = await syncTemplates(targetDir);

  const agentsBoilerplate = await ensureAgentsBoilerplateTemplate(targetDir);

  const adoptionDoc = await ensureAdoptionDoc(targetDir, { repo: resolvedRepo });

  const {
    getStaticIn0001AdoptionSeed,
    getStaticIn0001AdoptionSeedWorkRecords,
    renderStaticIn0001AdoptionSeedMarkdown
  } = await import("../index.mjs");
  const adoptionSeed = getStaticIn0001AdoptionSeed();
  const adoption = await ensureAdoptionInitiative(targetDir, {
    seed: adoptionSeed,
    body: renderStaticIn0001AdoptionSeedMarkdown(adoptionSeed)
  });

  const adoptionWorkRecords = await ensureAdoptionWorkRecords(targetDir, {
    records: getStaticIn0001AdoptionSeedWorkRecords(adoptionSeed),
    repo: resolvedRepo
  });

  const wikiMcpDeclaration = await ensureWikiMcpDeclaration(targetDir, {
    repo: resolvedRepo
  });

  const agentsPresent = await pathExists(path.join(targetDir, "AGENTS.md"));

  const allocatorState = await ensureAllocatorState(targetDir, manifest);
  const contractMetadata = await writeContractMetadata(targetDir, manifest, {
    repo: resolvedRepo,
    profile,
    extensionNamespaces: extensions
  });

  const generated = await generateViews({
    dir: targetDir,
    profile: contractMetadata.metadata.profile,
    extensionNamespaces: contractMetadata.metadata.extensionNamespaces
  });

  const cacheAndIgnores = await bootstrapCacheAndIgnores(targetDir, {
    profile: contractMetadata.metadata.profile,
    extensionNamespaces: contractMetadata.metadata.extensionNamespaces
  });

  return {
    targetDir,
    repo: resolvedRepo,
    profile: contractMetadata.metadata.profile,
    extensionNamespaces: contractMetadata.metadata.extensionNamespaces,
    contractVersion: manifest.contractVersion,
    surfaces,
    coreFiles: coreFiles.files,
    catalog,
    templates: sync.copied,
    agentsBoilerplateTemplate: {
      path: agentsBoilerplate.relativePath,
      state: agentsBoilerplate.state
    },
    adoptionDoc: {
      path: adoptionDoc.relativePath,
      state: adoptionDoc.state
    },
    allocatorState,
    metadataPath: contractMetadata.metadataPath,
    metadata: contractMetadata.metadata,
    adoptionInitiative: {
      recordId: adoption.recordId,
      path: adoption.relativePath,
      created: adoption.created,
      kept: adoption.kept,
      requiredChecks: adoptionSeed.required_checks,
      ownedWork: adoptionSeed.owned_work.map((work) => work.key)
    },
    adoptionWorkRecords: {
      created: adoptionWorkRecords.created,
      kept: adoptionWorkRecords.kept,
      createdCount: adoptionWorkRecords.created.length,
      keptCount: adoptionWorkRecords.kept.length
    },
    wikiMcpDeclaration: {
      path: wikiMcpDeclaration.relativePath,
      schemaVersion: wikiMcpDeclaration.schemaVersion,
      alias: wikiMcpDeclaration.alias,
      root: wikiMcpDeclaration.root,
      state: wikiMcpDeclaration.state,
      malformed: wikiMcpDeclaration.malformed,
      malformedReason: wikiMcpDeclaration.malformedReason,
      preservedAlias: wikiMcpDeclaration.preservedAlias
    },
    generatedViews: {
      generated: generated.generatedViews,
      outputPaths: generated.outputPaths
    },
    agentsNextStep: {
      agentsPresent,

      boilerplateSource: AGENTS_BOILERPLATE_SEEDED_RELATIVE_PATH
    },
    cacheAndIgnores
  };
}
