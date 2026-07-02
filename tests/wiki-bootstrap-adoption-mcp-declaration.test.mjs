import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { bootstrapRepo } from "../packages/wiki-core/src/index.mjs";

import {
  WIKI_MCP_DECLARATION_RELATIVE_PATH,
  WIKI_MCP_DECLARATION_SCHEMA_VERSION
} from "../packages/wiki-core/src/lib/wiki-scaffold.mjs";

import {
  readRepoLocalWorkspaceDeclaration,
  WORKSPACE_DECLARATION_RELATIVE_PATH,
  WORKSPACE_DECLARATION_SCHEMA_VERSION
} from "../packages/wiki-mcp/src/lib/workspace-config.mjs";
import { withTempDir } from "./wiki-bootstrap-adoption-helpers.mjs";

test("WK-0784 producer constants match the wiki-mcp reader constants (drift guard)", () => {

  assert.equal(
    WIKI_MCP_DECLARATION_RELATIVE_PATH,
    WORKSPACE_DECLARATION_RELATIVE_PATH,
    "producer relative path must equal the wiki-mcp reader's relative path"
  );
  assert.equal(
    WIKI_MCP_DECLARATION_SCHEMA_VERSION,
    WORKSPACE_DECLARATION_SCHEMA_VERSION,
    "producer schema_version must equal the wiki-mcp reader's schema_version"
  );
  assert.equal(WIKI_MCP_DECLARATION_RELATIVE_PATH, "wiki/.wiki-mcp.json");
  assert.equal(WIKI_MCP_DECLARATION_SCHEMA_VERSION, "wiki-mcp-workspace.v1");
});

test("WK-0784 fresh bootstrap writes a wiki-mcp declaration the reader accepts (round-trip)", async () => {
  await withTempDir(async (tempDir) => {
    const result = await bootstrapRepo({ dir: tempDir, repo: "test-org/test-repo" });

    assert.ok(result.wikiMcpDeclaration, "bootstrapRepo must report wikiMcpDeclaration");
    assert.equal(result.wikiMcpDeclaration.state, "created");
    assert.equal(result.wikiMcpDeclaration.malformed, false);
    assert.equal(result.wikiMcpDeclaration.path, "wiki/.wiki-mcp.json");

    const declPath = path.join(tempDir, WIKI_MCP_DECLARATION_RELATIVE_PATH);
    const decl = JSON.parse(await readFile(declPath, "utf8"));
    assert.equal(decl.schema_version, WORKSPACE_DECLARATION_SCHEMA_VERSION);
    assert.equal(typeof decl.current, "object");
    assert.equal(typeof decl.current.alias, "string");

    const resolvedDir = await realpath(tempDir);
    assert.ok(path.isAbsolute(decl.current.root), "current.root must be absolute");
    assert.equal(decl.current.root, resolvedDir, "current.root must equal the resolved target dir");

    assert.equal(decl.current.alias, "test-org-test-repo");
    assert.equal(result.wikiMcpDeclaration.alias, "test-org-test-repo");

    const read = await readRepoLocalWorkspaceDeclaration(tempDir);
    assert.equal(read.ok, true, `reader must accept the declaration; got ${JSON.stringify(read)}`);
    assert.equal(read.declaration.alias, "test-org-test-repo");
    assert.equal(read.declaration.root, resolvedDir);
  });
});

test("WK-0784 bootstrap ensures wiki/.wiki-mcp.json is ignored by the managed .gitignore", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "test-org/test-repo" });

    const content = await readFile(path.join(tempDir, ".gitignore"), "utf8");
    const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
    const bareEntry = WIKI_MCP_DECLARATION_RELATIVE_PATH.replace(/\/$/, "");
    const covered = lines.some((line) => {
      const bare = line.replace(/\/$/, "");
      return bare === bareEntry || bareEntry.startsWith(`${bare}/`);
    });
    assert.ok(
      covered,
      `.gitignore must cover '${WIKI_MCP_DECLARATION_RELATIVE_PATH}'; got: ${content}`
    );
  });
});

test("WK-0784 bootstrap rerun refreshes a stale current.root and preserves operator metadata (declaration)", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "test-org/test-repo" });

    const declPath = path.join(tempDir, WIKI_MCP_DECLARATION_RELATIVE_PATH);
    await writeFile(
      declPath,
      `${JSON.stringify(
        {
          schema_version: WIKI_MCP_DECLARATION_SCHEMA_VERSION,
          current: {
            alias: "operator-chosen-alias",
            root: "/nonexistent/old/checkout"
          },
          linked_repos: {},
          profile: "standard",
          tool_profile: "full",
          operator_note: "keep me"
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const result = await bootstrapRepo({ dir: tempDir, repo: "test-org/test-repo" });
    assert.equal(result.wikiMcpDeclaration.state, "refreshed");
    assert.equal(result.wikiMcpDeclaration.malformed, false);
    assert.equal(result.wikiMcpDeclaration.preservedAlias, true);

    const decl = JSON.parse(await readFile(declPath, "utf8"));

    assert.equal(decl.current.root, await realpath(tempDir));

    assert.equal(decl.current.alias, "operator-chosen-alias");

    assert.deepEqual(decl.linked_repos, {});
    assert.equal(decl.profile, "standard");
    assert.equal(decl.tool_profile, "full");
    assert.equal(decl.operator_note, "keep me");

    const read = await readRepoLocalWorkspaceDeclaration(tempDir);
    assert.equal(read.ok, true, `reader must accept the refreshed declaration; got ${JSON.stringify(read)}`);
    assert.equal(read.declaration.alias, "operator-chosen-alias");
  });
});

test("WK-0784 bootstrap rerun defaults the alias when no valid operator alias is present (declaration)", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "test-org/test-repo" });

    const declPath = path.join(tempDir, WIKI_MCP_DECLARATION_RELATIVE_PATH);

    await writeFile(
      declPath,
      `${JSON.stringify(
        {
          schema_version: WIKI_MCP_DECLARATION_SCHEMA_VERSION,
          current: { alias: "bad/alias", root: "/nonexistent/old" }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const result = await bootstrapRepo({ dir: tempDir, repo: "test-org/test-repo" });
    assert.equal(result.wikiMcpDeclaration.preservedAlias, false);
    assert.equal(result.wikiMcpDeclaration.alias, "test-org-test-repo");

    const decl = JSON.parse(await readFile(declPath, "utf8"));
    assert.equal(decl.current.alias, "test-org-test-repo");
    const read = await readRepoLocalWorkspaceDeclaration(tempDir);
    assert.equal(read.ok, true);
  });
});

test("WK-0795 bootstrap rerun replaces the reserved \"default\" alias with the sanitized repo name (declaration)", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "portfolio-wiki-dashboard" });

    const declPath = path.join(tempDir, WIKI_MCP_DECLARATION_RELATIVE_PATH);
    await writeFile(
      declPath,
      `${JSON.stringify(
        {
          schema_version: WIKI_MCP_DECLARATION_SCHEMA_VERSION,
          current: { alias: "default", root: "/nonexistent/old" }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const result = await bootstrapRepo({ dir: tempDir, repo: "portfolio-wiki-dashboard" });
    assert.equal(result.wikiMcpDeclaration.preservedAlias, false);
    assert.equal(result.wikiMcpDeclaration.alias, "portfolio-wiki-dashboard");

    const decl = JSON.parse(await readFile(declPath, "utf8"));
    assert.equal(
      decl.current.alias,
      "portfolio-wiki-dashboard",
      'the reserved "default" placeholder must be replaced by the sanitized repo name'
    );

    assert.equal(decl.current.root, await realpath(tempDir));
    const read = await readRepoLocalWorkspaceDeclaration(tempDir);
    assert.equal(read.ok, true, `reader must accept the rewritten declaration; got ${JSON.stringify(read)}`);
    assert.equal(read.declaration.alias, "portfolio-wiki-dashboard");
  });
});

test("WK-0795 fresh bootstrap derives current.alias from the repo (org/repo -> org-repo), never \"default\"", async () => {
  await withTempDir(async (tempDir) => {
    const result = await bootstrapRepo({ dir: tempDir, repo: "org/repo" });
    assert.equal(result.wikiMcpDeclaration.alias, "org-repo");

    const declPath = path.join(tempDir, WIKI_MCP_DECLARATION_RELATIVE_PATH);
    const decl = JSON.parse(await readFile(declPath, "utf8"));
    assert.equal(decl.current.alias, "org-repo");
    assert.notEqual(decl.current.alias, "default");
  });
});

test("WK-0795 bootstrap preserves a real operator alias and is not confused by the reserved default (declaration)", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "portfolio-wiki-dashboard" });

    const declPath = path.join(tempDir, WIKI_MCP_DECLARATION_RELATIVE_PATH);
    await writeFile(
      declPath,
      `${JSON.stringify(
        {
          schema_version: WIKI_MCP_DECLARATION_SCHEMA_VERSION,
          current: { alias: "operator-chosen-alias", root: "/nonexistent/old" }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const result = await bootstrapRepo({ dir: tempDir, repo: "portfolio-wiki-dashboard" });
    assert.equal(result.wikiMcpDeclaration.preservedAlias, true);
    assert.equal(result.wikiMcpDeclaration.alias, "operator-chosen-alias");

    const decl = JSON.parse(await readFile(declPath, "utf8"));
    assert.equal(decl.current.alias, "operator-chosen-alias");
  });
});

test("WK-0784 bootstrap rewrites a malformed wiki-mcp declaration and reports it (declaration)", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "test-org/test-repo" });

    const declPath = path.join(tempDir, WIKI_MCP_DECLARATION_RELATIVE_PATH);
    await writeFile(declPath, "{ this is not valid json", "utf8");

    const result = await bootstrapRepo({ dir: tempDir, repo: "test-org/test-repo" });
    assert.equal(result.wikiMcpDeclaration.state, "refreshed");
    assert.equal(result.wikiMcpDeclaration.malformed, true);
    assert.equal(typeof result.wikiMcpDeclaration.malformedReason, "string");

    const decl = JSON.parse(await readFile(declPath, "utf8"));
    assert.equal(decl.schema_version, WORKSPACE_DECLARATION_SCHEMA_VERSION);
    assert.equal(decl.current.root, await realpath(tempDir));
    assert.equal(decl.current.alias, "test-org-test-repo");
    const read = await readRepoLocalWorkspaceDeclaration(tempDir);
    assert.equal(read.ok, true, `reader must accept the rewritten declaration; got ${JSON.stringify(read)}`);
  });
});

test("WK-0784 bootstrap rerun keeps an unchanged declaration without rewriting it (declaration)", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "test-org/test-repo" });
    const declPath = path.join(tempDir, WIKI_MCP_DECLARATION_RELATIVE_PATH);
    const afterFirst = await readFile(declPath, "utf8");

    const result = await bootstrapRepo({ dir: tempDir, repo: "test-org/test-repo" });
    const afterSecond = await readFile(declPath, "utf8");

    assert.equal(afterFirst, afterSecond, "an unchanged declaration must be byte-identical on rerun");
    assert.equal(result.wikiMcpDeclaration.state, "kept");
    assert.equal(result.wikiMcpDeclaration.malformed, false);
  });
});
