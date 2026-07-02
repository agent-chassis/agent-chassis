

import { readFile, stat } from "node:fs/promises";

export function isNonEmptyStringInternal(v) {
  return typeof v === "string" && v.length > 0;
}

export async function readFileIfExists(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export async function assertFile(file, message) {
  if (!(await pathExists(file))) {
    throw new Error(`${message}: ${file}`);
  }
}

export async function pathExists(file) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function isDirectory(file) {
  try {
    return (await stat(file)).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return false;
    }
    throw error;
  }
}

export async function readDirSafe(dir) {
  try {
    return (await import("node:fs/promises")).readdir(dir);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return [];
    }
    throw error;
  }
}

export function tailLines(content, count) {
  if (!content) {
    return "";
  }
  const lines = content.split("\n");
  return lines.slice(Math.max(0, lines.length - count - 1)).join("\n");
}

export function writeLine(stream, value) {
  writeRaw(stream, `${value}\n`);
}

export function writeRaw(stream, value) {
  if (stream?.write) {
    stream.write(value);
  } else {
    process.stdout.write(value);
  }
}

export function writeStderr(stream, value) {
  if (stream?.write) {
    stream.write(value);
  } else {
    process.stderr.write(value);
  }
}
