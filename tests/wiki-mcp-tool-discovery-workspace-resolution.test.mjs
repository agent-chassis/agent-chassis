import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { bootstrapRepo } from "../packages/wiki-core/src/index.mjs";

import { INITIALIZE_PARAMS, createMcpSession } from "./wiki-mcp-tool-discovery-helpers.mjs";

test("workspace-scoped MCP tools omit repo and resolve the current workspace alias", async () => {
  const workRoot = await mkdtemp(path.join(os.tmpdir(), "wiki-mcp-workspace-repo-"));
  const currentRepo = path.join(workRoot, "agent-chassis");
  const configuredDefaultRepo = path.join(workRoot, "node-engine");

  try {
    await bootstrapRepo({ dir: currentRepo, repo: "agent-chassis/agent-chassis-demo" });
    await bootstrapRepo({ dir: configuredDefaultRepo, repo: "agent-chassis/node-engine-demo" });
    await mkdir(path.join(currentRepo, "docs"), { recursive: true });
    await writeFile(
      path.join(currentRepo, "docs", "current-workspace.md"),
      "# Current Workspace\n\nThe unambiguous local repo alias should win.\n",
      "utf8"
    );

    const session = createMcpSession({
      env: {
        WIKI_MCP_REPOS: JSON.stringify({
          "node-engine": configuredDefaultRepo,
          "agent-chassis": currentRepo
        }),
        WIKI_MCP_WORKSPACE_DIR: currentRepo,
        WIKI_MCP_WORKSPACE_ALIAS: "agent-chassis",
        WIKI_MCP_DEFAULT_REPO: "node-engine"
      }
    });

    try {
      await session.request(1, "initialize", INITIALIZE_PARAMS);

      const built = await session.request(2, "tools/call", {
        name: "workspace_build_search_index",
        arguments: {}
      });
      assert.equal(built.structuredContent.workspaceRepo, "agent-chassis");
      assert.equal(built.structuredContent.indexState, "rewritten");
      assert.equal(built.structuredContent.rebuilt, true);

      const searched = await session.request(3, "tools/call", {
        name: "workspace_search_repo",
        arguments: {
          query: "unambiguous local repo alias"
        }
      });
      assert.equal(searched.structuredContent.workspaceRepo, "agent-chassis");
      assert.ok(searched.structuredContent.results.length > 0);
      assert.match(searched.structuredContent.results[0].relativePath, /^docs\//);
      assert.match(
        JSON.stringify(searched.structuredContent.results[0]),
        /unambiguous local repo alias/
      );
    } finally {
      await session.close();
    }
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
});

test("workspace-scoped MCP tools refuse when no local repo context is available", async () => {
  const workRoot = await mkdtemp(path.join(os.tmpdir(), "wiki-mcp-no-workspace-"));
  const configuredDefaultRepo = path.join(workRoot, "node-engine");
  const otherRepo = path.join(workRoot, "agent-chassis");

  try {
    await bootstrapRepo({ dir: configuredDefaultRepo, repo: "agent-chassis/node-engine-demo" });
    await bootstrapRepo({ dir: otherRepo, repo: "agent-chassis/agent-chassis-demo" });

    const session = createMcpSession({
      env: {
        WIKI_MCP_REPOS: JSON.stringify({
          "node-engine": configuredDefaultRepo,
          "agent-chassis": otherRepo
        }),
        WIKI_MCP_DEFAULT_REPO: "node-engine"
      }
    });

    try {
      await session.request(1, "initialize", INITIALIZE_PARAMS);

      const searched = await session.request(2, "tools/call", {
        name: "workspace_search_repo",
        arguments: {
          query: "unambiguous local repo alias"
        }
      });

      assert.equal(searched.isError, true);
      assert.ok(searched.structuredContent);
      assert.equal(searched.structuredContent.schema_version, "workspace-repo-resolution.v1");
      assert.equal(searched.structuredContent.refused, true);
      assert.equal(searched.structuredContent.refusal.category, "not_in_repo");
      assert.equal(searched.structuredContent.refusal.reason, "wrong_session");
      assert.match(searched.structuredContent.refusal.message, /repo-attached session/);
      assert.equal(searched.structuredContent.refusal.detail.current_workspace_repo, null);
      assert.deepEqual(
        searched.structuredContent.refusal.detail.configured_workspace_repos,
        ["node-engine", "agent-chassis"]
      );
    } finally {
      await session.close();
    }
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
});

test("workspace-scoped MCP tools refuse when no workspace repos are configured", async () => {
  const session = createMcpSession({
    env: {
      WIKI_MCP_REPOS: "",
      WIKI_MCP_WORKSPACE_DIR: "",
      WIKI_MCP_WORKSPACE_ALIAS: "",
      WIKI_MCP_DEFAULT_REPO: "node-engine"
    }
  });

  try {
    await session.request(1, "initialize", INITIALIZE_PARAMS);

    const searched = await session.request(2, "tools/call", {
      name: "workspace_search_repo",
      arguments: {
        query: "unambiguous local repo alias"
      }
    });

    assert.equal(searched.isError, true);
    assert.ok(searched.structuredContent);
    assert.equal(searched.structuredContent.schema_version, "workspace-repo-resolution.v1");
    assert.equal(searched.structuredContent.refused, true);
    assert.equal(searched.structuredContent.refusal.category, "not_in_repo");
    assert.equal(searched.structuredContent.refusal.reason, "wrong_session");
    assert.match(searched.structuredContent.refusal.message, /No workspace repositories are configured/);
    assert.equal(searched.structuredContent.refusal.detail.current_workspace_repo, null);
    assert.deepEqual(searched.structuredContent.refusal.detail.configured_workspace_repos, []);
  } finally {
    await session.close();
  }
});
