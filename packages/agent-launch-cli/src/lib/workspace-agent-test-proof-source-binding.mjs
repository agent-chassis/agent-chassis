import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;

const INSTALLATION_BINDING_HOOK = Symbol.for("agent-chassis.node-test.selected-installation-binding");
const moduleDigest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const installedFile = (configuration, root) => path.join(root, "node_modules",
  configuration.package_name, configuration.package_relative_path);

export function describeNodeTestInstalledSource({ worktree, modulePath, recordPath }) {
  const file = path.join(worktree, modulePath);
  for (let directory = path.dirname(file); directory.startsWith(worktree + path.sep) || directory === worktree;
    directory = path.dirname(directory)) {
    const manifest = path.join(directory, "package.json");
    if (!existsSync(manifest)) continue;
    const { name } = JSON.parse(readFileSync(manifest, "utf8"));
    if (typeof name !== "string" || !/^@?[a-z0-9._-]+(?:\/[a-z0-9._-]+)?$/u.test(name)) return null;
    return { module_path: modulePath, package_name: name,
      candidate_module_file: file,
      package_relative_path: path.relative(directory, file).split(path.sep).join("/"),
      candidate_module_digest: moduleDigest(readFileSync(file)), record_path: recordPath };
  }
  return null;
}

export function nodeTestInstalledSourceImport(configuration) {
  const url = new URL(import.meta.url);
  url.searchParams.set("node_test_source_binding", JSON.stringify(configuration));
  return url.href;
}

function recordInstalledSource(configuration, record) {
  appendFileSync(configuration.record_path, `${JSON.stringify(record)}\n`);
}

export function installNodeTestSourceBinding(configuration) {
  if (configuration.installation_root === undefined) {
    globalThis[INSTALLATION_BINDING_HOOK] = ({ installRoot, mode, publishCandidateModule }) => {
      if (mode !== "isolated_local_tarball_install") throw new Error("node:test source binding requires the selected local-tarball installation");
      const root = realpathSync(installRoot);
      const file = installedFile(configuration, root);
      const manifest = JSON.parse(readFileSync(path.join(root, "node_modules", configuration.package_name, "package.json"), "utf8"));
      const candidateBytes = readFileSync(configuration.candidate_module_file);
      if (moduleDigest(candidateBytes) !== configuration.candidate_module_digest) throw Object.assign(
        new Error("candidate module changed before its installation was selected"), {
          code: "test_proof_installed_source_binding_invalid", detail: { reason: "candidate_module_changed", module_path: configuration.module_path } });

      const published = publishCandidateModule(configuration.module_path, candidateBytes.toString("utf8"));
      const publishedDigest = moduleDigest(published);
      const actual = moduleDigest(readFileSync(file));
      const reason = realpathSync(file) !== file ? "installed_module_origin_mismatch"
        : manifest.name !== configuration.package_name ? "package_identity_mismatch"
        : actual !== publishedDigest ? "module_bytes_mismatch" : null;
      const binding = { ...configuration, installation_root: root, installed_module_path: realpathSync(file),
        published_module_digest: publishedDigest };
      recordInstalledSource(configuration, { kind: "selection", installation_root: root,
        installed_module_path: binding.installed_module_path, candidate_module_digest: configuration.candidate_module_digest,
        published_module_digest: publishedDigest, installed_module_digest: actual, reason });
      if (reason !== null) throw Object.assign(new Error(`selected installed module binding failed: ${reason}`), {
        code: "test_proof_installed_source_binding_invalid", detail: { reason, module_path: configuration.module_path } });
      return ["--enable-source-maps", `--import=${nodeTestInstalledSourceImport(binding)}`];
    };
  } else {
    register(new URL("./workspace-agent-test-proof-source-binding.mjs", import.meta.url), { data: configuration });
  }
}

let installedConfiguration = null;
export function initialize(configuration) { installedConfiguration = configuration; }

export async function load(url, context, nextLoad) {
  const loaded = await nextLoad(url, context);
  if (installedConfiguration === null || !url.startsWith("file:")) return loaded;
  const file = fileURLToPath(url);
  if (file !== installedConfiguration.installed_module_path) return loaded;
  const actual = loaded.source === null || loaded.source === undefined ? null : moduleDigest(loaded.source);
  const reason = actual !== installedConfiguration.published_module_digest ? "module_bytes_mismatch" : null;
  recordInstalledSource(installedConfiguration, { kind: "load", installation_root: installedConfiguration.installation_root,
    installed_module_path: file, candidate_module_digest: installedConfiguration.candidate_module_digest,
    published_module_digest: installedConfiguration.published_module_digest, installed_module_digest: actual, reason });
  if (reason !== null) throw Object.assign(new Error(`installed module changed before execution: ${file}`), {
    code: "test_proof_installed_source_binding_invalid" });

  const source = Buffer.isBuffer(loaded.source) || loaded.source instanceof Uint8Array
    ? Buffer.from(loaded.source).toString("utf8") : loaded.source;
  const vlq = (value) => {
    let encoded = "";
    let unsigned = value < 0 ? (-value * 2) + 1 : value * 2;
    do {
      let digit = unsigned % 32;
      unsigned = Math.floor(unsigned / 32);
      if (unsigned > 0) digit += 32;
      encoded += "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[digit];
    } while (unsigned > 0);
    return encoded;
  };
  let previousColumn = 0;

  const mappings = source.split(/(?<=\n)/u).map((line, index) => {
    const finalColumn = Math.max(0, line.length - 1);
    const mapping = `${index === 0 ? "AAA" : "AAC"}${vlq(-previousColumn)}` + ",CAAC".repeat(finalColumn);
    previousColumn = finalColumn;
    return mapping;
  }).join(";");
  const sourceMap = { version: 3, sources: [url], sourcesContent: [source], names: [], mappings };
  return { ...loaded, source: `${source}\n//# sourceMappingURL=data:application/json;base64,${
    Buffer.from(JSON.stringify(sourceMap)).toString("base64")}\n` };
}

export function projectNodeTestInstalledCoverage(file, configuration) {
  if (configuration === null || configuration === undefined || !file.includes(`${path.sep}node_modules${path.sep}`)) return null;
  const suffix = path.join("node_modules", configuration.package_name, configuration.package_relative_path);
  if (!file.endsWith(path.sep + suffix)) return null;
  const records = installedSourceRecords(configuration);
  const failure = records.find(({ kind }) => kind === "failure");
  if (failure !== undefined) return { path: configuration.module_path,
    source_binding: { status: "refused", reason: failure.reason } };
  const selections = records.filter(({ kind }) => kind === "selection");
  const selected = selections[0];
  const loaded = records.find((record) => record.kind === "load" && record.installed_module_path === file);
  const reason = selected === undefined ? "binding_missing"
    : selections.some((row) => row.installation_root !== selected.installation_root) ? "installation_mismatch"
      : file !== selected.installed_module_path ? "installation_mismatch"
        : selected.reason ?? loaded?.reason ?? (loaded === undefined ? "loaded_module_binding_missing"
          : [selected, loaded].some((row) => row.candidate_module_digest !== configuration.candidate_module_digest ||
            row.published_module_digest !== selected.published_module_digest ||
            row.installed_module_digest !== selected.published_module_digest) ? "module_bytes_mismatch" : null);
  return { path: configuration.module_path, source_binding: reason !== null ? { status: "refused", reason }
    : { status: "authenticated", installation_root: selected.installation_root,
      installed_module_path: file, candidate_module_digest: configuration.candidate_module_digest,
      published_module_digest: selected.published_module_digest,
      installed_module_digest: loaded.installed_module_digest } };
}

function installedSourceRecords(configuration) {
  if (existsSync(configuration.record_path)) {
    const bytes = readFileSync(configuration.record_path);
    if (bytes.length > 65536) return [{ kind: "failure", reason: "binding_capture_oversized" }];
    let records;
    try { records = bytes.toString("utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)); }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return [{ kind: "failure", reason: "binding_capture_invalid_json" }];
    }
    if (records.length > 128) return [{ kind: "failure", reason: "binding_capture_oversized" }];
    if (records.some((record) => record === null || typeof record !== "object" ||
      !["selection", "load"].includes(record.kind) ||
      Object.keys(record).some((key) => !["kind", "installation_root", "installed_module_path",
        "candidate_module_digest", "published_module_digest", "installed_module_digest", "reason"].includes(key)) ||
      typeof record.installation_root !== "string" || !path.isAbsolute(record.installation_root) ||
      typeof record.installed_module_path !== "string" || !path.isAbsolute(record.installed_module_path) ||
      !DIGEST_RE.test(record.candidate_module_digest ?? "") ||
      !DIGEST_RE.test(record.published_module_digest ?? "") ||
      !(record.installed_module_digest === null || DIGEST_RE.test(record.installed_module_digest ?? "")) ||
      ![null, "installed_module_origin_mismatch", "package_identity_mismatch", "module_bytes_mismatch"].includes(record.reason))) {
      return [{ kind: "failure", reason: "binding_capture_invalid_record" }];
    }
    return records;
  }
  return [];
}

export function nodeTestInstalledSourceBindingFailure(configuration) {
  if (configuration === null) return null;
  const records = installedSourceRecords(configuration);
  return records.find(({ reason }) => reason !== null && reason !== undefined)?.reason ??
    (records.some(({ kind }) => kind === "selection") && !records.some(({ kind }) => kind === "load")
      ? "loaded_module_binding_missing" : null);
}

export function nodeTestInstalledSourceSelected(configuration) {
  return configuration !== null && installedSourceRecords(configuration).some(({ kind }) => kind === "selection");
}

const preloadConfiguration = new URL(import.meta.url).searchParams.get("node_test_source_binding");
if (preloadConfiguration !== null) installNodeTestSourceBinding(JSON.parse(preloadConfiguration));

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
