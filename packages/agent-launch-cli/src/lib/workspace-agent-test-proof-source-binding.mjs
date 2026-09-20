import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;

export function authenticateSavedProofSource({ authority, snapshot, source, fail }) {
  const relative = path.relative(authority.worktree_path, source.file).split(path.sep).join('/');
  if (relative.startsWith('../') || path.isAbsolute(relative) || !relative.startsWith('wiki/contracts/')) {
    fail('test_proof_saved_source_binding_mismatch', 'Saved source is outside the authenticated candidate');
  }
  let bytes;
  try { bytes = readFileSync(source.file); }
  catch (error) {
    fail('test_proof_saved_source_stale', 'Saved source member is no longer readable', {
      repository_relative_path: relative, filesystem_error_code: error.code ?? null });
  }
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (authority.kind !== 'orchestrator_git_commit' && !snapshot.entries.some(entry =>
    entry.kind === 'file' && entry.path === relative && entry.digest === digest)) {
    fail('test_proof_saved_source_binding_mismatch', 'Saved source is not a member of the launcher snapshot');
  }
  let content;
  try { content = JSON.parse(bytes); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    fail('test_proof_saved_source_binding_mismatch', 'Saved source bytes are no longer valid JSON', {
      repository_relative_path: relative, cause_code: 'invalid_json' });
  }
  const contentDigest = `sha256:${createHash('sha256').update(`${JSON.stringify(content, null, 2)}\n`).digest('hex')}`;
  if (contentDigest !== source.content_digest) fail('test_proof_saved_source_binding_mismatch',
    'Canonical source read differs from authenticated source bytes');
  return Object.freeze({ repository_relative_path: relative, byte_digest: digest,
    content_digest: source.content_digest });
}

export function assertGenerationBoundToSnapshot(selection, snapshot, wkId, authority, fail) {
  const carriers = selection?.controlled_contract_generation_carriers;
  if (!Array.isArray(carriers) || carriers.length === 0 ||
      selection.controlled_contract_generation_carrier_count !== carriers.length ||
      carriers.some((entry) => typeof entry?.filename !== "string" ||
        !DIGEST_RE.test(entry?.content_digest ?? "") ||
        entry?.source_member?.schema_version !==
          "controlled-contract-authenticated-runtime-member.v1" ||
        entry.source_member.logical_filename !== entry.filename ||
        entry.source_member.content_digest !== entry.content_digest ||
        !["manifest_generation", "legacy_root"].includes(
          entry.source_member.storage_mode
        ) ||
        typeof entry.source_member.repository_relative_path !== "string" ||
        entry.source_member.repository_relative_path.length === 0 ||
        entry.source_member.repository_relative_path.length > 4096 ||
        path.posix.isAbsolute(entry.source_member.repository_relative_path) ||
        entry.source_member.repository_relative_path.includes("\\") ||
        entry.source_member.repository_relative_path.split("/").some((part) =>
          part === "" || part === "." || part === "..") ||
        (entry.source_member.storage_mode === "manifest_generation"
          ? !/^[a-f0-9]{64}$/u.test(entry.source_member.manifest_generation ?? "") ||
            !DIGEST_RE.test(entry.source_member.manifest_content_digest ?? "")
          : entry.source_member.manifest_generation !== null ||
            entry.source_member.manifest_content_digest !== null))) fail(
    "test_proof_controlled_contract_generation_invalid",
    "controlled-contract generation requires its complete authenticated carrier population"
  );
  const normalized = carriers.map((entry) => ({
    filename: entry.filename,
    content_digest: entry.content_digest
  })).sort((left, right) => left.filename.localeCompare(right.filename));
  const observedOrder = carriers.map((entry) => ({
    filename: entry.filename,
    content_digest: entry.content_digest
  }));
  if (JSON.stringify(normalized) !== JSON.stringify(observedOrder)) fail(
    "test_proof_controlled_contract_generation_invalid",
    "controlled-contract generation carrier population must be canonical and sorted"
  );
  for (const carrier of normalized) {
    const sourceMember = carriers.find(({ filename }) => filename === carrier.filename)
      .source_member;
    const sourceDigest = authority.kind === "orchestrator_git_commit"
      ? (() => {
          const sourcePath = path.resolve(
            authority.worktree_path, sourceMember.repository_relative_path
          );
          if (!sourcePath.startsWith(`${authority.worktree_path}${path.sep}`)) return null;
          try {
            return `sha256:${createHash("sha256").update(readFileSync(sourcePath)).digest("hex")}`;
          } catch {
            return null;
          }
        })()
      : new Map(snapshot.entries
        .filter((entry) => entry.kind === "file")
        .map((entry) => [entry.path, entry.digest]))
        .get(sourceMember.repository_relative_path);
    if (sourceDigest !== carrier.content_digest) fail(
      "test_proof_controlled_contract_generation_snapshot_mismatch",
      "controlled-contract generation does not describe the authenticated source snapshot",
      { filename: carrier.filename, storage_mode: sourceMember.storage_mode }
    );
  }
  const body = {
    schema_version: "controlled-contract-generation.v1",
    wk_id: wkId,
    carriers: normalized
  };
  const generationDigest = `sha256:${createHash("sha256")
    .update(`${JSON.stringify(body, null, 2)}\n`, "utf8").digest("hex")}`;
  if (generationDigest !== selection.controlled_contract_generation) fail(
    "test_proof_controlled_contract_generation_digest_mismatch",
    "controlled-contract generation digest does not authenticate its complete carrier population"
  );
}
