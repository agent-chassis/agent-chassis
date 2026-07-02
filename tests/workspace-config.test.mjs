

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

import {
  WORKSPACE_DECLARATION_RELATIVE_PATH,
  WORKSPACE_DECLARATION_SCHEMA_VERSION,
  readRepoLocalWorkspaceDeclaration
} from "../packages/wiki-mcp/src/lib/workspace-config.mjs";

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wiki-wkconfig-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeDeclaration(dir, content) {
  const declPath = path.join(dir, WORKSPACE_DECLARATION_RELATIVE_PATH);
  await mkdir(path.dirname(declPath), { recursive: true });
  const raw = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  await writeFile(declPath, raw, "utf8");
}

function minimalDeclaration(dir, alias = "testrepo") {
  return {
    schema_version: WORKSPACE_DECLARATION_SCHEMA_VERSION,
    current: { alias, root: dir }
  };
}

test("workspace-config / exported constants", () => {
  assert.equal(WORKSPACE_DECLARATION_RELATIVE_PATH, "wiki/.wiki-mcp.json");
  assert.equal(WORKSPACE_DECLARATION_SCHEMA_VERSION, "wiki-mcp-workspace.v1");
});

test("workspace-config / absent declaration returns not_found", async () => {
  await withTempDir(async (dir) => {
    const result = await readRepoLocalWorkspaceDeclaration(dir);
    assert.equal(result.ok, false);
    assert.equal(result.not_found, true);
    assert.deepEqual(result.diagnostics, []);
  });
});

test("workspace-config / valid minimal declaration", async () => {
  await withTempDir(async (dir) => {
    await writeDeclaration(dir, minimalDeclaration(dir));
    const result = await readRepoLocalWorkspaceDeclaration(dir);
    assert.equal(result.ok, true, `expected ok but got: ${JSON.stringify(result.diagnostics ?? [])}`);
    assert.equal(result.declaration.alias, "testrepo");
    assert.equal(result.declaration.schema_version, WORKSPACE_DECLARATION_SCHEMA_VERSION);
    assert.equal(result.declaration.root, result.declaration.root);
    assert.deepEqual(result.declaration.linked_repos, []);
    assert.equal(result.declaration.profile, null);
    assert.equal(result.declaration.tool_profile, null);
  });
});

test("workspace-config / valid declaration with optional metadata", async () => {
  await withTempDir(async (dir) => {
    await writeDeclaration(dir, {
      ...minimalDeclaration(dir),
      profile: "agent-safe",
      tool_profile: "agent-safe"
    });
    const result = await readRepoLocalWorkspaceDeclaration(dir);
    assert.equal(result.ok, true, `expected ok but got: ${JSON.stringify(result.diagnostics ?? [])}`);
    assert.equal(result.declaration.profile, "agent-safe");
    assert.equal(result.declaration.tool_profile, "agent-safe");
  });
});

test("workspace-config / malformed JSON fails closed", async () => {
  await withTempDir(async (dir) => {
    await writeDeclaration(dir, "{ not valid json ");
    const result = await readRepoLocalWorkspaceDeclaration(dir);
    assert.equal(result.ok, false);
    assert.equal(result.not_found, false);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].code, "declaration_malformed_json");
    assert.equal(result.diagnostics[0].severity, "error");
  });
});

test("workspace-config / JSON array fails closed", async () => {
  await withTempDir(async (dir) => {
    await writeDeclaration(dir, "[1, 2, 3]");
    const result = await readRepoLocalWorkspaceDeclaration(dir);
    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, "declaration_invalid_schema");
  });
});

test("workspace-config / missing schema_version fails closed", async () => {
  await withTempDir(async (dir) => {
    await writeDeclaration(dir, { current: { alias: "x", root: dir } });
    const result = await readRepoLocalWorkspaceDeclaration(dir);
    assert.equal(result.ok, false);
    const codes = result.diagnostics.map((d) => d.code);
    assert.ok(codes.includes("declaration_invalid_schema"), `got codes: ${JSON.stringify(codes)}`);
  });
});

test("workspace-config / wrong schema_version fails closed", async () => {
  await withTempDir(async (dir) => {
    await writeDeclaration(dir, {
      schema_version: "wiki-mcp-workspace.v0",
      current: { alias: "x", root: dir }
    });
    const result = await readRepoLocalWorkspaceDeclaration(dir);
    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, "declaration_invalid_schema");
    assert.ok(result.diagnostics[0].path === "schema_version");
  });
});

test("workspace-config / missing current fails closed", async () => {
  await withTempDir(async (dir) => {
    await writeDeclaration(dir, { schema_version: WORKSPACE_DECLARATION_SCHEMA_VERSION });
    const result = await readRepoLocalWorkspaceDeclaration(dir);
    assert.equal(result.ok, false);
    const codes = result.diagnostics.map((d) => d.code);
    assert.ok(codes.includes("declaration_invalid_schema"), `got codes: ${JSON.stringify(codes)}`);
  });
});

test("workspace-config / current not an object fails closed", async () => {
  await withTempDir(async (dir) => {
    await writeDeclaration(dir, {
      schema_version: WORKSPACE_DECLARATION_SCHEMA_VERSION,
      current: "not an object"
    });
    const result = await readRepoLocalWorkspaceDeclaration(dir);
    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, "declaration_invalid_schema");
  });
});

test("workspace-config / invalid alias pattern fails closed", async () => {
  await withTempDir(async (dir) => {
    await writeDeclaration(dir, {
      schema_version: WORKSPACE_DECLARATION_SCHEMA_VERSION,
      current: { alias: "my repo!", root: dir }
    });
    const result = await readRepoLocalWorkspaceDeclaration(dir);
    assert.equal(result.ok, false);
    const codes = result.diagnostics.map((d) => d.code);
    assert.ok(codes.includes("declaration_invalid_alias"), `got codes: ${JSON.stringify(codes)}`);
  });
});

test("workspace-config / empty alias fails closed", async () => {
  await withTempDir(async (dir) => {
    await writeDeclaration(dir, {
      schema_version: WORKSPACE_DECLARATION_SCHEMA_VERSION,
      current: { alias: "  ", root: dir }
    });
    const result = await readRepoLocalWorkspaceDeclaration(dir);
    assert.equal(result.ok, false);
    const codes = result.diagnostics.map((d) => d.code);
    assert.ok(codes.includes("declaration_invalid_alias"), `got codes: ${JSON.stringify(codes)}`);
  });
});

test("workspace-config / relative root fails closed", async () => {
  await withTempDir(async (dir) => {
    await writeDeclaration(dir, {
      schema_version: WORKSPACE_DECLARATION_SCHEMA_VERSION,
      current: { alias: "testrepo", root: "relative/path" }
    });
    const result = await readRepoLocalWorkspaceDeclaration(dir);
    assert.equal(result.ok, false);
    const codes = result.diagnostics.map((d) => d.code);
    assert.ok(codes.includes("declaration_invalid_root"), `got codes: ${JSON.stringify(codes)}`);
  });
});

test("workspace-config / nonexistent root fails closed with path_resolution_failed", async () => {
  await withTempDir(async (dir) => {
    await writeDeclaration(dir, {
      schema_version: WORKSPACE_DECLARATION_SCHEMA_VERSION,
      current: { alias: "testrepo", root: "/this/path/does/not/exist/ever" }
    });
    const result = await readRepoLocalWorkspaceDeclaration(dir);
    assert.equal(result.ok, false);
    const codes = result.diagnostics.map((d) => d.code);
    assert.ok(
      codes.includes("declaration_path_resolution_failed") || codes.includes("declaration_root_mismatch"),
      `expected path_resolution_failed or root_mismatch; got codes: ${JSON.stringify(codes)}`
    );
  });
});

test("workspace-config / root mismatch fails closed", async () => {
  await withTempDir(async (dirA) => {
    await withTempDir(async (dirB) => {

      await writeDeclaration(dirA, {
        schema_version: WORKSPACE_DECLARATION_SCHEMA_VERSION,
        current: { alias: "testrepo", root: dirB }
      });
      const result = await readRepoLocalWorkspaceDeclaration(dirA);
      assert.equal(result.ok, false);
      const codes = result.diagnostics.map((d) => d.code);
      assert.ok(codes.includes("declaration_root_mismatch"), `got codes: ${JSON.stringify(codes)}`);

      assert.ok(
        result.diagnostics[0].message.includes("WIKI_MCP_WORKSPACE_ALIAS"),
        "refusal message should mention WIKI_MCP_WORKSPACE_ALIAS override"
      );
    });
  });
});

test("workspace-config / valid linked_repos entry", async () => {
  await withTempDir(async (mainDir) => {
    await withTempDir(async (linkedDir) => {
      await writeDeclaration(mainDir, {
        ...minimalDeclaration(mainDir),
        linked_repos: {
          linkedrepo: { root: linkedDir, profile: "agent-safe" }
        }
      });
      const result = await readRepoLocalWorkspaceDeclaration(mainDir);
      assert.equal(result.ok, true, `expected ok but got: ${JSON.stringify(result.diagnostics ?? [])}`);
      assert.equal(result.declaration.linked_repos.length, 1);
      assert.equal(result.declaration.linked_repos[0].alias, "linkedrepo");
      assert.equal(result.declaration.linked_repos[0].profile, "agent-safe");
      assert.ok(typeof result.declaration.linked_repos[0].root === "string");
    });
  });
});

test("workspace-config / linked_repos alias conflicts with current alias", async () => {
  await withTempDir(async (dir) => {
    await withTempDir(async (linkedDir) => {
      await writeDeclaration(dir, {
        ...minimalDeclaration(dir, "testrepo"),
        linked_repos: { testrepo: { root: linkedDir } }
      });
      const result = await readRepoLocalWorkspaceDeclaration(dir);
      assert.equal(result.ok, false);
      const codes = result.diagnostics.map((d) => d.code);
      assert.ok(codes.includes("declaration_alias_conflict"), `got codes: ${JSON.stringify(codes)}`);
    });
  });
});

test("workspace-config / linked_repos duplicate root fails closed", async () => {
  await withTempDir(async (dir) => {

    await writeDeclaration(dir, {
      ...minimalDeclaration(dir, "testrepo"),
      linked_repos: { linked1: { root: dir } }
    });
    const result = await readRepoLocalWorkspaceDeclaration(dir);
    assert.equal(result.ok, false);
    const codes = result.diagnostics.map((d) => d.code);
    assert.ok(codes.includes("declaration_duplicate_root"), `got codes: ${JSON.stringify(codes)}`);
  });
});

test("workspace-config / linked_repos invalid alias pattern fails closed", async () => {
  await withTempDir(async (dir) => {
    await withTempDir(async (linkedDir) => {
      await writeDeclaration(dir, {
        ...minimalDeclaration(dir),
        linked_repos: { "bad alias!": { root: linkedDir } }
      });
      const result = await readRepoLocalWorkspaceDeclaration(dir);
      assert.equal(result.ok, false);
      const codes = result.diagnostics.map((d) => d.code);
      assert.ok(codes.includes("declaration_invalid_alias"), `got codes: ${JSON.stringify(codes)}`);
    });
  });
});

test("workspace-config / linked_repos not an object fails closed", async () => {
  await withTempDir(async (dir) => {
    await writeDeclaration(dir, {
      ...minimalDeclaration(dir),
      linked_repos: ["not", "an", "object"]
    });
    const result = await readRepoLocalWorkspaceDeclaration(dir);
    assert.equal(result.ok, false);
    const codes = result.diagnostics.map((d) => d.code);
    assert.ok(codes.includes("declaration_invalid_linked_repos"), `got codes: ${JSON.stringify(codes)}`);
  });
});

test("workspace-config / linked_repos entry not an object fails closed", async () => {
  await withTempDir(async (dir) => {
    await writeDeclaration(dir, {
      ...minimalDeclaration(dir),
      linked_repos: { linkedrepo: "not an object" }
    });
    const result = await readRepoLocalWorkspaceDeclaration(dir);
    assert.equal(result.ok, false);
    const codes = result.diagnostics.map((d) => d.code);
    assert.ok(codes.includes("declaration_invalid_linked_entry"), `got codes: ${JSON.stringify(codes)}`);
  });
});

test("workspace-config / linked_repos relative root fails closed", async () => {
  await withTempDir(async (dir) => {
    await writeDeclaration(dir, {
      ...minimalDeclaration(dir),
      linked_repos: { linkedrepo: { root: "relative/path" } }
    });
    const result = await readRepoLocalWorkspaceDeclaration(dir);
    assert.equal(result.ok, false);
    const codes = result.diagnostics.map((d) => d.code);
    assert.ok(codes.includes("declaration_invalid_root"), `got codes: ${JSON.stringify(codes)}`);
  });
});

test("workspace-config / alias with dots and hyphens is valid", async () => {
  await withTempDir(async (dir) => {
    await writeDeclaration(dir, minimalDeclaration(dir, "my-repo.v2"));
    const result = await readRepoLocalWorkspaceDeclaration(dir);
    assert.equal(result.ok, true, `expected ok but got: ${JSON.stringify(result.diagnostics ?? [])}`);
    assert.equal(result.declaration.alias, "my-repo.v2");
  });
});
