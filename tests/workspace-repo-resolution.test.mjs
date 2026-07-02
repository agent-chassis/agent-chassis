import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

import {
  resolveWorkspaceRepo,
  parseWorkspaceRepos
} from "../packages/wiki-mcp/src/lib/workspace-repo-resolution.mjs";
import {
  WORKSPACE_DECLARATION_RELATIVE_PATH,
  WORKSPACE_DECLARATION_SCHEMA_VERSION
} from "../packages/wiki-mcp/src/lib/workspace-config.mjs";

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wiki-wk0536-resolution-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeDeclaration(rootDir, declaration) {
  const declarationPath = path.join(rootDir, WORKSPACE_DECLARATION_RELATIVE_PATH);
  await mkdir(path.dirname(declarationPath), { recursive: true });
  await writeFile(declarationPath, declaration, "utf8");
}

async function writeDeclarationObject(rootDir, declaration) {
  await writeDeclaration(rootDir, JSON.stringify(declaration, null, 2));
}

function workspaceDeclaration(rootDir, alias, extra = {}) {
  return {
    schema_version: WORKSPACE_DECLARATION_SCHEMA_VERSION,
    current: { alias, root: rootDir },
    ...extra
  };
}

async function captureError(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }

  assert.fail("expected the operation to fail");
}

test("parseWorkspaceRepos derives the current alias from wiki/.wiki-mcp.json", async () => {
  await withTempDir(async (rootDir) => {
    await writeDeclarationObject(
      rootDir,
      workspaceDeclaration(rootDir, "repo-local")
    );

    const workspaces = await parseWorkspaceRepos({
      WIKI_MCP_WORKSPACE_DIR: rootDir
    });

    assert.equal(workspaces.currentAlias, "repo-local");
    assert.equal(workspaces.repos.get("repo-local"), rootDir);

    const resolved = resolveWorkspaceRepo(workspaces);
    assert.deepEqual(resolved, { repo: "repo-local", dir: rootDir });
  });
});

test("parseWorkspaceRepos prefers an explicit workspace alias over a malformed declaration", async () => {
  await withTempDir(async (rootDir) => {
    await writeDeclaration(rootDir, "{ not valid json");

    const workspaces = await parseWorkspaceRepos({
      WIKI_MCP_WORKSPACE_DIR: rootDir,
      WIKI_MCP_WORKSPACE_ALIAS: "explicit-alias"
    });

    assert.equal(workspaces.currentAlias, "explicit-alias");
    assert.equal(workspaces.repos.get("explicit-alias"), rootDir);
  });
});

test("parseWorkspaceRepos refuses a malformed repo-local declaration when no explicit alias is provided", async () => {
  await withTempDir(async (rootDir) => {
    await writeDeclaration(rootDir, "{ not valid json");

    const error = await captureError(() =>
      parseWorkspaceRepos({ WIKI_MCP_WORKSPACE_DIR: rootDir })
    );

    assert.equal(error.schema_version, "workspace-repo-resolution.v1");
    assert.equal(error.envelope.refusal.category, "not_in_repo");
    assert.equal(error.envelope.refusal.reason, "wrong_session");
    assert.equal(
      error.envelope.refusal.detail.diagnostics[0].code,
      "declaration_malformed_json"
    );
  });
});

test("parseWorkspaceRepos refuses alias collisions between env repos and declaration-linked repos", async () => {
  await withTempDir(async (currentDir) => {
    await withTempDir(async (linkedDir) => {
      await writeDeclarationObject(
        currentDir,
        workspaceDeclaration(currentDir, "current-repo", {
          linked_repos: {
            "shared-alias": { root: linkedDir }
          }
        })
      );
      await writeDeclarationObject(
        linkedDir,
        workspaceDeclaration(linkedDir, "shared-alias")
      );

      const error = await captureError(() =>
        parseWorkspaceRepos({
          WIKI_MCP_WORKSPACE_DIR: currentDir,
          WIKI_MCP_REPOS: JSON.stringify({
            "shared-alias": currentDir
          })
        })
      );

      assert.equal(error.envelope.refusal.category, "invalid_request");
      assert.equal(error.envelope.refusal.reason, "conflict");
      assert.ok(
        ["workspace_repo_alias_collision", "workspace_repo_duplicate_root"].includes(
          error.envelope.refusal.detail.diagnostics[0].code
        ),
        `unexpected collision code: ${error.envelope.refusal.detail.diagnostics[0].code}`
      );
    });
  });
});

test("parseWorkspaceRepos refuses duplicate workspace roots", async () => {
  await withTempDir(async (rootDir) => {
    const error = await captureError(() =>
      parseWorkspaceRepos({
        WIKI_MCP_REPOS: JSON.stringify({
          alpha: rootDir,
          beta: rootDir
        })
      })
    );

    assert.equal(error.envelope.refusal.category, "invalid_request");
    assert.equal(error.envelope.refusal.reason, "conflict");
    assert.equal(
      error.envelope.refusal.detail.diagnostics[0].code,
      "workspace_repo_duplicate_root"
    );
  });
});

test("WK-0748 aliasless WIKI_MCP_WORKSPACE_DIR with no declaration falls back to basename alias", async () => {
  await withTempDir(async (rootDir) => {
    const workspaces = await parseWorkspaceRepos({
      WIKI_MCP_WORKSPACE_DIR: rootDir
    });

    const expectedAlias = path.basename(rootDir);
    assert.equal(workspaces.currentAlias, expectedAlias);
    assert.equal(workspaces.repos.get(expectedAlias), rootDir);

    const resolved = resolveWorkspaceRepo(workspaces);
    assert.deepEqual(resolved, { repo: expectedAlias, dir: rootDir });
  });
});

test("WK-0748 malformed WIKI_MCP_REPOS fails closed even when WIKI_MCP_WORKSPACE_DIR is valid", async () => {
  await withTempDir(async (rootDir) => {
    const error = await captureError(() =>
      parseWorkspaceRepos({
        WIKI_MCP_WORKSPACE_DIR: rootDir,
        WIKI_MCP_REPOS: "{ not valid json"
      })
    );

    assert.equal(error.schema_version, "workspace-repo-resolution.v1");
    assert.match(error.message, /WIKI_MCP_REPOS must be a JSON object/);
  });
});

test("WK-0748 basename-derived alias with invalid characters fails closed with structured diagnostic", async () => {
  const invalidDir = path.join(os.tmpdir(), "WK-0748 invalid basename test");
  const error = await captureError(() =>
    parseWorkspaceRepos({ WIKI_MCP_WORKSPACE_DIR: invalidDir })
  );

  assert.equal(error.schema_version, "workspace-repo-resolution.v1");
  assert.equal(error.envelope.refusal.category, "not_in_repo");
  assert.equal(
    error.envelope.refusal.detail.diagnostics[0].code,
    "workspace_repo_invalid_derived_alias"
  );
});

test("WK-0748 schema-invalid wiki/.wiki-mcp.json fails closed and does not fall through to basename derivation", async () => {
  await withTempDir(async (rootDir) => {

    await writeDeclarationObject(rootDir, {
      schema_version: "wrong-schema-version",
      current: { alias: "test-repo", root: rootDir }
    });

    const error = await captureError(() =>
      parseWorkspaceRepos({ WIKI_MCP_WORKSPACE_DIR: rootDir })
    );

    assert.equal(error.schema_version, "workspace-repo-resolution.v1");
    assert.equal(error.envelope.refusal.category, "not_in_repo");
    assert.equal(
      error.envelope.refusal.detail.diagnostics[0].code,
      "declaration_invalid_schema"
    );

    assert.equal(error.envelope.refusal.detail.current_workspace_repo, null);
    assert.equal(error.envelope.refusal.detail.configured_workspace_repos.length, 0);
  });
});

test("WK-0748 basename-derived alias collision with WIKI_MCP_REPOS entry fails closed", async () => {
  await withTempDir(async (rootDir) => {
    const basename = path.basename(rootDir);
    await withTempDir(async (otherDir) => {
      const error = await captureError(() =>
        parseWorkspaceRepos({
          WIKI_MCP_WORKSPACE_DIR: rootDir,
          WIKI_MCP_REPOS: JSON.stringify({ [basename]: otherDir })
        })
      );

      assert.equal(error.envelope.refusal.category, "invalid_request");
      assert.equal(error.envelope.refusal.reason, "conflict");
    });
  });
});
