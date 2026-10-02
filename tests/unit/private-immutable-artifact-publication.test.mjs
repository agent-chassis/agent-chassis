

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs, { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PrivateImmutableArtifactPublicationError,
  publishPrivateImmutableArtifact
} from "../../packages/agent-launch-cli/src/lib/managed-assignment-read-artifact.mjs";
import { injectFilesystemFault } from "../helpers/filesystem-fault.mjs";
import { createTestResourceScope } from "../helpers/test-resource-scope.mjs";

const PREFIX = "publication-witness-sha256-";
const LABEL = "publication-witness-artifact";

function snapshotOf(text) {
  const bytes = new Uint8Array(Buffer.from(text, "utf8"));
  return Object.freeze({
    bytes,
    byte_length: bytes.byteLength,
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`
  });
}

function ownedDirectory(t) {
  const scope = createTestResourceScope({ label: "private-immutable-artifact-publication" });
  t.after(() => scope.dispose());
  const directory = mkdtempSync(path.join(os.tmpdir(), "private-artifact-"));
  scope.add("publication directory", () => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function recordingScope({ adoptFailure = null } = {}) {
  const adopted = [];
  return {
    adopted,
    adopt(label, dispose) {
      if (adoptFailure) throw adoptFailure;
      adopted.push({ label, dispose });
      return label;
    }
  };
}

function publish({ directory, scope, snapshot }) {
  return publishPrivateImmutableArtifact({
    scope, directory, prefix: PREFIX, resourceLabel: LABEL, maxBytes: 1024, snapshot
  });
}

function artifactPathFor(directory, snapshot) {
  return path.join(directory, `${PREFIX}${snapshot.digest.slice("sha256:".length)}.json`);
}

function restoreFaults(faults, { unclosed = null } = {}) {
  for (const fault of faults) fault.restore();
  for (const descriptor of unclosed?.descriptors ?? []) fs.closeSync(descriptor);
}

function assertPublicationFailure(error, { cause, cleanupFailures }) {
  assert.ok(error instanceof PrivateImmutableArtifactPublicationError, String(error));
  assert.equal(error.cause, cause, "the originating failure is kept by identity");
  assert.deepEqual(error.cleanupFailures.map(({ operation, code }) => ({ operation, code })),
    cleanupFailures);
  assert.ok(Object.isFrozen(error.cleanupFailures));
  return true;
}

test("a successful publication is read-only, adopted, and removed by its scope", (t) => {
  const directory = ownedDirectory(t);
  const snapshot = snapshotOf("{\"published\":true}");
  const scope = recordingScope();
  const artifactPath = publish({ directory, scope, snapshot });

  assert.equal(artifactPath, artifactPathFor(directory, snapshot));
  assert.equal(statSync(artifactPath).mode & 0o777, 0o400);
  assert.deepEqual(readFileSync(artifactPath), Buffer.from(snapshot.bytes));
  assert.deepEqual(scope.adopted.map(({ label }) => label), [LABEL]);
  scope.adopted[0].dispose();
  assert.equal(existsSync(artifactPath), false, "the adopted disposer removes the artifact");
  scope.adopted[0].dispose();
});

test("an exclusive-create refusal removes nothing it did not acquire", (t) => {
  const directory = ownedDirectory(t);
  const snapshot = snapshotOf("{\"obstructed\":true}");
  const occupant = artifactPathFor(directory, snapshot);
  writeFileSync(occupant, "foreign occupant", { mode: 0o600 });
  const scope = recordingScope();

  assert.throws(() => publish({ directory, scope, snapshot }), (error) => {
    assert.equal(error.cause?.code, "EEXIST");
    return assertPublicationFailure(error, { cause: error.cause, cleanupFailures: [] });
  });
  assert.equal(readFileSync(occupant, "utf8"), "foreign occupant", "the occupant is untouched");
  assert.deepEqual(scope.adopted, []);
});

test("an operation failure removes the created file and keeps the originating error", (t) => {
  const directory = ownedDirectory(t);
  const snapshot = snapshotOf("{\"sync\":\"fails\"}");
  const artifactPath = artifactPathFor(directory, snapshot);
  const scope = recordingScope();
  const sync = injectFilesystemFault(t, { operation: "fsyncSync", path: artifactPath, descriptor: true });

  assert.throws(() => publish({ directory, scope, snapshot }), (error) =>
    assertPublicationFailure(error, { cause: sync.error, cleanupFailures: [] }));
  assert.equal(sync.hits, 1);
  assert.equal(existsSync(artifactPath), false, "the created file is removed");
  assert.deepEqual(scope.adopted, []);
  restoreFaults([sync]);
});

test("an operation failure reports each failed cleanup beside the originating error", (t) => {
  const directory = ownedDirectory(t);
  const snapshot = snapshotOf("{\"cleanup\":\"fails\"}");
  const artifactPath = artifactPathFor(directory, snapshot);
  const scope = recordingScope();
  const sync = injectFilesystemFault(t, { operation: "fsyncSync", path: artifactPath, descriptor: true });
  const close = injectFilesystemFault(t, { operation: "closeSync", path: artifactPath, descriptor: true });
  const unlink = injectFilesystemFault(t, { operation: "unlinkSync", path: artifactPath, code: "EACCES" });

  assert.throws(() => publish({ directory, scope, snapshot }), (error) => {
    assertPublicationFailure(error, {
      cause: sync.error,
      cleanupFailures: [{ operation: "close", code: "EIO" }, { operation: "unlink", code: "EACCES" }]
    });
    assert.match(error.cleanupFailures[0].message, /injected test fault, close/u);
    assert.match(error.cleanupFailures[1].message, /injected test fault, unlink/u);
    return true;
  });
  assert.deepEqual([sync.hits, close.hits, unlink.hits], [1, 1, 1]);
  assert.deepEqual(scope.adopted, []);
  restoreFaults([sync, close, unlink], { unclosed: close });
  assert.equal(existsSync(artifactPath), true, "a failed removal is reported, not hidden");
});

test("a close failure after a complete write refuses and removes the created file", (t) => {
  const directory = ownedDirectory(t);
  const snapshot = snapshotOf("{\"close\":\"fails\"}");
  const artifactPath = artifactPathFor(directory, snapshot);
  const scope = recordingScope();
  const close = injectFilesystemFault(t, { operation: "closeSync", path: artifactPath, descriptor: true });

  assert.throws(() => publish({ directory, scope, snapshot }), (error) =>
    assertPublicationFailure(error, { cause: close.error, cleanupFailures: [] }));
  assert.equal(existsSync(artifactPath), false);
  assert.deepEqual(scope.adopted, []);
  restoreFaults([close], { unclosed: close });
});

test("an identity-check read failure removes the file and reports a failed removal", (t) => {
  const directory = ownedDirectory(t);
  const snapshot = snapshotOf("{\"identity\":\"unreadable\"}");
  const artifactPath = artifactPathFor(directory, snapshot);
  const scope = recordingScope();
  const stat = injectFilesystemFault(t, { operation: "statSync", path: artifactPath });
  const unlink = injectFilesystemFault(t, { operation: "unlinkSync", path: artifactPath, code: "EACCES" });

  assert.throws(() => publish({ directory, scope, snapshot }), (error) =>
    assertPublicationFailure(error, {
      cause: stat.error,
      cleanupFailures: [{ operation: "unlink", code: "EACCES" }]
    }));
  assert.deepEqual(scope.adopted, []);
  restoreFaults([unlink, stat]);
  assert.equal(existsSync(artifactPath), true);
});

test("a scope that cannot adopt the removal leaves no unowned file", (t) => {
  const directory = ownedDirectory(t);
  const snapshot = snapshotOf("{\"adoption\":\"fails\"}");
  const adoptFailure = Object.assign(new Error("scope already disposed"), { code: "scope_disposed" });
  const scope = recordingScope({ adoptFailure });

  assert.throws(() => publish({ directory, scope, snapshot }), (error) =>
    assertPublicationFailure(error, { cause: adoptFailure, cleanupFailures: [] }));
  assert.equal(existsSync(artifactPathFor(directory, snapshot)), false);
});
