import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import {
  classifyControlledContractGenerationRepositoryPath,
  validateControlledContractAttachmentGenerationDescriptors
} from "@agent-chassis/wiki-core/src/lib/controlled-contract-tools.mjs";
import { parseControlledContractCarrierSetManifest } from
  "@agent-chassis/wiki-core/src/lib/controlled-contract-carrier-set-manifest.mjs";

const RAW_DIFF_HEADER_PATTERN =
  /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-9a-f]{40}|[0-9a-f]{64}) ([A-Z][0-9]*)$/;

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function createControlledContractGenerationTreeOperations({
  fail,
  codes,
  runGitOrFail,
  runGitOrFailAsync,
  stdoutBytes,
  deepFreeze,
  isOwnedError,
  gitInertConfig
}) {
  function splitNul(bytes) {
    const fields = [];
    let start = 0;
    for (let index = 0; index < bytes.length; index += 1) {
      if (bytes[index] !== 0) continue;
      fields.push(bytes.subarray(start, index));
      start = index + 1;
    }
    if (start !== bytes.length) {
      fail(codes.STRUCTURAL_DIFF_INVALID,
        "Git emitted a malformed non-NUL-terminated byte record");
    }
    return fields;
  }

  function decodeCanonicalPath(bytes) {
    const value = bytes.toString("utf8");
    if (!Buffer.from(value, "utf8").equals(bytes) || value.length === 0 ||
        value.includes("\0")) {
      fail(codes.STRUCTURAL_DIFF_INVALID,
        "Git emitted a malformed path byte record");
    }
    return value;
  }

  function parseLsTree(bytes) {
    const records = splitNul(bytes);
    const entries = [];
    for (const record of records) {
      if (record.length === 0) {
        fail(codes.STORED_GENERATION_INVALID,
          "stored-tree enumeration returned an empty byte record");
      }
      const tab = record.indexOf(9);
      if (tab <= 0) {
        fail(codes.STORED_GENERATION_INVALID,
          "stored-tree enumeration returned a malformed record");
      }
      const header = record.subarray(0, tab).toString("ascii");
      const match = /^([0-7]{6}) ([a-z]+) ([0-9a-f]{40}|[0-9a-f]{64})$/.exec(header);
      if (match === null) {
        fail(codes.STORED_GENERATION_INVALID,
          "stored-tree enumeration returned a malformed header");
      }
      entries.push({
        mode: match[1],
        type: match[2],
        oid: match[3],
        path: decodeCanonicalPath(record.subarray(tab + 1))
      });
    }
    return entries;
  }

  function parseStructuralDiff(bytes) {
    const fields = splitNul(bytes);
    const paths = [];
    for (let index = 0; index < fields.length;) {
      if (fields[index].length === 0) {
        fail(codes.STRUCTURAL_DIFF_INVALID,
          "structural diff returned an empty byte record");
      }
      const header = fields[index].toString("ascii");
      if (!RAW_DIFF_HEADER_PATTERN.test(header) || index + 1 >= fields.length) {
        fail(codes.STRUCTURAL_DIFF_INVALID,
          "structural diff returned a malformed byte record");
      }
      const status = RAW_DIFF_HEADER_PATTERN.exec(header)[5];
      if (status.startsWith("R") || status.startsWith("C")) {
        fail(codes.STRUCTURAL_DIFF_INVALID,
          "structural diff unexpectedly returned a rename or copy record");
      }
      paths.push(decodeCanonicalPath(fields[index + 1]));
      index += 2;
    }
    return paths;
  }

  function canonicalManifestPath(wkId, focus) {
    return `wiki/contracts/${focus === null ? wkId : `${wkId}-${focus}`}` +
      ".carrier-set-manifest.json";
  }

  function readBoundArtifact(binding, repositoryPath, unavailable, changed) {
    const absolutePath = path.join(binding.repository, ...repositoryPath.split("/"));
    let entry;
    let resolvedPath;
    let bytes;
    try {
      entry = lstatSync(absolutePath);
      resolvedPath = realpathSync(absolutePath);
      bytes = readFileSync(absolutePath);
    } catch (error) {
      fail(codes.SOURCE_CHANGED, unavailable, {
        path: repositoryPath,
        cause_code: error?.code ?? null
      });
    }
    if (!entry.isFile() || entry.isSymbolicLink() || resolvedPath !== absolutePath) {
      fail(codes.SOURCE_CHANGED, changed, { path: repositoryPath });
    }
    return bytes;
  }

  function resolveBoundManifestArtifacts(binding) {
    const artifacts = [];
    for (const selected of binding.resolved_generation.manifest_selection ?? []) {
      const repositoryPath = canonicalManifestPath(
        binding.record_id, selected.focus ?? null);
      const bytes = readBoundArtifact(binding, repositoryPath,
        "selected controlled-contract manifest became unavailable",
        "selected controlled-contract manifest changed after generation binding");
      if (sha256(bytes) !== selected.manifest_content_digest) {
        fail(codes.SOURCE_CHANGED,
          "selected controlled-contract manifest changed after generation binding", {
            path: repositoryPath
          });
      }
      artifacts.push({
        path: repositoryPath,
        content_digest: selected.manifest_content_digest,
        bytes
      });
    }
    return artifacts.sort((left, right) => left.path.localeCompare(right.path));
  }

  function resolveBoundRuntimePackageArtifacts(binding, manifestArtifacts = null) {
    manifestArtifacts ??= resolveBoundManifestArtifacts(binding);
    const manifestsByPath = new Map(manifestArtifacts.map((artifact) =>
      [artifact.path, artifact]));
    const descriptorsByBasename = new Map(binding.descriptors.map((descriptor) =>
      [descriptor.basename, descriptor]));
    const artifacts = [];
    const selectedPaths = new Set();
    for (const selected of binding.resolved_generation.manifest_selection ?? []) {
      const visiblePath = canonicalManifestPath(binding.record_id, selected.focus ?? null);
      const visible = manifestsByPath.get(visiblePath);
      if (visible === undefined) {
        fail(codes.SOURCE_CHANGED,
          "selected controlled-contract manifest became unavailable", { path: visiblePath });
      }
      let manifest;
      try {
        manifest = parseControlledContractCarrierSetManifest(visible.bytes, {
          wkId: binding.record_id,
          focus: selected.focus ?? null,
          generation: selected.generation
        });
      } catch (error) {
        fail(codes.SOURCE_CHANGED,
          "selected controlled-contract manifest became invalid after generation binding", {
            path: visiblePath,
            cause_code: error?.code ?? null
          });
      }
      const generationPrefix = `wiki/contracts/${manifest.generation.path}`;
      const embeddedPath = `${generationPrefix}/manifest.json`;
      if (selectedPaths.has(embeddedPath)) {
        fail(codes.SOURCE_CHANGED,
          "selected controlled-contract runtime package contains a duplicate path", {
            path: embeddedPath
          });
      }
      selectedPaths.add(embeddedPath);
      artifacts.push({ ...visible, path: embeddedPath });
      for (const member of manifest.carrier_census) {
        if (member.member_kind !== "carrier" && member.member_kind !== "evaluation_input") {
          continue;
        }
        const descriptor = descriptorsByBasename.get(member.filename);
        const runtimePath = `wiki/contracts/${member.path}`;
        if (descriptor === undefined || descriptor.focus !== (selected.focus ?? null) ||
            descriptor.content_digest !== member.content_digest ||
            descriptor.byte_length !== member.byte_length ||
            selectedPaths.has(runtimePath)) {
          fail(codes.SOURCE_CHANGED,
            "selected controlled-contract runtime package contradicts its bound generation", {
              path: runtimePath,
              basename: member.filename
            });
        }
        const bytes = Buffer.from(descriptor.bytes_base64, "base64");
        selectedPaths.add(runtimePath);
        artifacts.push({
          path: runtimePath,
          content_digest: descriptor.content_digest,
          bytes
        });
      }
    }
    return artifacts.sort((left, right) => left.path.localeCompare(right.path));
  }

  function runtimePackageMatchesTree({ runGit, binding, treeish, artifacts }) {
    for (const artifact of artifacts) {
      const resolved = runGit({
        gitDir: binding.git_dir,
        args: ["--no-replace-objects", "rev-parse", "--verify", "--quiet",
          `${treeish}:${artifact.path}`]
      });
      if (resolved?.ok !== true) return false;
      const oid = stdoutBytes(resolved).toString("utf8").trim();
      if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(oid) || /^0+$/u.test(oid)) {
        fail(codes.STORED_GENERATION_INVALID,
          "stored controlled-contract runtime package blob identity is malformed", {
            path: artifact.path
          });
      }
      const blob = runGitOrFail(runGit, { gitDir: binding.git_dir },
        ["--no-replace-objects", "cat-file", "blob", oid],
        "stored controlled-contract runtime package blob could not be read");
      const bytes = stdoutBytes(blob);
      if (sha256(bytes) !== artifact.content_digest || !bytes.equals(artifact.bytes)) {
        return false;
      }
    }
    return true;
  }

  function resolveBoundRecordArtifact(binding) {
    const repositoryPath = `wiki/work-records/${binding.record_id}.json`;
    const bytes = readBoundArtifact(binding, repositoryPath,
      "canonical WK source became unavailable after generation binding",
      "canonical WK source changed after generation binding");
    if (sha256(bytes) !== binding.record_source_digest) {
      fail(codes.SOURCE_CHANGED,
        "canonical WK source changed after generation binding");
    }
    return { path: repositoryPath, content_digest: binding.record_source_digest, bytes };
  }

  function manifestPopulationMatches(observations, artifacts) {
    return observations.length === artifacts.length && observations.every((observed, index) =>
      observed.path === artifacts[index].path &&
      observed.content_digest === artifacts[index].content_digest &&
      observed.bytes_base64 === artifacts[index].bytes.toString("base64"));
  }

  function recordObservationMatches(observation, artifact) {
    return observation.path === artifact.path &&
      observation.content_digest === artifact.content_digest &&
      observation.bytes_base64 === artifact.bytes.toString("base64");
  }

  function manifestPathsFromTree({ runGit, binding, treeish }) {
    const listing = runGitOrFail(runGit, {
      repo: binding.repository, gitDir: binding.git_dir
    }, [
      "--no-replace-objects", ...gitInertConfig,
      "ls-tree", "-r", "-z", "--full-tree", treeish, "--", "wiki/contracts"
    ], "stored controlled-contract manifests could not be enumerated");
    const pattern = new RegExp(
      `^wiki/contracts/${binding.record_id}(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?` +
        "\\.carrier-set-manifest\\.json$", "u");
    const paths = [];
    for (const entry of parseLsTree(stdoutBytes(listing))) {
      if (!pattern.test(entry.path)) continue;
      if (entry.type !== "blob" || entry.mode !== "100644") {
        fail(codes.STORED_GENERATION_INVALID,
          "stored controlled-contract manifest is not an ordinary Git blob", {
            path: entry.path
          });
      }
      paths.push(entry.path);
    }
    return paths.sort();
  }

  function blobEntriesAtTree({ runGit, binding, treeish, paths }) {
    const listing = runGitOrFail(runGit, { repo: binding.repository, gitDir: binding.git_dir }, [
      "--no-replace-objects", ...gitInertConfig, "--literal-pathspecs",
      "ls-tree", "-z", "--full-tree", treeish, "--", ...paths
    ], "controlled-contract runtime package entries could not be enumerated");
    return new Map(parseLsTree(stdoutBytes(listing))
      .filter((entry) => entry.type === "blob")
      .map((entry) => [entry.path, { mode: entry.mode, oid: entry.oid }]));
  }

  function selectedRuntimePackageAtTree({ runGit, binding, treeish, manifestPath }) {
    const stem = manifestPath.slice(`wiki/contracts/${binding.record_id}`.length,
      -".carrier-set-manifest.json".length);
    const focus = stem === "" ? null : stem.slice(1);
    const visible = blobEntriesAtTree({ runGit, binding, treeish, paths: [manifestPath] })
      .get(manifestPath);
    if (visible === undefined) return null;
    const visibleBytes = stdoutBytes(runGitOrFail(runGit, { gitDir: binding.git_dir },
      ["--no-replace-objects", "cat-file", "blob", visible.oid],
      "stored controlled-contract manifest blob could not be read"));
    let manifest;
    try {
      manifest = parseControlledContractCarrierSetManifest(visibleBytes, {
        wkId: binding.record_id, focus
      });
    } catch (error) {
      fail(codes.STORED_GENERATION_INVALID,
        "a visible controlled-contract manifest in the WK history is invalid", {
          commit: treeish,
          path: manifestPath,
          cause_code: error?.code ?? null,
          cause_message: error?.message ?? null
        });
    }
    const prefix = `wiki/contracts/${manifest.generation.path}`;
    const expected = new Map([[`${prefix}/manifest.json`, {
      content_digest: sha256(visibleBytes), byte_length: visibleBytes.byteLength
    }]]);
    for (const member of manifest.carrier_census) {
      if (member.member_kind !== "carrier" && member.member_kind !== "evaluation_input") continue;
      expected.set(`wiki/contracts/${member.path}`, {
        content_digest: member.content_digest, byte_length: member.byte_length
      });
    }
    const entries = blobEntriesAtTree({ runGit, binding, treeish, paths: [...expected.keys()] });
    for (const [repositoryPath, declared] of expected) {
      const entry = entries.get(repositoryPath);
      if (entry === undefined || entry.mode !== "100644") return null;
      const bytes = stdoutBytes(runGitOrFail(runGit, { gitDir: binding.git_dir },
        ["--no-replace-objects", "cat-file", "blob", entry.oid],
        "stored controlled-contract runtime package blob could not be read"));
      if (bytes.byteLength !== declared.byte_length || sha256(bytes) !== declared.content_digest) {
        return null;
      }
    }
    return new Map([...expected.keys()].map((repositoryPath) =>
      [repositoryPath, entries.get(repositoryPath)]));
  }

  function selectedRuntimePackagesInHistory({ runGit, binding, since }) {
    const commits = runGitOrFail(runGit, { repo: binding.repository, gitDir: binding.git_dir }, [
      "--no-replace-objects", ...gitInertConfig, "--literal-pathspecs",
      "rev-list", binding.wk_tip_sha, "--not", since, "--", "wiki/contracts"
    ], "controlled-contract generation history could not be enumerated");
    const history = stdoutBytes(commits).toString("utf8").split("\n").filter(Boolean);
    const selected = new Map();
    for (const commit of history) {
      for (const manifestPath of manifestPathsFromTree({ runGit, binding, treeish: commit })) {
        const entries = selectedRuntimePackageAtTree({ runGit, binding, treeish: commit, manifestPath });
        for (const [repositoryPath, entry] of entries ?? []) {
          if (!selected.has(repositoryPath)) selected.set(repositoryPath, new Set());
          selected.get(repositoryPath).add(`${entry.mode} ${entry.oid}`);
        }
      }
    }
    return selected;
  }

  async function generationFromTree({ runGit, binding, treeish, allowEmpty }) {
    const listing = await runGitOrFailAsync(runGit, {
      repo: binding.repository, gitDir: binding.git_dir
    }, [
      "--no-replace-objects", ...gitInertConfig,
      "ls-tree", "-r", "-z", "--full-tree", treeish, "--", "wiki/contracts"
    ], "stored controlled-contract population could not be enumerated");
    const descriptors = [];
    for (const entry of parseLsTree(stdoutBytes(listing))) {
      const basename = path.posix.basename(entry.path);
      const classification = classifyControlledContractGenerationRepositoryPath({
        wkId: binding.record_id,
        repositoryPath: entry.path
      });
      if (classification.classification === "malformed_active_candidate") {
        fail(codes.STORED_GENERATION_INVALID,
          "stored tree contains a malformed active controlled-contract path");
      }
      if (classification.classification === "unsupported_nonmember") continue;
      if (entry.type !== "blob" || entry.mode !== "100644") {
        fail(codes.STORED_GENERATION_INVALID,
          "stored controlled-contract member is not an ordinary Git blob");
      }
      const blob = await runGitOrFailAsync(runGit, { gitDir: binding.git_dir },
        ["--no-replace-objects", "cat-file", "blob", entry.oid],
        "stored controlled-contract blob could not be read");
      const bytes = stdoutBytes(blob);
      descriptors.push({
        path: entry.path,
        basename,
        carrier_kind: classification.carrier_kind,
        focus: classification.focus,
        pack_digest: classification.pack_digest,
        content_digest: sha256(bytes),
        byte_length: bytes.byteLength,
        bytes_base64: bytes.toString("base64")
      });
    }
    descriptors.sort((left, right) => left.path.localeCompare(right.path));
    if (descriptors.length === 0) {
      if (allowEmpty) return Object.freeze({ descriptors: Object.freeze([]), digest: null });
      fail(codes.STORED_GENERATION_INVALID,
        "stored controlled-contract population is unexpectedly empty");
    }
    try {
      const validated = await validateControlledContractAttachmentGenerationDescriptors({
        wkId: binding.record_id,
        descriptors
      });
      return deepFreeze({ descriptors, digest: validated.generation_digest });
    } catch (error) {
      if (isOwnedError(error)) throw error;
      fail(codes.STORED_GENERATION_INVALID,
        "stored controlled-contract population is not one complete authenticated generation", {
          cause_code: error?.code ?? null
        });
    }
  }

  async function authenticationObservationsFromTree({ runGit, binding, treeish }) {
    const listing = await runGitOrFailAsync(runGit, {
      repo: binding.repository, gitDir: binding.git_dir
    }, [
      "--no-replace-objects", ...gitInertConfig,
      "ls-tree", "-r", "-z", "--full-tree", treeish, "--",
      "wiki/contracts", `wiki/work-records/${binding.record_id}.json`
    ], "stored controlled-contract authentication population could not be enumerated");
    const selectedManifestPaths = new Set(
      (binding.resolved_generation.manifest_selection ?? []).map(({ focus }) =>
        canonicalManifestPath(binding.record_id, focus)));
    const carrierObservations = [];
    const manifestObservations = [];
    let recordObservation = null;
    for (const entry of parseLsTree(stdoutBytes(listing))) {
      const basename = path.posix.basename(entry.path);
      const recordPath = `wiki/work-records/${binding.record_id}.json`;
      if (entry.path === recordPath) {
        if (recordObservation !== null || entry.type !== "blob" || entry.mode !== "100644") {
          fail(codes.STORED_GENERATION_INVALID,
            "stored canonical WK record is not one direct ordinary Git blob");
        }
        const blob = await runGitOrFailAsync(runGit, {
          repo: binding.repository, gitDir: binding.git_dir
        }, ["--no-replace-objects", "cat-file", "blob", entry.oid],
        "stored canonical WK record blob could not be read");
        const bytes = stdoutBytes(blob);
        recordObservation = {
          path: entry.path,
          content_digest: sha256(bytes),
          byte_length: bytes.byteLength,
          bytes_base64: bytes.toString("base64")
        };
        continue;
      }
      const classification = classifyControlledContractGenerationRepositoryPath({
        wkId: binding.record_id,
        repositoryPath: entry.path
      });
      if (classification.classification === "active_member") {
        if (entry.type !== "blob" || entry.mode !== "100644") {
          fail(codes.STORED_GENERATION_INVALID,
            "stored controlled-contract member is not an ordinary Git blob");
        }
        const blob = await runGitOrFailAsync(runGit, {
          repo: binding.repository, gitDir: binding.git_dir
        }, ["--no-replace-objects", "cat-file", "blob", entry.oid],
        "stored controlled-contract blob could not be read");
        const bytes = stdoutBytes(blob);
        carrierObservations.push({
          path: entry.path,
          basename,
          carrier_kind: classification.carrier_kind,
          focus: classification.focus,
          pack_digest: classification.pack_digest,
          content_digest: sha256(bytes),
          byte_length: bytes.byteLength,
          bytes_base64: bytes.toString("base64")
        });
        continue;
      }
      if (classification.classification === "malformed_active_candidate") {
        fail(codes.STORED_GENERATION_INVALID,
          "stored tree contains a malformed active controlled-contract path");
      }
      if (!selectedManifestPaths.has(entry.path)) continue;
      if (classification.active !== true || entry.type !== "blob" || entry.mode !== "100644") {
        fail(codes.STORED_GENERATION_INVALID,
          "stored controlled-contract manifest is not one direct ordinary Git blob");
      }
      const blob = await runGitOrFailAsync(runGit, {
        repo: binding.repository, gitDir: binding.git_dir
      }, ["--no-replace-objects", "cat-file", "blob", entry.oid],
      "stored controlled-contract manifest blob could not be read");
      const bytes = stdoutBytes(blob);
      manifestObservations.push({
        path: entry.path,
        content_digest: sha256(bytes),
        byte_length: bytes.byteLength,
        bytes_base64: bytes.toString("base64")
      });
    }
    carrierObservations.sort((left, right) => left.path.localeCompare(right.path));
    manifestObservations.sort((left, right) => left.path.localeCompare(right.path));
    if (recordObservation === null) {
      fail(codes.STORED_GENERATION_INVALID,
        "stored canonical WK record is missing from exact W");
    }
    return deepFreeze({ recordObservation, carrierObservations, manifestObservations });
  }

  return Object.freeze({
    authenticationObservationsFromTree,
    generationFromTree,
    manifestPathsFromTree,
    manifestPopulationMatches,
    parseStructuralDiff,
    recordObservationMatches,
    resolveBoundManifestArtifacts,
    resolveBoundRecordArtifact,
    resolveBoundRuntimePackageArtifacts,
    runtimePackageMatchesTree,
    selectedRuntimePackagesInHistory
  });
}
