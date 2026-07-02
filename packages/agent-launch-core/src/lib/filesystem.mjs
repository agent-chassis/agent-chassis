import path from "node:path";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";

export async function ensureDirectory(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

export async function writeAtomic(targetPath, content, options = {}) {
  const dirPath = path.dirname(targetPath);
  await ensureDirectory(dirPath);
  const tempPath = path.join(
    dirPath,
    `.tmp-${path.basename(targetPath)}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  const handle = await open(tempPath, "w", options.mode);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tempPath, targetPath);
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function writeJsonAtomic(filePath, value, options = {}) {
  await writeAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, options);
}

export function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export async function sha256File(filePath) {
  return sha256(await readFile(filePath));
}

export async function canonicalizePath(filePath) {
  return realpath(filePath);
}

export function assertPathInside(rootPath, candidatePath, message) {
  const relativePath = path.relative(rootPath, candidatePath);
  if (relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))) {
    return;
  }
  throw new Error(message);
}

export async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function removePath(filePath) {
  await rm(filePath, { recursive: true, force: true });
}

export async function copyTree(sourceDir, targetDir) {
  await ensureDirectory(targetDir);
  const entries = await (await import("node:fs/promises")).readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyTree(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await ensureDirectory(path.dirname(targetPath));
      await copyFile(sourcePath, targetPath);
    }
  }
}
