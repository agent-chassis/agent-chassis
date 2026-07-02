

import path from "node:path";
import { readFile } from "node:fs/promises";
import { realpath } from "node:fs/promises";

export const WORKSPACE_DECLARATION_RELATIVE_PATH = "wiki/.wiki-mcp.json";
export const WORKSPACE_DECLARATION_SCHEMA_VERSION = "wiki-mcp-workspace.v1";
const WORKSPACE_ALIAS_PATTERN = /^[A-Za-z0-9._-]+$/;

function declarationDiag(code, message, { path: fieldPath = null, severity = "error" } = {}) {
  return { code, severity, message, path: fieldPath };
}

async function tryRealpath(p) {
  try {
    return await realpath(p);
  } catch {
    return null;
  }
}

export async function readRepoLocalWorkspaceDeclaration(trustedRoot) {
  const canonicalTrustedRoot = (await tryRealpath(trustedRoot)) ?? trustedRoot;
  const declarationPath = path.join(canonicalTrustedRoot, WORKSPACE_DECLARATION_RELATIVE_PATH);

  let raw;
  try {
    raw = await readFile(declarationPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return { ok: false, not_found: true, diagnostics: [] };
    }
    return {
      ok: false,
      not_found: false,
      diagnostics: [
        declarationDiag(
          "declaration_unreadable",
          `Could not read ${WORKSPACE_DECLARATION_RELATIVE_PATH}: ${error.message}`
        )
      ]
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      not_found: false,
      diagnostics: [
        declarationDiag(
          "declaration_malformed_json",
          `${WORKSPACE_DECLARATION_RELATIVE_PATH} is not valid JSON: ${error.message}`
        )
      ]
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      not_found: false,
      diagnostics: [
        declarationDiag(
          "declaration_invalid_schema",
          `${WORKSPACE_DECLARATION_RELATIVE_PATH} must be a JSON object`
        )
      ]
    };
  }

  if (parsed.schema_version !== WORKSPACE_DECLARATION_SCHEMA_VERSION) {
    return {
      ok: false,
      not_found: false,
      diagnostics: [
        declarationDiag(
          "declaration_invalid_schema",
          `${WORKSPACE_DECLARATION_RELATIVE_PATH} schema_version must be "${WORKSPACE_DECLARATION_SCHEMA_VERSION}"; ` +
            `got ${JSON.stringify(parsed.schema_version)}`,
          { path: "schema_version" }
        )
      ]
    };
  }

  if (!parsed.current || typeof parsed.current !== "object" || Array.isArray(parsed.current)) {
    return {
      ok: false,
      not_found: false,
      diagnostics: [
        declarationDiag(
          "declaration_invalid_schema",
          `${WORKSPACE_DECLARATION_RELATIVE_PATH} must have a "current" object with "alias" and "root" fields`,
          { path: "current" }
        )
      ]
    };
  }

  const alias = parsed.current.alias;
  const root = parsed.current.root;
  const diagnostics = [];

  if (typeof alias !== "string" || !alias.trim() || !WORKSPACE_ALIAS_PATTERN.test(alias.trim())) {
    diagnostics.push(
      declarationDiag(
        "declaration_invalid_alias",
        `${WORKSPACE_DECLARATION_RELATIVE_PATH} current.alias must be a non-empty string matching [A-Za-z0-9._-]+`,
        { path: "current.alias" }
      )
    );
  }

  if (typeof root !== "string" || !root.trim()) {
    diagnostics.push(
      declarationDiag(
        "declaration_invalid_root",
        `${WORKSPACE_DECLARATION_RELATIVE_PATH} current.root must be a non-empty string`,
        { path: "current.root" }
      )
    );
  } else if (!path.isAbsolute(root.trim())) {
    diagnostics.push(
      declarationDiag(
        "declaration_invalid_root",
        `${WORKSPACE_DECLARATION_RELATIVE_PATH} current.root must be an absolute path`,
        { path: "current.root" }
      )
    );
  }

  if (diagnostics.length > 0) {
    return { ok: false, not_found: false, diagnostics };
  }

  const canonicalDeclaredRoot = await tryRealpath(root.trim());
  if (!canonicalDeclaredRoot) {
    return {
      ok: false,
      not_found: false,
      diagnostics: [
        declarationDiag(
          "declaration_path_resolution_failed",
          `${WORKSPACE_DECLARATION_RELATIVE_PATH} current.root could not be canonicalized (realpath failed): "${root.trim()}". ` +
            `The directory may not exist or may contain a broken symlink.`,
          { path: "current.root" }
        )
      ]
    };
  }

  if (canonicalDeclaredRoot !== canonicalTrustedRoot) {
    return {
      ok: false,
      not_found: false,
      diagnostics: [
        declarationDiag(
          "declaration_root_mismatch",
          `${WORKSPACE_DECLARATION_RELATIVE_PATH} current.root does not match the trusted workspace root. ` +
            `Declaration says "${canonicalDeclaredRoot}", trusted root is "${canonicalTrustedRoot}". ` +
            `The declaration may be for a different checkout. ` +
            `Set WIKI_MCP_WORKSPACE_ALIAS to override with an explicit alias.`,
          { path: "current.root" }
        )
      ]
    };
  }

  const linkedRepos = [];
  if (parsed.linked_repos !== undefined && parsed.linked_repos !== null) {
    if (typeof parsed.linked_repos !== "object" || Array.isArray(parsed.linked_repos)) {
      return {
        ok: false,
        not_found: false,
        diagnostics: [
          declarationDiag(
            "declaration_invalid_linked_repos",
            `${WORKSPACE_DECLARATION_RELATIVE_PATH} linked_repos must be a JSON object`,
            { path: "linked_repos" }
          )
        ]
      };
    }

    const seenAliases = new Set([alias.trim()]);
    const seenRoots = new Set([canonicalDeclaredRoot]);

    for (const [linkedAlias, linkedEntry] of Object.entries(parsed.linked_repos)) {
      if (!WORKSPACE_ALIAS_PATTERN.test(linkedAlias)) {
        diagnostics.push(
          declarationDiag(
            "declaration_invalid_alias",
            `${WORKSPACE_DECLARATION_RELATIVE_PATH} linked_repos key must match [A-Za-z0-9._-]+: "${linkedAlias}"`,
            { path: `linked_repos.${linkedAlias}` }
          )
        );
        continue;
      }
      if (seenAliases.has(linkedAlias)) {
        diagnostics.push(
          declarationDiag(
            "declaration_alias_conflict",
            `${WORKSPACE_DECLARATION_RELATIVE_PATH} duplicate alias "${linkedAlias}" conflicts with ` +
              `the current alias or an earlier linked entry`,
            { path: `linked_repos.${linkedAlias}` }
          )
        );
        continue;
      }
      if (!linkedEntry || typeof linkedEntry !== "object" || Array.isArray(linkedEntry)) {
        diagnostics.push(
          declarationDiag(
            "declaration_invalid_linked_entry",
            `${WORKSPACE_DECLARATION_RELATIVE_PATH} linked_repos.${linkedAlias} must be an object with a "root" field`,
            { path: `linked_repos.${linkedAlias}` }
          )
        );
        continue;
      }

      const linkedRoot = linkedEntry.root;
      if (typeof linkedRoot !== "string" || !linkedRoot.trim() || !path.isAbsolute(linkedRoot.trim())) {
        diagnostics.push(
          declarationDiag(
            "declaration_invalid_root",
            `${WORKSPACE_DECLARATION_RELATIVE_PATH} linked_repos.${linkedAlias}.root must be an absolute path`,
            { path: `linked_repos.${linkedAlias}.root` }
          )
        );
        continue;
      }

      const canonicalLinkedRoot = await tryRealpath(linkedRoot.trim());
      if (!canonicalLinkedRoot) {
        diagnostics.push(
          declarationDiag(
            "declaration_path_resolution_failed",
            `${WORKSPACE_DECLARATION_RELATIVE_PATH} linked_repos.${linkedAlias}.root could not be canonicalized: "${linkedRoot.trim()}"`,
            { path: `linked_repos.${linkedAlias}.root` }
          )
        );
        continue;
      }
      if (seenRoots.has(canonicalLinkedRoot)) {
        diagnostics.push(
          declarationDiag(
            "declaration_duplicate_root",
            `${WORKSPACE_DECLARATION_RELATIVE_PATH} linked_repos.${linkedAlias}.root resolves to ` +
              `a duplicate directory: "${canonicalLinkedRoot}"`,
            { path: `linked_repos.${linkedAlias}.root` }
          )
        );
        continue;
      }

      seenAliases.add(linkedAlias);
      seenRoots.add(canonicalLinkedRoot);
      linkedRepos.push({
        alias: linkedAlias,
        root: canonicalLinkedRoot,
        profile: typeof linkedEntry.profile === "string" ? linkedEntry.profile : null
      });
    }

    if (diagnostics.length > 0) {
      return { ok: false, not_found: false, diagnostics };
    }
  }

  return {
    ok: true,
    declaration: {
      schema_version: WORKSPACE_DECLARATION_SCHEMA_VERSION,
      alias: alias.trim(),
      root: canonicalDeclaredRoot,
      profile: typeof parsed.profile === "string" ? parsed.profile : null,
      tool_profile: typeof parsed.tool_profile === "string" ? parsed.tool_profile : null,
      linked_repos: linkedRepos
    }
  };
}
