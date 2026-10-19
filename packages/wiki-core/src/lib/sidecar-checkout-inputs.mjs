import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { filterSidecarSourcePaths, validateExistingSidecarPath, validateVirtualSidecarPath } from "./sidecar-paths.mjs";
import { runSidecarGit } from "./sidecar-status.mjs";

export const checkoutContentIdentity = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function collectSidecarCheckoutInputs(repoRoot, { selectedPaths = null } = {}) {
  const selected = selectedPaths === null ? null : new Set(selectedPaths);
  if (selected !== null) for (const value of selected) validateVirtualSidecarPath(value);

  const raw = selected?.size === 0 ? "" : await runSidecarGit(repoRoot,
    ["--literal-pathspecs", "ls-files", "-z", "--stage", "--others", "--exclude-standard",
      ...(selected === null ? [] : ["--", ...selected])],
    { maxBuffer: 64 * 1024 * 1024 });
  const listed = raw.split("\0").filter(Boolean).map((record) => {
    const entry = /^(\d{6}) [0-9a-f]+ \d\t([\s\S]+)$/u.exec(record);
    return entry ? { path: entry[2], mode: entry[1] } : { path: record, mode: null };
  });
  const paths = [...new Set(listed.map((entry) => entry.path))]
    .filter(value => selected === null || selected.has(value)).sort();
  const gitlinks = new Set(listed.filter((entry) => entry.mode === "160000").map((entry) => entry.path));
  const filtered = filterSidecarSourcePaths(paths);
  const files = [];
  for (const value of filtered.included) {
    try {
      const target = path.join(repoRoot, value);
      const info = await lstat(target);
      if (!info.isFile() && !info.isSymbolicLink()) continue;
      if (info.isFile()) await validateExistingSidecarPath({ dir: repoRoot, inputPath: value });
      const bytes = info.isSymbolicLink() ? Buffer.from(await readlink(target)) : await readFile(target);
      const mode = info.isSymbolicLink() ? "120000" : info.mode & 0o111 ? "100755" : "100644";
      const blob_oid = checkoutContentIdentity(bytes);
      files.push({ path: value, mode, blob_oid, input_identity: `${blob_oid}:${mode}` });
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
  }
  return { tracked: files, tracked_paths: files.map((file) => file.path), files,
    tracked_count: paths.length, source_count: files.length,
    symlink_count: files.filter(({ mode }) => mode === "120000").length,
    gitlink_count: filtered.included.filter((value) => gitlinks.has(value)).length,
    rejected: filtered.rejected,
    identity: checkoutContentIdentity(JSON.stringify(files)) };
}

export function compareSidecarCheckoutFiles(prior, current) {
  const before = new Map(prior.map((file) => [file.path, file.input_identity]));
  const after = new Map(current.map((file) => [file.path, file.input_identity]));
  return { records: [...new Set([...before.keys(), ...after.keys()])].sort().flatMap((value) =>
    before.get(value) === after.get(value) ? [] : [{
      changeKind: !before.has(value) ? "added" : !after.has(value) ? "deleted" : "modified",
      oldPath: before.has(value) ? value : null, newPath: after.has(value) ? value : null }]) };
}

export function sidecarCheckoutObservationIdentity(publication, checkoutIdentity = publication?.base_coverage?.checkout_identity,
  providerInputsChanged = false) {
  if (typeof checkoutIdentity !== "string" || !publication?.store_incarnation) return null;
  return JSON.stringify([checkoutIdentity, publication.store_incarnation, publication.sequence,
    providerInputsChanged]);
}
