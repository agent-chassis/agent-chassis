

import { lstatSync, readdirSync } from "node:fs";

export function inspectDependencyMountpoint(destination) {
  let stat;
  try {
    stat = lstatSync(destination);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return Object.freeze({ state: "absent", errno: error.code });
    }
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    return Object.freeze({ state: "occupied", kind: stat.isSymbolicLink() ? "symlink" : "file" });
  }
  if (readdirSync(destination).length !== 0) {
    return Object.freeze({ state: "occupied", kind: "directory" });
  }
  return Object.freeze({ state: "empty_directory",
    identity: Object.freeze({ dev: String(stat.dev), ino: String(stat.ino) }) });
}
