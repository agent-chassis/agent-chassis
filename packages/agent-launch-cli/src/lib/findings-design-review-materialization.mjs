import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import {
  computeWorkRecordSourceDigest
} from "@agent-chassis/wiki-core/src/lib/work-record-schema.mjs";
import {
  resolveWorkRecordEntryMaterial
} from "@agent-chassis/wiki-core/src/lib/work-record-entry-material.mjs";
import {
  resolveCanonicalControlledContractGenerationSelection
} from "@agent-chassis/wiki-core/src/lib/controlled-contract-carrier-set-tools.mjs";
import {
  resolveControlledContractAttachmentGeneration
} from "@agent-chassis/wiki-core/src/lib/controlled-contract-tools.mjs";

import {
  classifyControlledContractGenerationRepositoryPath,
  controlledContractAssessmentAuthoredDependencies,
  resolveControlledContractSavedAuthoringSources,
  withControlledContractSourceObservation
} from "@agent-chassis/wiki-core/src/lib/controlled-contract-tool-shared.mjs";
import {
  acceptanceCoverageCarrierPath
} from "@agent-chassis/wiki-core/src/operations/controlled-contract/acceptance-coverage-facts.mjs";
import {
  resolveSavedProofContext,
  resolveSavedProofSource
} from "@agent-chassis/wiki-core/src/operations/controlled-contract/saved-proof-source.mjs";

export const FINDINGS_DESIGN_CAPTURE_CODES = Object.freeze({
  MISSING: "agent_launch.findings_design_capture.missing.v1",
  MALFORMED: "agent_launch.findings_design_capture.malformed.v1",
  MOVED: "agent_launch.findings_design_capture.moved.v1"
});

const MAX_CANONICAL_INPUT_BYTES = 32 * 1024 * 1024;
const CARRIER_SET_MANIFEST_SUFFIX = ".carrier-set-manifest.json";
const CONTRACT_STORE = "wiki/contracts";

function isRecordContractSource(recordId, basename) {
  const classification = classifyControlledContractGenerationRepositoryPath({
    wkId: recordId, repositoryPath: `${CONTRACT_STORE}/${basename}`
  });
  return classification.member === true ||
    classification.classification === "malformed_active_candidate" ||
    classification.reason === "server_owned_carrier_set_manifest";
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fail(code, inputPath, cause = null, detail = null) {
  const error = new Error(`canonical design review input could not be captured: ${inputPath}`,
    cause === null ? undefined : { cause });
  error.code = code;
  error.cause_code = code;
  error.input_path = inputPath;
  if (detail !== null) error.detail = Object.freeze(detail);
  throw error;
}

function signature(stat) {
  return Object.freeze({
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtime_ms: stat.mtimeMs,
    ctime_ms: stat.ctimeMs
  });
}

function sameSignature(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtime_ms === right.mtime_ms && left.ctime_ms === right.ctime_ms;
}

function componentIdentity(stat) {
  return Object.freeze({ dev: stat.dev, ino: stat.ino });
}

function sameComponentIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function absolutePathComponents(absolutePath) {
  const root = path.parse(absolutePath).root;
  const relative = path.relative(root, absolutePath);
  const components = [root];
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    components.push(current);
  }
  return components;
}

function componentKind(stat) {
  if (stat.isDirectory()) return "directory";
  if (stat.isFile()) return "file";
  return "other";
}

function inspectPathComponents(absolutePath, inputPath, {
  leafKind,
  allowMissing = false,
  missingCode = FINDINGS_DESIGN_CAPTURE_CODES.MISSING
}) {
  const componentPaths = absolutePathComponents(absolutePath);
  const inspected = [];
  let missing = false;
  for (let index = 0; index < componentPaths.length; index += 1) {
    const componentPath = componentPaths[index];
    let observed;
    try {
      observed = lstatSync(componentPath);
    } catch (error) {
      if (error?.code === "ENOENT" && allowMissing) {
        missing = true;
        continue;
      }
      fail(error?.code === "ENOENT" ? missingCode : FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED,
        inputPath, error);
    }
    if (missing || observed.isSymbolicLink()) {
      fail(FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED, inputPath);
    }
    const isLeaf = index === componentPaths.length - 1;
    const expectedKind = isLeaf ? leafKind : "directory";
    if (componentKind(observed) !== expectedKind) {
      fail(FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED, inputPath);
    }
    inspected.push(Object.freeze({
      path: componentPath,
      kind: expectedKind,
      identity: componentIdentity(observed)
    }));
  }
  return Object.freeze(inspected);
}

function assertPathComponentsStillCurrent(components, inputPath) {
  for (const component of components) {
    let observed;
    try {
      observed = lstatSync(component.path);
    } catch (error) {
      fail(FINDINGS_DESIGN_CAPTURE_CODES.MOVED, inputPath, error);
    }
    if (observed.isSymbolicLink() || componentKind(observed) !== component.kind ||
        !sameComponentIdentity(component.identity, componentIdentity(observed))) {
      fail(FINDINGS_DESIGN_CAPTURE_CODES.MOVED, inputPath);
    }
  }
}

function resolveContainedTarget(checkout, inputPath) {
  if (typeof inputPath !== "string" || inputPath.length === 0 || path.isAbsolute(inputPath)) {
    fail(FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED, String(inputPath));
  }
  const target = path.resolve(checkout, inputPath);
  const relative = path.relative(checkout, target);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)) {
    fail(FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED, inputPath);
  }
  return target;
}

function ensureDirectoryPath(absoluteDirectory, inputPath) {
  const inspected = [];
  for (const componentPath of absolutePathComponents(absoluteDirectory)) {
    let observed;
    try {
      observed = lstatSync(componentPath);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        fail(FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED, inputPath, error);
      }
      assertPathComponentsStillCurrent(inspected, inputPath);
      try {
        mkdirSync(componentPath, { mode: 0o700 });
      } catch (mkdirError) {
        if (mkdirError?.code !== "EEXIST") {
          fail(FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED, inputPath, mkdirError);
        }
      }
      try {
        observed = lstatSync(componentPath);
      } catch (lstatError) {
        fail(FINDINGS_DESIGN_CAPTURE_CODES.MOVED, inputPath, lstatError);
      }
    }
    if (observed.isSymbolicLink() || !observed.isDirectory()) {
      fail(FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED, inputPath);
    }
    inspected.push(Object.freeze({
      path: componentPath,
      kind: "directory",
      identity: componentIdentity(observed)
    }));
  }
  return Object.freeze(inspected);
}

function captureTargetState(target, inputPath) {
  try {
    const observed = lstatSync(target);
    if (observed.isSymbolicLink() || !observed.isFile()) {
      fail(FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED, inputPath);
    }
    return signature(observed);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error?.code === FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED) throw error;
    fail(FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED, inputPath, error);
  }
}

function assertTargetStateStillCurrent(target, expected, inputPath) {
  let observed;
  try {
    observed = lstatSync(target);
  } catch (error) {
    if (error?.code === "ENOENT" && expected === null) return;
    fail(FINDINGS_DESIGN_CAPTURE_CODES.MOVED, inputPath, error);
  }
  if (expected === null || observed.isSymbolicLink() || !observed.isFile() ||
      !sameSignature(expected, signature(observed))) {
    fail(FINDINGS_DESIGN_CAPTURE_CODES.MOVED, inputPath);
  }
}

function captureRegularFile(repoRoot, relativePath) {
  const absolutePath = path.resolve(repoRoot, relativePath);
  const relative = path.relative(repoRoot, absolutePath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail(FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED, relativePath);
  }
  const pathComponents = inspectPathComponents(absolutePath, relativePath, {
    leafKind: "file"
  });
  let fd;
  try {
    fd = openSync(absolutePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    fail(error?.code === "ENOENT"
      ? FINDINGS_DESIGN_CAPTURE_CODES.MISSING
      : FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED, relativePath, error);
  }
  try {
    const before = fstatSync(fd);
    const leafIdentity = pathComponents[pathComponents.length - 1].identity;
    if (!before.isFile() || !sameComponentIdentity(leafIdentity, componentIdentity(before)) ||
        before.size > MAX_CANONICAL_INPUT_BYTES) {
      fail(FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED, relativePath);
    }
    assertPathComponentsStillCurrent(pathComponents, relativePath);
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (!sameSignature(signature(before), signature(after)) || bytes.byteLength !== after.size) {
      fail(FINDINGS_DESIGN_CAPTURE_CODES.MOVED, relativePath);
    }
    assertPathComponentsStillCurrent(pathComponents, relativePath);
    return Object.freeze({
      path: relativePath,
      source_path: absolutePath,
      bytes,
      digest: digest(bytes),
      signature: signature(after),
      path_components: pathComponents
    });
  } finally {
    closeSync(fd);
  }
}

function assertCaptureStillCurrent(capture) {
  assertPathComponentsStillCurrent(capture.path_components, capture.path);
  let fd;
  try {
    fd = openSync(capture.source_path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    fail(FINDINGS_DESIGN_CAPTURE_CODES.MOVED, capture.path, error);
  }
  try {
    const observed = fstatSync(fd);
    if (!observed.isFile() || !sameSignature(capture.signature, signature(observed))) {
      fail(FINDINGS_DESIGN_CAPTURE_CODES.MOVED, capture.path);
    }
    assertPathComponentsStillCurrent(capture.path_components, capture.path);
    const current = readFileSync(fd);
    if (digest(current) !== capture.digest) {
      fail(FINDINGS_DESIGN_CAPTURE_CODES.MOVED, capture.path);
    }
    assertPathComponentsStillCurrent(capture.path_components, capture.path);
  } finally {
    closeSync(fd);
  }
}

function parseCapturedRecord(capture, recordId) {
  let record;
  try {
    record = JSON.parse(capture.bytes.toString("utf8"));
  } catch (error) {
    fail(FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED, capture.path, error);
  }
  if (record === null || typeof record !== "object" || Array.isArray(record) ||
      record.id !== recordId) {
    fail(FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED, capture.path);
  }
  return record;
}

function canonicalManifestPath(recordId, focus) {
  return `wiki/contracts/${focus === null ? recordId : `${recordId}-${focus}`}` +
    ".carrier-set-manifest.json";
}

async function captureSelectedContractInputs(repoRoot, recordId) {
  const resolve = async (resolver) => {
    try {
      return await resolver({ repoRoot, wkId: recordId });
    } catch (error) {
      fail(/moved|changed/u.test(String(error?.message ?? ""))
        ? FINDINGS_DESIGN_CAPTURE_CODES.MOVED
        : FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED,
      `wiki/contracts/${recordId}*`, error, {
        source_failure: { code: error.code ?? null, message: error.message, details: error.details ?? null }
      });
    }
  };
  const selection = await resolve(resolveCanonicalControlledContractGenerationSelection);
  const population = await resolve(resolveControlledContractAttachmentGeneration) ??
    await resolve(resolveControlledContractSavedAuthoringSources);
  const manifests = selection?.manifests ?? null;
  if (population !== null &&
      JSON.stringify(population.manifest_selection ?? null) !== JSON.stringify(manifests)) {
    fail(FINDINGS_DESIGN_CAPTURE_CODES.MOVED, `wiki/contracts/${recordId}*`);
  }

  const captures = [];
  const capturedPaths = new Set();
  const capture = (relativePath, expectedDigest, expectedByteLength = null) => {
    const captured = captureRegularFile(repoRoot, relativePath);
    if (captured.digest !== expectedDigest ||
        (expectedByteLength !== null && captured.bytes.byteLength !== expectedByteLength)) {
      fail(FINDINGS_DESIGN_CAPTURE_CODES.MOVED, relativePath);
    }
    if (capturedPaths.has(relativePath)) return;
    capturedPaths.add(relativePath);
    captures.push(captured);
  };

  const manifestSelected = new Map();
  if (selection !== null) {
    const generationPath = (manifest, basename) => path.join(
      "wiki/contracts/.carrier-generations", manifest.generation, basename);
    for (const manifest of selection.manifests) {
      capture(canonicalManifestPath(recordId, manifest.focus), manifest.manifest_content_digest);
      capture(generationPath(manifest, "manifest.json"), manifest.manifest_content_digest);
    }
    for (const descriptor of selection.descriptors) {
      const selectedManifest = selection.manifests.find((entry) =>
        entry.focus === descriptor.focus);
      if (!selectedManifest) {
        fail(FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED, descriptor.path);
      }
      capture(generationPath(selectedManifest, descriptor.basename),
        descriptor.content_digest, descriptor.byte_length);
      manifestSelected.set(descriptor.basename, descriptor.content_digest);
    }
  }

  for (const descriptor of population?.descriptors ?? []) {
    if (manifestSelected.has(descriptor.basename)) {
      if (manifestSelected.get(descriptor.basename) !== descriptor.content_digest) {
        fail(FINDINGS_DESIGN_CAPTURE_CODES.MOVED, descriptor.path);
      }
      continue;
    }
    capture(descriptor.path, descriptor.content_digest, descriptor.byte_length);
  }
  return captures;
}

async function captureConsumedMappingContracts(repoRoot, record, dependencyRecordIds, focuses) {
  if (dependencyRecordIds.length === 0) {
    return { captures: [], absent_paths: [], consulted: [] };
  }
  const store = path.join(repoRoot, "wiki", "contracts");
  const consumed = new Map();
  const absent = new Set();
  const consultedIds = new Set();
  const dependencyOf = (repositoryPath) => {
    const [, name = ""] = /^wiki\/contracts\/(?:\.carrier-generations\/[0-9a-f]{64}\/)?([^/]+)$/u
      .exec(repositoryPath) ?? [];
    return dependencyRecordIds.find((id) => name === id || name.startsWith(`${id}.`) || name.startsWith(`${id}-`)) ?? null;
  };
  let dependencyOpened = false;
  const recorder = Object.freeze({
    schema_version: "controlled-contract-generation-source-observation.v1",
    source: Object.freeze({ kind: "capture_selection_recorder", record_id: record.id }),
    repository: repoRoot,
    wk_id: record.id,
    dependency_wk_ids: dependencyRecordIds,
    store_root_population: true,
    storeEntries: async () => {
      try {
        return readdirSync(store, { withFileTypes: true });
      } catch (error) {
        if (error?.code === "ENOENT") return [];
        throw error;
      }
    },
    readFile: async (repositoryPath) => {
      const dependencyId = dependencyOf(repositoryPath);
      const dependency = dependencyId !== null;
      if (dependency) {
        dependencyOpened = true;
        consultedIds.add(dependencyId);
      }
      const absolute = path.join(repoRoot, ...repositoryPath.split("/"));
      let observed;
      try {
        observed = lstatSync(absolute);
      } catch (error) {
        if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
          if (dependency) absent.add(repositoryPath);
          return null;
        }
        throw error;
      }
      if (!observed.isFile()) return { ordinary: false, bytes: null };
      const bytes = readFileSync(absolute);
      if (dependency) consumed.set(repositoryPath, digest(bytes));
      return { ordinary: true, bytes };
    }
  });
  const units = [null, ...(Array.isArray(record.slices) ? record.slices : []).map((slice) => slice?.id)
    .filter((id) => typeof id === "string")];
  for (const focus of focuses) {
    for (const selectedUnit of units) {
      dependencyOpened = false;
      try {
        await withControlledContractSourceObservation(recorder, async () => resolveSavedProofContext(
          await resolveSavedProofSource({ repoRoot, wkId: record.id, focus, selectedUnit }), {}));
      } catch (error) {
        if (dependencyOpened) {
          fail(FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED, `wiki/contracts/${dependencyRecordIds.join(",")}*`, error, {
            dependency_diagnostic: Object.freeze({ code: error?.code ?? null, message: error?.message ?? null,
              unit: selectedUnit === null ? record.id : `${record.id}#${selectedUnit}`, focus })
          });
        }
      }
    }
  }
  const captures = [...consumed.entries()].sort(([left], [right]) => (left < right ? -1 : 1)).map(([repositoryPath, read]) => {
    const captured = captureRegularFile(repoRoot, repositoryPath);
    if (captured.digest !== read) fail(FINDINGS_DESIGN_CAPTURE_CODES.MOVED, repositoryPath);
    return captured;
  });
  let names = [];
  if (consultedIds.size > 0) {
    try {
      names = readdirSync(store);
    } catch (error) {
      if (error?.code !== "ENOENT") fail(FINDINGS_DESIGN_CAPTURE_CODES.MOVED, CONTRACT_STORE, error);
    }
  }
  return {
    captures,
    absent_paths: [...absent].filter((repositoryPath) => !consumed.has(repositoryPath)).sort(),
    consulted: [...consultedIds].sort().map((recordId) => Object.freeze({
      record_id: recordId,
      present: Object.freeze(names.filter((name) => isRecordContractSource(recordId, name)).sort())
    }))
  };
}

async function captureCanonicalRecordDefinitionInputs({
  mainRepo,
  recordId,
  initiallyAuthenticatedRecord,
  resolveSupplement = null
}) {
  const repoRoot = path.resolve(mainRepo);
  const recordPath = `wiki/work-records/${recordId}.json`;
  const recordCapture = captureRegularFile(repoRoot, recordPath);
  const record = parseCapturedRecord(recordCapture, recordId);
  if (initiallyAuthenticatedRecord !== null &&
      computeWorkRecordSourceDigest(initiallyAuthenticatedRecord) !==
        computeWorkRecordSourceDigest(record)) {
    fail(FINDINGS_DESIGN_CAPTURE_CODES.MOVED, recordPath);
  }
  const supplement = resolveSupplement === null ? { captures: [], fields: {} }
    : await resolveSupplement({ repoRoot, record, recordCapture });
  const contractCaptures = await captureSelectedContractInputs(repoRoot, recordId);

  const dependencies = controlledContractAssessmentAuthoredDependencies(record);

  const absentPaths = [];
  const dependencyCaptures = [];
  for (const dependency of dependencies.files) {
    if (existsSync(path.join(repoRoot, dependency.path))) {
      dependencyCaptures.push(captureRegularFile(repoRoot, dependency.path));
    } else {
      absentPaths.push(dependency.path);
    }
  }

  const focuses = [null, ...contractCaptures.map((capture) => path.basename(capture.path))
    .filter((name) => name.startsWith(`${recordId}-`) && name.endsWith(CARRIER_SET_MANIFEST_SUFFIX))
    .map((name) => name.slice(recordId.length + 1, -CARRIER_SET_MANIFEST_SUFFIX.length))];
  for (const focus of focuses) {
    for (const unit of [null, ...(Array.isArray(record.slices) ? record.slices : []).map((slice) => slice?.id)]) {
      if (unit !== null && (typeof unit !== "string" || !/^SLICE-[0-9]{3,}$/u.test(unit))) continue;
      const carrierPath = path.relative(repoRoot, acceptanceCoverageCarrierPath(repoRoot, recordId, focus, unit))
        .split(path.sep).join("/");
      if (existsSync(path.join(repoRoot, carrierPath))) dependencyCaptures.push(captureRegularFile(repoRoot, carrierPath));
      else absentPaths.push(carrierPath);
    }
  }
  const mapping = await captureConsumedMappingContracts(repoRoot, record,
    dependencies.contract_record_ids, focuses);
  dependencyCaptures.push(...mapping.captures);
  absentPaths.push(...mapping.absent_paths);
  const captured = new Set();
  const files = [recordCapture, ...supplement.captures, ...contractCaptures, ...dependencyCaptures]

    .filter((capture) => !captured.has(capture.path) && captured.add(capture.path));
  for (const capture of files) {
    assertCaptureStillCurrent(capture);
  }
  return Object.freeze({
    record,
    record_source_digest: computeWorkRecordSourceDigest(record),
    ...supplement.fields,
    files: Object.freeze(files),

    absent: Object.freeze({
      paths: Object.freeze([...new Set(absentPaths)].filter((repositoryPath) => !captured.has(repositoryPath)).sort()),
      related_contracts: Object.freeze(mapping.consulted)
    })
  });
}

export async function captureCanonicalProofDefinitionInputs({ mainRepo, recordId }) {
  return Object.freeze({
    schema_version: "workspace-agent-captured-proof-definition-inputs.v1",
    ...await captureCanonicalRecordDefinitionInputs({
      mainRepo, recordId, initiallyAuthenticatedRecord: null
    })
  });
}

export async function captureCanonicalDesignReviewInputs({
  mainRepo,
  recordId,
  initiallyAuthenticatedRecord,
  selectedSliceId = null,

  repository = null
}) {
  const resolveSupplement = async ({ repoRoot, record, recordCapture }) => {
    const selected = selectedSliceId === null ? record
      : record.slices?.find((slice) => slice?.id === selectedSliceId) ?? record;
    const entryCaptures = new Map([[recordId, recordCapture]]);
    const entryMaterial = await resolveWorkRecordEntryMaterial({
      record,
      selected,
      repository,
      dir: repoRoot,
      loadWorkRecordById: async ({ id }) => {
        let captured = entryCaptures.get(id);
        if (!captured) {
          captured = captureRegularFile(repoRoot, `wiki/work-records/${id}.json`);
          entryCaptures.set(id, captured);
        }
        const sourceRecord = parseCapturedRecord(captured, id);
        return { valid: true, record: sourceRecord,
          source_digest: computeWorkRecordSourceDigest(sourceRecord), diagnostics: [] };
      }
    });
    if (!entryMaterial.ok) {

      const diagnostic = entryMaterial.diagnostic ?? null;
      fail(FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED, diagnostic?.path ?? "sections.material_refs", null, {
        material_diagnostic: diagnostic === null ? null : Object.freeze({
          code: diagnostic.code ?? null,
          message: diagnostic.message ?? null,
          path: diagnostic.path ?? null,
          ...(diagnostic.source_failure === undefined ? {} : { source_failure: diagnostic.source_failure })
        })
      });
    }
    return {
      captures: [...entryCaptures.entries()].filter(([id]) => id !== recordId).map(([, capture]) => capture),
      fields: { entry_material: entryMaterial }
    };
  };
  return Object.freeze({
    schema_version: "workspace-agent-frozen-design-review-inputs.v1",
    ...await captureCanonicalRecordDefinitionInputs({
      mainRepo, recordId, initiallyAuthenticatedRecord, resolveSupplement
    })
  });
}

export function materializeCanonicalDesignReviewInputs({ capture, checkoutPath }) {
  const checkout = path.resolve(checkoutPath);
  inspectPathComponents(checkout, "frozen review checkout", { leafKind: "directory" });

  ensureDirectoryPath(path.join(checkout, CONTRACT_STORE), CONTRACT_STORE);
  const targets = capture.files.map((input) => {
    const target = resolveContainedTarget(checkout, input.path);
    inspectPathComponents(target, input.path, {
      leafKind: "file",
      allowMissing: true,
      missingCode: FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED
    });
    return Object.freeze({ input, target });
  });

  for (const { input, target } of targets) {
    const directoryComponents = ensureDirectoryPath(path.dirname(target), input.path);
    assertPathComponentsStillCurrent(directoryComponents, input.path);
    const priorTarget = captureTargetState(target, input.path);
    const temporary = `${target}.launcher-capture-${process.pid}-${randomUUID()}`;
    let temporaryExists = false;
    let temporarySignature = null;
    let fd = null;
    try {
      fd = openSync(temporary,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
        0o600);
      temporaryExists = true;
      writeFileSync(fd, input.bytes);
      fchmodSync(fd, 0o444);
      temporarySignature = signature(fstatSync(fd));
      closeSync(fd);
      fd = null;

      assertPathComponentsStillCurrent(directoryComponents, input.path);
      assertTargetStateStillCurrent(target, priorTarget, input.path);
      renameSync(temporary, target);
      temporaryExists = false;

      assertPathComponentsStillCurrent(directoryComponents, input.path);
      fd = openSync(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      const materialized = fstatSync(fd);
      if (!materialized.isFile() ||
          !sameComponentIdentity(temporarySignature, materialized) ||
          temporarySignature.size !== materialized.size) {
        fail(FINDINGS_DESIGN_CAPTURE_CODES.MOVED, input.path);
      }
      assertPathComponentsStillCurrent(directoryComponents, input.path);
      const materializedBytes = readFileSync(fd);
      if (digest(materializedBytes) !== input.digest) {
        fail(FINDINGS_DESIGN_CAPTURE_CODES.MOVED, input.path);
      }
      assertPathComponentsStillCurrent(directoryComponents, input.path);
    } catch (error) {
      if (error?.code === FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED ||
          error?.code === FINDINGS_DESIGN_CAPTURE_CODES.MOVED) {
        throw error;
      }
      fail(FINDINGS_DESIGN_CAPTURE_CODES.MOVED, input.path, error);
    } finally {
      if (fd !== null) closeSync(fd);
      if (temporaryExists && existsSync(temporary)) unlinkSync(temporary);
    }
  }
  const suppressed = suppressInheritedAbsentSources({ capture, checkout });
  const files = Object.freeze(capture.files.map((input) => Object.freeze({
    path: input.path,
    digest: input.digest,
    byte_length: input.bytes.byteLength
  })));
  return Object.freeze({ root: checkout, files, suppressed });
}

function suppressInheritedAbsentSources({ capture, checkout }) {
  const captured = new Set(capture.files.map((input) => input.path));
  const suppressed = new Set();
  const remove = (repositoryPath) => {
    if (captured.has(repositoryPath) || suppressed.has(repositoryPath)) return;
    const target = resolveContainedTarget(checkout, repositoryPath);
    const parent = path.dirname(target);
    const components = inspectPathComponents(parent, repositoryPath, {
      leafKind: "directory", allowMissing: true, missingCode: FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED
    });
    if (components.length !== absolutePathComponents(parent).length) return;
    let observed;
    try {
      observed = lstatSync(target);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      fail(FINDINGS_DESIGN_CAPTURE_CODES.MOVED, repositoryPath, error);
    }

    if (!observed.isFile() && !observed.isSymbolicLink()) {
      fail(FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED, repositoryPath);
    }
    try {
      unlinkSync(target);
    } catch (error) {
      fail(FINDINGS_DESIGN_CAPTURE_CODES.MOVED, repositoryPath, error);
    }
    suppressed.add(repositoryPath);
  };
  const store = path.join(checkout, "wiki", "contracts");
  let names = [];
  try {
    const components = inspectPathComponents(store, CONTRACT_STORE, {
      leafKind: "directory", allowMissing: true, missingCode: FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED
    });
    if (components.length === absolutePathComponents(store).length) names = readdirSync(store).sort();
  } catch (error) {
    if (error?.code === FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED) throw error;
    fail(FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED, CONTRACT_STORE, error);
  }
  for (const name of names) {
    if (isRecordContractSource(capture.record.id, name)) remove(`${CONTRACT_STORE}/${name}`);
  }
  for (const repositoryPath of capture.absent.paths) remove(repositoryPath);
  for (const related of capture.absent.related_contracts) {
    const present = new Set(related.present);
    for (const name of names) {
      if (!present.has(name) && isRecordContractSource(related.record_id, name)) remove(`${CONTRACT_STORE}/${name}`);
    }
  }
  return Object.freeze([...suppressed].sort());
}
