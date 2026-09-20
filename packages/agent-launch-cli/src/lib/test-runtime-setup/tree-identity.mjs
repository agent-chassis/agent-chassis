

import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";

function walk(root, visit, exclude) {
  const stat = lstatSync(root);
  const step = (absolute, relative, entryStat) => {
    if (exclude.has(path.basename(absolute)) && relative !== "") return;
    if (entryStat.isSymbolicLink()) {
      visit({ absolute, relative, kind: "link", stat: entryStat, target: readlinkSync(absolute) });
      return;
    }
    if (entryStat.isDirectory()) {
      visit({ absolute, relative, kind: "dir", stat: entryStat });
      for (const name of readdirSync(absolute).sort()) {
        const child = path.join(absolute, name);
        step(child, relative === "" ? name : `${relative}/${name}`, lstatSync(child));
      }
      return;
    }
    if (entryStat.isFile()) visit({ absolute, relative, kind: "file", stat: entryStat });
  };
  step(root, "", stat);
}

function measure(population, { content, exclude = [] }) {
  const hash = createHash("sha256");
  const excluded = new Set(exclude);
  let files = 0;
  let bytes = 0;
  for (const root of [...population].sort()) {
    hash.update(`root\0${root}\n`);
    walk(root, (entry) => {
      const mode = entry.stat.mode & 0o7777;
      if (entry.kind === "file") {
        files += 1;
        bytes += entry.stat.size;
        const detail = content
          ? createHash("sha256").update(readFileSync(entry.absolute)).digest("hex")
          : `${entry.stat.size}:${entry.stat.mtimeMs}:${entry.stat.ino}`;
        hash.update(`f\0${entry.relative}\0${mode & 0o111 ? "x" : "-"}\0${detail}${
          content ? "" : `:${mode}`}\n`);
      } else if (entry.kind === "link") {
        hash.update(`l\0${entry.relative}\0${entry.target}\n`);
      } else {
        hash.update(`d\0${entry.relative}${content ? "" : `\0${entry.stat.mtimeMs}:${mode}`}\n`);
      }
    }, excluded);
  }
  return { digest: `sha256:${hash.digest("hex")}`, files, bytes };
}

export function measurePopulationContent(population, options = {}) {
  const { digest, files, bytes } = measure(population, { ...options, content: true });
  return Object.freeze({ content_digest: digest, file_count: files, byte_count: bytes });
}

export function fingerprintPopulation(population, options = {}) {
  return measure(population, { ...options, content: false }).digest;
}

export function digestNamedFiles(files) {
  const hash = createHash("sha256");
  for (const [name, absolute] of Object.entries(files).sort(([left], [right]) =>
    left.localeCompare(right))) {
    hash.update(`${name}\0${createHash("sha256").update(readFileSync(absolute)).digest("hex")}\n`);
  }
  return `sha256:${hash.digest("hex")}`;
}
