import { access, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  bootstrapRepo,
  buildSidecarIndex,
  getSidecarIndexStatus
} from "../packages/wiki-core/src/index.mjs";
import { loadLexicalSearchIndexForRead, searchLexicalIndex } from "../packages/wiki-core/src/lib/search.mjs";
import { SIDECAR_DEFAULT_CACHE_DIR } from "../packages/wiki-core/src/lib/sidecar-status.mjs";

import { WIKI_MCP_DECLARATION_RELATIVE_PATH } from "../packages/wiki-core/src/lib/wiki-scaffold.mjs";
import { withTempDir } from "./wiki-bootstrap-adoption-helpers.mjs";

const execFileAsync = promisify(execFile);

async function git(dir, args) {
  const { stdout } = await execFileAsync("git", ["-C", dir, ...args]);
  return stdout.trim();
}

async function initMinimalGitRepo(dir) {
  await git(dir, ["init"]);
  await git(dir, ["config", "user.email", "wiki-bootstrap-test@example.invalid"]);
  await git(dir, ["config", "user.name", "Wiki Bootstrap Test"]);
  await writeFile(path.join(dir, "README.md"), "# Test repo\n", "utf8");
  await git(dir, ["add", "README.md"]);
  await git(dir, ["commit", "-m", "Initial commit"]);
}

test("WK-0750 bootstrap creates .cache/wiki-search/index.json and search can use it", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "test-org/test-repo" });

    const indexPath = path.join(tempDir, ".cache", "wiki-search", "index.json");
    await assert.doesNotReject(
      () => access(indexPath),
      `.cache/wiki-search/index.json must exist after bootstrap`
    );

    const raw = await readFile(indexPath, "utf8");
    const index = JSON.parse(raw);
    assert.equal(typeof index.version, "number", "index must have a version");
    assert.equal(index.mode, "lexical", "index must be lexical");
    assert.ok(Array.isArray(index.chunks), "index must have chunks array");
    assert.ok(index.chunks.length > 0, "bootstrapped repo must have at least one searchable chunk");

    const readResult = await loadLexicalSearchIndexForRead(tempDir);
    assert.ok(readResult.index, "loadLexicalSearchIndexForRead must return an index");

    const results = searchLexicalIndex(readResult.index, { query: "adopt wiki contract" });
    assert.ok(results.length > 0, "search must find adoption-related content seeded by bootstrap");
  });
});

test("WK-0750 bootstrap defaults repo from target directory basename when repo is omitted", async () => {
  await withTempDir(async (tempDir) => {
    const expectedRepo = path.basename(tempDir);

    const result = await bootstrapRepo({ dir: tempDir });

    assert.equal(
      result.repo,
      expectedRepo,
      "bootstrapRepo must default repo to the target directory basename when repo is omitted"
    );

    const metadataPath = path.join(tempDir, "wiki", ".wiki-contract.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    assert.equal(
      metadata.repo,
      expectedRepo,
      "written wiki contract metadata must use the target directory basename when repo is omitted"
    );
  });
});

test("WK-0750 bootstrap CLI uses target directory basename when --repo is omitted", async () => {
  await withTempDir(async (tempDir) => {
    const expectedRepo = path.basename(tempDir);
    const cliPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../packages/wiki-cli/src/index.mjs"
    );

    const { stdout } = await execFileAsync("node", [
      cliPath,
      "bootstrap",
      "--dir",
      tempDir
    ]);

    assert.match(stdout, /Bootstrapped wiki surfaces in /, "bootstrap CLI must run successfully");

    const metadataPath = path.join(tempDir, "wiki", ".wiki-contract.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    assert.equal(
      metadata.repo,
      expectedRepo,
      "bootstrap CLI must default repo to the target directory basename when --repo is omitted"
    );
  });
});

test("WK-0750 bootstrap ensures .cache/repo-code-index is ignored in root .gitignore", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "test-org/test-repo" });

    const gitignorePath = path.join(tempDir, ".gitignore");
    await assert.doesNotReject(
      () => access(gitignorePath),
      ".gitignore must exist after bootstrap"
    );

    const content = await readFile(gitignorePath, "utf8");

    const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
    const bareCodeIndex = SIDECAR_DEFAULT_CACHE_DIR.replace(/\/$/, "");
    const covered = lines.some((line) => {
      const bare = line.replace(/\/$/, "");
      return bare === bareCodeIndex || bareCodeIndex.startsWith(`${bare}/`);
    });
    assert.ok(
      covered,
      `.gitignore must contain an entry that covers '${SIDECAR_DEFAULT_CACHE_DIR}'; got: ${content}`
    );

    const bareSearch = ".cache/wiki-search";
    const searchCovered = lines.some((line) => {
      const bare = line.replace(/\/$/, "");
      return bare === bareSearch || bareSearch.startsWith(`${bare}/`);
    });
    assert.ok(
      searchCovered,
      `.gitignore must contain an entry that covers '.cache/wiki-search'; got: ${content}`
    );
  });
});

test("WK-0750 bootstrap gitignore entries are idempotent on second run", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "test-org/test-repo" });
    const afterFirst = await readFile(path.join(tempDir, ".gitignore"), "utf8");

    await bootstrapRepo({ dir: tempDir, repo: "test-org/test-repo" });
    const afterSecond = await readFile(path.join(tempDir, ".gitignore"), "utf8");

    assert.equal(
      afterFirst,
      afterSecond,
      "running bootstrap twice must not add duplicate .gitignore entries"
    );
  });
});

test("WK-0750 bootstrap preserves existing .gitignore content", async () => {
  await withTempDir(async (tempDir) => {
    const userContent = "# User entries\nnode_modules/\ndist/\n";
    await writeFile(path.join(tempDir, ".gitignore"), userContent, "utf8");

    await bootstrapRepo({ dir: tempDir, repo: "test-org/test-repo" });

    const after = await readFile(path.join(tempDir, ".gitignore"), "utf8");
    assert.ok(
      after.startsWith(userContent),
      "bootstrap must preserve existing .gitignore content at the top"
    );

    assert.ok(after.includes("node_modules/"), "node_modules/ must be preserved");
    assert.ok(after.includes("dist/"), "dist/ must be preserved");
  });
});

test("WK-0750 bootstrap does not duplicate cache gitignore entries when .cache/ already covers cache paths", async () => {
  await withTempDir(async (tempDir) => {

    await writeFile(path.join(tempDir, ".gitignore"), ".cache/\n", "utf8");

    const result = await bootstrapRepo({ dir: tempDir, repo: "test-org/test-repo" });

    const content = await readFile(path.join(tempDir, ".gitignore"), "utf8");

    assert.ok(
      !content.includes(".cache/wiki-search"),
      "must not add .cache/wiki-search when .cache/ already covers it"
    );
    assert.ok(
      !content.includes(`${SIDECAR_DEFAULT_CACHE_DIR}\n`) || content.startsWith(".cache/\n"),
      "must not add a redundant repo-code-index cache sub-entry"
    );

    assert.ok(content.startsWith(".cache/\n"), "existing .cache/ entry must be preserved");

    assert.ok(
      result.cacheAndIgnores.gitignore.updated,
      "gitignore must be updated to add the non-cache wiki-mcp declaration entry"
    );
    assert.deepEqual(
      result.cacheAndIgnores.gitignore.added,
      [WIKI_MCP_DECLARATION_RELATIVE_PATH],
      "only the wiki-mcp declaration entry should be added when .cache/ covers the cache paths"
    );
    assert.ok(
      content.includes(WIKI_MCP_DECLARATION_RELATIVE_PATH),
      "wiki/.wiki-mcp.json must be added to .gitignore"
    );
  });
});

test("WK-0750 bootstrap allows code-index status without cache_path_not_ignored in a git repo", async () => {
  await withTempDir(async (tempDir) => {

    await initMinimalGitRepo(tempDir);
    await bootstrapRepo({ dir: tempDir, repo: "test-org/test-repo" });

    let status;
    await assert.doesNotReject(
      async () => {
        status = await getSidecarIndexStatus({ dir: tempDir });
      },
      "getSidecarIndexStatus must not throw after bootstrap writes the gitignore entry"
    );

    assert.equal(status.staleness, "missing", "staleness must be missing — no code-index built yet");
    assert.notEqual(
      status.dirty_state,
      "non_git",
      "dirty_state must not be non_git — the test uses a real git repo"
    );
  });
});

test("WK-0750 bootstrap allows a dirty-safe code-index build without first committing, but still requires an ignored cache path", async () => {

  await withTempDir(async (tempDir) => {
    await initMinimalGitRepo(tempDir);
    await bootstrapRepo({ dir: tempDir, repo: "test-org/test-repo" });

    const built = await buildSidecarIndex({ dir: tempDir });
    assert.equal(built.staleness, "fresh");
    assert.equal(built.dirty_state, "dirty_worktree");
    assert.equal(built.build_action, "build");
    assert.equal(built.status_reason, "build_complete");
    assert.equal(built.cache_path, SIDECAR_DEFAULT_CACHE_DIR);
    await access(path.join(tempDir, SIDECAR_DEFAULT_CACHE_DIR, "index.json"));

    await assert.rejects(
      buildSidecarIndex({ dir: tempDir, cacheDir: "not-ignored-index" }),
      (error) => {
        assert.equal(error.code, "cache_path_not_ignored");
        return true;
      }
    );
  });
});

test("WK-0750 bootstrap returns cacheAndIgnores result with expected shape", async () => {
  await withTempDir(async (tempDir) => {
    const result = await bootstrapRepo({ dir: tempDir, repo: "test-org/test-repo" });
    const ci = result.cacheAndIgnores;

    assert.ok(ci, "bootstrapRepo must return cacheAndIgnores");
    assert.equal(typeof ci.searchCacheDir, "string");
    assert.equal(typeof ci.codeIndexCacheDir, "string");
    assert.equal(typeof ci.gitignore.path, "string");
    assert.equal(typeof ci.gitignore.updated, "boolean");
    assert.ok(Array.isArray(ci.gitignore.added));
    assert.equal(typeof ci.searchIndex.indexPath, "string");
    assert.equal(typeof ci.searchIndex.rebuilt, "boolean");
    assert.ok(ci.searchIndex.rebuilt, "index must be built on first bootstrap");
    assert.ok(typeof ci.searchIndex.chunkCount === "number" && ci.searchIndex.chunkCount > 0);
  });
});
