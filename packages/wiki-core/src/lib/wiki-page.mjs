

import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { pathExists, slugify } from "./wiki-shared.mjs";
import { extractFrontMatter, extractMarkdownBody } from "./wiki-frontmatter.mjs";

export async function listRecordFiles(targetDir, definition) {
  const directoryPath = path.join(targetDir, definition.directory);
  if (!(await pathExists(directoryPath))) {
    return [];
  }

  const entries = await readdir(directoryPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .filter((entry) => isCanonicalRecordFile(entry.name, definition))
    .map((entry) => path.join(directoryPath, entry.name));
}

export function isCanonicalRecordFile(fileName, definition) {
  if ((definition.reservedFilenames || []).includes(fileName)) {
    return false;
  }

  if (definition.filenameStrategy === "id_only") {
    return new RegExp(`^${definition.prefix}-\\d{4}\\.md$`).test(fileName);
  }

  if (definition.filenameStrategy === "slug_only") {
    return /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(fileName);
  }

  return fileName.endsWith(".md");
}

export function expectedFileStem(frontMatter, filePath, definition) {
  if (!frontMatter?.id) {
    return null;
  }

  if (definition.filenameStrategy === "id_only") {
    return frontMatter.id;
  }

  if (definition.filenameStrategy === "slug_only") {
    return slugify(frontMatter.id);
  }

  return path.basename(filePath, ".md");
}

export async function walkMarkdownFiles(rootDir) {
  if (!(await pathExists(rootDir))) {
    return [];
  }

  const entries = await readdir(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkMarkdownFiles(entryPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

export async function readMarkdownPage(targetDir, filePath) {
  const markdown = await readFile(filePath, "utf8");
  const frontmatter = extractFrontMatter(markdown);
  const body = extractMarkdownBody(markdown);
  const titleMatch = body.match(/^#\s+(.+)$/m);
  const backlinks = Array.from(
    body.matchAll(/<!--\s*wiki:\s*id=([A-Z]+-\d{4}|[a-z0-9-]+)\s+relation=([a-z_]+)\s*-->/g)
  ).map((match) => ({
    id: match[1],
    relation: match[2]
  }));
  const markdownLinks = Array.from(body.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)).map(
    (match) => match[1]
  );

  return {
    path: filePath,
    relativePath: path.relative(targetDir, filePath).replaceAll(path.sep, "/"),
    frontmatter,
    body,
    title: titleMatch?.[1]?.trim() ?? path.basename(filePath, ".md"),
    backlinks,
    markdownLinks
  };
}
