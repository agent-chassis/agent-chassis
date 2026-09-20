import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { parseMarkdownPage, readMarkdownPage } from "../../packages/wiki-core/src/lib/wiki-page.mjs";

test("parseMarkdownPage is pure and preserves the incumbent page projection", () => {
  const root = path.join(tmpdir(), "wiki-page-pure-root");
  const file = path.join(root, "docs", "missing-λ.md");
  const markdown = "---\nid: SRC-0001\ntitle: Declared title\n---\n\r\n# Heading e\u0301 🚀\r\n\r\nBody  with spaces.\r\n<!-- wiki: id=WK-2527 relation=tracks -->\r\n[read](../other.md)\r\n";
  assert.deepEqual(parseMarkdownPage(root, file, markdown), {
    path: file,
    relativePath: "docs/missing-λ.md",
    frontmatter: { id: "SRC-0001", title: "Declared title" },
    body: "\r\n# Heading e\u0301 🚀\r\n\r\nBody  with spaces.\r\n<!-- wiki: id=WK-2527 relation=tracks -->\r\n[read](../other.md)\r\n",
    title: "Heading e\u0301 🚀",
    backlinks: [{ id: "WK-2527", relation: "tracks" }],
    markdownLinks: ["../other.md"]
  });
});

test("parseMarkdownPage works without a file and readMarkdownPage preserves file failures", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wiki-page-reader-"));
  try {
    const file = path.join(root, "plain.md");
    await writeFile(file, "plain body\n", "utf8");
    assert.deepEqual(await readMarkdownPage(root, file), {
      path: file, relativePath: "plain.md", frontmatter: null, body: "plain body\n",
      title: "plain", backlinks: [], markdownLinks: []
    });
    const missing = path.join(root, "does-not-exist.md");
    assert.deepEqual(parseMarkdownPage(root, missing, "plain body\n"), {
      path: missing, relativePath: "does-not-exist.md", frontmatter: null, body: "plain body\n",
      title: "does-not-exist", backlinks: [], markdownLinks: []
    });
    await assert.rejects(readMarkdownPage(root, missing), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
