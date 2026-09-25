

import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

export function isContained(candidate, parent) {
  const relative = path.relative(parent, candidate);
  const traversesParent = relative === ".." || relative.startsWith(`..${path.sep}`);
  return relative === "" || (!traversesParent && !path.isAbsolute(relative));
}

export function pathsIntersect(left, right) {
  return isContained(left, right) || isContained(right, left);
}

export async function partialRealpath(candidate) {
  let existing = path.resolve(candidate);
  const suffix = [];
  while (true) {
    try {
      const resolvedExisting = await realpath(existing);
      return path.resolve(resolvedExisting, ...suffix.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      try {
        await lstat(existing);
      } catch (inspectionError) {
        if (inspectionError?.code !== "ENOENT") throw inspectionError;
        const parent = path.dirname(existing);
        if (parent === existing) throw error;
        suffix.push(path.basename(existing));
        existing = parent;
        continue;
      }
      throw error;
    }
  }
}
