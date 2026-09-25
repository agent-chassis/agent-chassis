

import { chmodSync, copyFileSync, lstatSync, mkdirSync, readlinkSync, symlinkSync } from "node:fs";
import path from "node:path";

function projectEntry(entry) {
  if (typeof entry !== "string" || entry === "" || path.isAbsolute(entry) ||
      entry.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`working-copy entry is not a project-relative path: ${JSON.stringify(entry)}`);
  }
  return entry;
}

export function copySelectedSource({ from, to, entries }) {
  if (!Array.isArray(entries)) throw new Error("working-copy entries must be an array");
  mkdirSync(to, { recursive: true });
  const counts = { files: 0, links: 0, missing: 0 };
  for (const entry of entries) {
    const relative = projectEntry(entry);
    const source = path.join(from, relative);
    const target = path.join(to, relative);
    let stat;
    try {
      stat = lstatSync(source);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      counts.missing += 1;
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    if (stat.isSymbolicLink()) {
      symlinkSync(readlinkSync(source), target);
      counts.links += 1;
    } else if (stat.isFile()) {
      copyFileSync(source, target);
      chmodSync(target, stat.mode & 0o7777);
      counts.files += 1;
    } else {
      throw new Error(`working-copy entry is neither a file nor a symbolic link: ${source}`);
    }
  }
  return counts;
}
