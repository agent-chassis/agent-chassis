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
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import {
  computeWorkRecordSourceDigest
} from "@agent-chassis/wiki-core";
import {
  resolveCanonicalControlledContractCarrierSet,
  resolveCanonicalControlledContractGenerationSelection
} from "@agent-chassis/wiki-core/src/lib/controlled-contract-carrier-set-tools.mjs";

export const FINDINGS_DESIGN_CAPTURE_CODES = Object.freeze({
  MISSING: "agent_launch.findings_design_capture.missing.v1",
  MALFORMED: "agent_launch.findings_design_capture.malformed.v1",
  MOVED: "agent_launch.findings_design_capture.moved.v1"
});

const MAX_CANONICAL_INPUT_BYTES = 32 * 1024 * 1024;

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fail(code, inputPath, cause = null) {
  const error = new Error(`canonical design review input could not be captured: ${inputPath}`,
    cause === null ? undefined : { cause });
  error.code = code;
  error.cause_code = code;
  error.input_path = inputPath;
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
  if (!existsSync(path.join(repoRoot, "wiki/contracts"))) return [];
  let generation;
  try {
    generation = await resolveCanonicalControlledContractGenerationSelection({
      repoRoot,
      wkId: recordId
    });
  } catch (error) {
    fail(/moved|changed/u.test(String(error?.message ?? ""))
      ? FINDINGS_DESIGN_CAPTURE_CODES.MOVED
      : FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED,
    `wiki/contracts/${recordId}*`, error);
  }
  if (generation !== null) {
    const captures = [];
    for (const manifest of generation.manifests) {
      const captured = captureRegularFile(repoRoot,
        canonicalManifestPath(recordId, manifest.focus));
      if (captured.digest !== manifest.manifest_content_digest) {
        fail(FINDINGS_DESIGN_CAPTURE_CODES.MOVED, captured.path);
      }
      captures.push(captured);
    }
    for (const descriptor of generation.descriptors) {
      const selectedManifest = generation.manifests.find((entry) =>
        entry.focus === descriptor.focus);
      if (!selectedManifest) {
        fail(FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED, descriptor.path);
      }
      const sourceRelative = path.join(
        "wiki/contracts/.carrier-generations",
        selectedManifest.generation,
        descriptor.basename
      );
      const captured = captureRegularFile(repoRoot, sourceRelative);
      if (captured.digest !== descriptor.content_digest ||
          captured.bytes.byteLength !== descriptor.byte_length) {
        fail(FINDINGS_DESIGN_CAPTURE_CODES.MOVED, descriptor.path);
      }
      captures.push(Object.freeze({ ...captured, path: descriptor.path }));
    }
    return captures;
  }

  let canonicalSet;
  try {
    canonicalSet = await resolveCanonicalControlledContractCarrierSet({
      repoRoot,
      wkId: recordId,
      focus: null
    });
  } catch (error) {
    fail(FINDINGS_DESIGN_CAPTURE_CODES.MALFORMED, `wiki/contracts/${recordId}*`, error);
  }
  return canonicalSet.members.map((member) => {
    const relativePath = `wiki/contracts/${member.filename}`;
    const captured = captureRegularFile(repoRoot, relativePath);
    if (captured.digest !== member.content_digest) {
      fail(FINDINGS_DESIGN_CAPTURE_CODES.MOVED, relativePath);
    }
    return captured;
  });
}

export async function captureCanonicalDesignReviewInputs({
  mainRepo,
  recordId,
  initiallyAuthenticatedRecord
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
  const contractCaptures = await captureSelectedContractInputs(repoRoot, recordId);
  for (const capture of [recordCapture, ...contractCaptures]) {
    assertCaptureStillCurrent(capture);
  }
  return Object.freeze({
    schema_version: "workspace-agent-frozen-design-review-inputs.v1",
    record,
    record_source_digest: computeWorkRecordSourceDigest(record),
    files: Object.freeze([recordCapture, ...contractCaptures])
  });
}

export function materializeCanonicalDesignReviewInputs({ capture, checkoutPath }) {
  const checkout = path.resolve(checkoutPath);
  inspectPathComponents(checkout, "frozen review checkout", { leafKind: "directory" });
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
  return Object.freeze({
    root: checkout,
    files: Object.freeze(capture.files.map((input) => Object.freeze({
      path: input.path,
      digest: input.digest,
      byte_length: input.bytes.byteLength
    })))
  });
}
