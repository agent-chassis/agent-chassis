import { TextDecoder } from "node:util";

import { normalizeSidecarRepoPath } from "./sidecar-paths.mjs";
import { isConcreteSidecarCommit } from "./sidecar-repository-identity.mjs";
import { runSidecarGit } from "./sidecar-status.mjs";

const STATUS_KIND = Object.freeze({ A: "added", D: "deleted", M: "modified", T: "modified" });
const FATAL_UTF8 = new TextDecoder("utf-8", { fatal: true });

export function decodeSidecarCommittedNameStatus(bytes) {
  if (typeof bytes !== "string" && !Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    throw new TypeError("committed diff output must be text or bytes");
  }
  const fields = (typeof bytes === "string" ? bytes : FATAL_UTF8.decode(bytes)).split("\0");
  if (fields.at(-1) !== "") throw new Error("committed diff output is not NUL terminated");
  fields.pop();
  if (fields.length % 2 !== 0) throw new Error("committed diff output contains a partial record");
  const records = [];
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index];
    const changeKind = STATUS_KIND[status];
    if (!changeKind) throw new Error(`unsupported committed diff status: ${status}`);

    const relativePath = normalizeSidecarRepoPath(fields[index + 1]);
    records.push({
      changeKind,
      oldPath: status === "A" ? null : relativePath,
      newPath: status === "D" ? null : relativePath
    });
  }
  return records;
}

function isMissingGitObject(error) {
  return /not a valid object name|bad object|unknown revision|invalid object name/i.test(
    `${error?.message ?? ""}\n${error?.stderr ?? ""}`
  );
}

export async function compareSidecarCommittedTrees({ repoRoot, fromCommit, toCommit }) {
  if (fromCommit === null || fromCommit === undefined) {
    if (!isConcreteSidecarCommit(toCommit)) throw new TypeError("target commit must be concrete");
    return { clean: true, records: [] };
  }
  if (!isConcreteSidecarCommit(fromCommit) || !isConcreteSidecarCommit(toCommit)) {
    throw new TypeError("committed diff endpoints must be concrete commits");
  }
  await runSidecarGit(repoRoot, ["--no-replace-objects", "cat-file", "-e", `${toCommit}^{commit}`]);
  try {
    await runSidecarGit(repoRoot, [
      "--no-replace-objects", "cat-file", "-e", `${fromCommit}^{commit}`
    ]);
  } catch (error) {
    if (isMissingGitObject(error)) {
      return { clean: true, reason: "missing_predecessor", records: [] };
    }
    throw error;
  }
  const stdout = await runSidecarGit(repoRoot, [
    "--no-replace-objects",
    "diff",
    "--name-status",
    "-z",
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
    `${fromCommit}^{tree}`,
    `${toCommit}^{tree}`,
    "--"
  ], { maxBuffer: 16 * 1024 * 1024 });
  return { clean: false, reason: null, records: decodeSidecarCommittedNameStatus(stdout) };
}
