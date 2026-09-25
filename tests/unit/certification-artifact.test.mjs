import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deflateRawSync } from "node:zlib";

import {
  CERTIFICATION_ARCHIVE_NAME,
  CERTIFICATION_ARTIFACT_MAX_DECODED_BYTES,
  CERTIFICATION_ARTIFACT_MAX_ENCODED_BYTES,
  CERTIFICATION_BUNDLE_SCHEMA,
  certificationMember,
  decodeCertificationArtifact,
  encodeCertificationArtifact,
  readCertificationArchive,
  serializeCertificationBundle,
  writeCertificationArchive
} from "../../packages/controlled-contract/test/support/certification-artifact.mjs";
import { createTestResourceScope } from "../helpers/test-resource-scope.mjs";

const identity = Object.freeze({ profile_id: "proof.fixture.storage", profile_version: "1.0.0" });

const members = new Map([
  ["adequacy.json", Buffer.from('{"profile_id": "proof.fixture.storage","n":1}\n')],
  ["negative-fixtures/reject-a.json", Buffer.from('{ "fixture_id":"reject-a", "note":"é ☃" }')],
  ["certification-result.full-census.json", Buffer.from("[1,  2,\t3]\n")]
]);

async function temporaryDirectory(t) {
  const scope = createTestResourceScope({ label: "certification-artifact" });
  t.after(() => scope.dispose());
  return scope.acquire("directory",
    () => mkdtemp(path.join(os.tmpdir(), "certification-artifact-")),
    (directory) => rm(directory, { recursive: true, force: true }));
}

const refuses = (action, code) => assert.throws(action, (error) =>
  error.code === code && error.details.failure_kind === "mechanical" &&
  /restore the archive bytes from version control/u.test(error.details.recovery));
const refusesAsync = (action, code) => assert.rejects(action, (error) =>
  error.code === code && error.details.failure_kind === "mechanical");

test("encoding is deterministic gzip level 6 with no filename or timestamp", () => {
  const bytes = Buffer.from(serializeCertificationBundle(identity, members));
  const first = encodeCertificationArtifact(bytes);
  assert.deepEqual(encodeCertificationArtifact(Buffer.from(bytes)), first);
  assert.deepEqual([...first.subarray(0, 4)], [0x1f, 0x8b, 0x08, 0x00], "deflate, no flags");
  assert.equal(first.readUInt32LE(4), 0, "no modification time");
  assert.deepEqual(decodeCertificationArtifact(first), bytes);
});

test("an archive round-trips every member's exact bytes and digest", async (t) => {
  const directory = await temporaryDirectory(t);
  await writeCertificationArchive(directory, identity, members);
  assert.deepEqual(await readdir(directory), [CERTIFICATION_ARCHIVE_NAME]);
  const archive = await readCertificationArchive(directory, { identity });
  assert.deepEqual([...archive.members.keys()], [...members.keys()].sort());
  for (const [memberPath, bytes] of members) {
    const member = certificationMember(archive, memberPath);
    assert.deepEqual(member.bytes, bytes, memberPath);
    assert.equal(member.sha256, (await import("node:crypto")).createHash("sha256")
      .update(bytes).digest("hex"));
    assert.deepEqual(member.value, JSON.parse(bytes.toString("utf8")));
  }
  const bundle = JSON.parse(decodeCertificationArtifact(
    await readFile(path.join(directory, CERTIFICATION_ARCHIVE_NAME))));
  assert.equal(bundle.schema_version, CERTIFICATION_BUNDLE_SCHEMA);
  assert.deepEqual([bundle.profile_id, bundle.profile_version],
    [identity.profile_id, identity.profile_version]);
});

test("reads are pure and never fall back to raw JSON", async (t) => {
  const directory = await temporaryDirectory(t);
  await writeCertificationArchive(directory, identity, members);
  const archivePath = path.join(directory, CERTIFICATION_ARCHIVE_NAME);
  const before = [await readFile(archivePath), (await stat(archivePath)).mtimeMs];
  await readCertificationArchive(directory, { identity });
  assert.deepEqual([await readFile(archivePath), (await stat(archivePath)).mtimeMs], before);
  assert.deepEqual(await readdir(directory), [CERTIFICATION_ARCHIVE_NAME]);

  const raw = path.join(directory, "raw");
  await mkdir(raw);
  await writeFile(path.join(raw, "adequacy.json"), members.get("adequacy.json"));
  await refusesAsync(readCertificationArchive(raw), "certification_archive_missing");
  assert.deepEqual(await readdir(raw), ["adequacy.json"]);
  const archive = await readCertificationArchive(directory, { identity });
  refuses(() => certificationMember(archive, "negative-fixtures/absent.json"),
    "certification_member_missing");
});

test("truncated, extended, corrupted and non-canonical framing refuse explicitly", () => {
  const encoded = encodeCertificationArtifact(serializeCertificationBundle(identity, members));
  const flipped = (offset) => {
    const copy = Buffer.from(encoded);
    copy[offset] ^= 0xff;
    return copy;
  };
  const withByte = (offset, value) => {
    const copy = Buffer.from(encoded);
    copy[offset] = value;
    return copy;
  };
  const cases = [
    [Buffer.alloc(0), "x_gzip_truncated"],
    [encoded.subarray(0, 12), "x_gzip_truncated"],
    [encoded.subarray(0, encoded.length - 3), "x_gzip_truncated"],
    [Buffer.concat([encoded, Buffer.from([0])]), "x_gzip_framing_invalid"],
    [Buffer.concat([encoded, encoded]), "x_gzip_framing_invalid"],
    [Buffer.from("{\"stored\":\"as raw JSON, not gzip\"}"), "x_gzip_framing_invalid"],
    [withByte(3, 0x08), "x_gzip_framing_invalid"],
    [withByte(4, 0x01), "x_gzip_framing_invalid"],
    [flipped(encoded.length - 8), "x_gzip_integrity_mismatch"],
    [flipped(encoded.length - 1), "x_gzip_integrity_mismatch"]
  ];
  for (const [bytes, code] of cases) {
    refuses(() => decodeCertificationArtifact(bytes, { label: "x" }), code);
  }
  assert.throws(() => decodeCertificationArtifact(flipped(14), { label: "x" }),
    (error) => /^x_gzip_(corrupt|integrity_mismatch|truncated|framing_invalid)$/u
      .test(error.code));
});

test("encoded and decoded sizes are bounded before unbounded allocation", () => {
  const header = encodeCertificationArtifact("{}").subarray(0, 10);
  const bomb = Buffer.concat([header,
    deflateRawSync(Buffer.alloc(CERTIFICATION_ARTIFACT_MAX_DECODED_BYTES + 1)), Buffer.alloc(8)]);
  assert.ok(bomb.length < 64 * 1024, "a small archive can claim a huge decoded size");
  refuses(() => decodeCertificationArtifact(bomb, { label: "x" }), "x_decoded_size_exceeded");
  refuses(() => decodeCertificationArtifact(
    Buffer.alloc(CERTIFICATION_ARTIFACT_MAX_ENCODED_BYTES + 1), { label: "x" }),
  "x_encoded_size_exceeded");
  assert.throws(() => encodeCertificationArtifact(
    Buffer.alloc(CERTIFICATION_ARTIFACT_MAX_DECODED_BYTES + 1)),
  { code: "certification_archive_decoded_size_exceeded" });
});

test("malformed content, bundle shape and identity refuse explicitly", async (t) => {
  const directory = await temporaryDirectory(t);
  const archivePath = path.join(directory, CERTIFICATION_ARCHIVE_NAME);
  const store = (bytes) => writeFile(archivePath, encodeCertificationArtifact(bytes));
  const bundle = JSON.parse(serializeCertificationBundle(identity, members));

  await store(Buffer.from([0x7b, 0xff, 0x7d]));
  await refusesAsync(readCertificationArchive(directory), "certification_archive_utf8_invalid");
  await store("{not json");
  await refusesAsync(readCertificationArchive(directory), "certification_archive_invalid_json");
  for (const mutate of [
    (value) => { value.schema_version = "controlled-contract-certification-bundle.v0"; },
    (value) => { value.extra = true; },
    (value) => { value.members.reverse(); },
    (value) => { value.members.push(structuredClone(value.members[0])); },
    (value) => { value.members[0].path = "../adequacy.json"; },
    (value) => { value.members[0].path = "adequacy.json.gz"; },
    (value) => { value.members[0].text = 1; }
  ]) {
    const value = structuredClone(bundle);
    mutate(value);
    await store(JSON.stringify(value));
    await refusesAsync(readCertificationArchive(directory),
      "certification_archive_bundle_invalid");
  }
  await store(JSON.stringify(bundle));
  await refusesAsync(readCertificationArchive(directory, {
    identity: { ...identity, profile_version: "2.0.0" }
  }), "certification_archive_identity_mismatch");

  const invalidMember = structuredClone(bundle);
  invalidMember.members.find(({ path: memberPath }) => memberPath === "adequacy.json").text =
    "{truncated";
  await store(JSON.stringify(invalidMember));
  const archive = await readCertificationArchive(directory, { identity });
  refuses(() => certificationMember(archive, "adequacy.json", { label: "adequacy" }),
    "adequacy_invalid_json");
});
