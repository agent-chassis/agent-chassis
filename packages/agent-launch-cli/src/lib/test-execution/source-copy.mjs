

import { chmodSync, copyFileSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync,
  writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

function projectEntry(entry) {
  if (typeof entry !== "string" || entry === "" || path.isAbsolute(entry) ||
      entry.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`working-copy entry is not a project-relative path: ${JSON.stringify(entry)}`);
  }
  return entry;
}

export function copySelectedSource({ from, to, entries, strict = false }) {
  if (!Array.isArray(entries)) throw new Error("working-copy entries must be an array");
  try {
    mkdirSync(to, { recursive: true });
  } catch (error) {
    if (!strict) throw error;
    throw proofCopyFailure("proof_source_entry_copy_failed", to, error);
  }
  const counts = { files: 0, links: 0, directories: 0, missing: 0 };
  const strictDirectories = [];
  for (const selected of entries) {
    const relative = projectEntry(strict ? selected?.path : selected);
    const source = path.join(from, relative);
    const target = path.join(to, relative);
    let stat;
    try {
      stat = lstatSync(source);
    } catch (error) {
      if (strict) throw proofCopyFailure(error?.code === "ENOENT" || error?.code === "ENOTDIR"
        ? "proof_source_entry_missing" : "proof_source_entry_unreadable", source, error);
      if (error?.code !== "ENOENT") throw error;
      counts.missing += 1;
      continue;
    }
    try {
      mkdirSync(path.dirname(target), { recursive: true });
    } catch (error) {
      if (!strict) throw error;
      throw proofCopyFailure("proof_source_entry_copy_failed", path.dirname(target), error);
    }
    if (strict && selected.kind === "directory" && stat.isDirectory()) {
      try {
        mkdirSync(target, { recursive: true, mode: 0o700 });
      } catch (error) {
        throw proofCopyFailure("proof_source_entry_copy_failed", target, error);
      }
      strictDirectories.push({ target, source, mode: selected.mode & 0o777 });
      counts.directories += 1;
    } else if (strict && selected.kind === "file" && stat.isFile()) {
      let actual;
      let content;
      try {
        content = readFileSync(source);
        actual = createHash("sha256").update(content).digest("hex");
      } catch (error) {
        throw proofCopyFailure("proof_source_entry_unreadable", source, error);
      }
      if (selected.digest !== `sha256:${actual}` || (stat.mode & 0o777) !== selected.mode) {
        throw proofCopyFailure("proof_source_entry_changed", source);
      }
      try {
        writeFileSync(target, content);
        chmodSync(target, selected.mode & 0o777);
      } catch (error) {
        throw proofCopyFailure("proof_source_entry_copy_failed", target, error);
      }
      counts.files += 1;
    } else if (strict) {
      throw proofCopyFailure("proof_source_entry_unsupported", source);
    } else if (stat.isSymbolicLink()) {
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
  if (strict) {

    strictDirectories.sort((left, right) => right.target.length - left.target.length);
    for (const directory of strictDirectories) {
      try {
        chmodSync(directory.target, directory.mode);
      } catch (error) {
        throw proofCopyFailure("proof_source_entry_copy_failed", directory.target, error);
      }
    }
    for (const selected of entries) {
      const relative = projectEntry(selected.path);
      const source = path.join(from, relative);
      const target = path.join(to, relative);
      let before;
      let after;
      try {
        before = lstatSync(source);
      } catch (error) {
        throw proofCopyFailure(error?.code === "ENOENT" || error?.code === "ENOTDIR"
          ? "proof_source_entry_missing" : "proof_source_entry_unreadable", source, error);
      }
      try {
        after = lstatSync(target);
      } catch (error) {
        throw proofCopyFailure(error?.code === "ENOENT" || error?.code === "ENOTDIR"
          ? "proof_source_copy_parity_failed" : "proof_source_entry_copy_failed", target, error);
      }
      if (before.isDirectory() !== after.isDirectory() || before.isFile() !== after.isFile() ||
          (before.mode & 0o777) !== (after.mode & 0o777)) {
        throw proofCopyFailure("proof_source_copy_parity_failed", source);
      }
      if (before.isFile()) {
        let sourceDigest;
        let targetDigest;
        try {
          sourceDigest = createHash("sha256").update(readFileSync(source)).digest("hex");
        } catch (error) {
          throw proofCopyFailure("proof_source_entry_unreadable", source, error);
        }
        try {
          targetDigest = createHash("sha256").update(readFileSync(target)).digest("hex");
        } catch (error) {
          throw proofCopyFailure("proof_source_entry_copy_failed", target, error);
        }
        if (sourceDigest !== targetDigest) throw proofCopyFailure("proof_source_copy_parity_failed", target);
      }
    }
  }
  return counts;
}

export function proofCopyFailure(code, source, cause = null) {
  return Object.assign(new Error(`proof source copy ${code}: ${source}${cause ? ` (${cause.message})` : ""}`),
    { code, path: source, cause, detail: { path: source, cause: cause?.code ?? null } });
}
