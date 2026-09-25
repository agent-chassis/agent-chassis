

import path from "node:path";
import { accessSync, constants as fsConstants, statSync } from "node:fs";

export function resolvePackageAssetExecutable(assetDir, name, onUnavailable) {
  const executable = path.join(assetDir, name);
  let dirStat;
  let fileStat;
  try {
    dirStat = statSync(assetDir);
    fileStat = statSync(executable);
    accessSync(executable, fsConstants.X_OK);
  } catch (error) {
    return onUnavailable({ asset: executable, errno: error?.code ?? null, reason: "unavailable" });
  }
  if (!dirStat.isDirectory() || !fileStat.isFile()) {
    return onUnavailable({ asset: executable, errno: null, reason: "not_regular_executable" });
  }
  return executable;
}

export function prependPathEntry(pathEnv, entry) {
  const entries = typeof pathEnv === "string" && pathEnv.length > 0 ? pathEnv.split(path.delimiter) : [];
  return [entry, ...entries.filter((candidate) => candidate !== entry)].join(path.delimiter);
}
