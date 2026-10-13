

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { parseAttemptDriverFrame, parseCompletionPublicationFailure } from
  "../../packages/agent-launch-cli/src/lib/test-execution/confined-invocation.mjs";

const STATUS = "workspace-agent-runner-attempt-status.v3";
const frame = (status, body = Buffer.alloc(0)) =>
  Buffer.concat([Buffer.from(`${JSON.stringify(status)}\n`), body]);
const declared = (body) => ({ kind: "fd", bytes: body.length, overflow: false,
  sha256: createHash("sha256").update(body).digest("hex") });
const SHA = "a".repeat(64);

test("a complete frame yields the status and the exact channel bytes", () => {
  const body = Buffer.from('{"v":1}\n');
  const parsed = parseAttemptDriverFrame(frame({ schema_version: STATUS, phase: "exited", exit_code: 0,
    channel: declared(body) }, body));
  assert.equal(parsed.frame_error, null);
  assert.equal(parsed.status.phase, "exited");
  assert.deepEqual(parsed.channel.bytes, body);
  const without = parseAttemptDriverFrame(frame({ schema_version: STATUS, phase: "exited", channel: null }));
  assert.deepEqual([without.frame_error, without.channel], [null, null]);
  const overflow = parseAttemptDriverFrame(frame({ schema_version: STATUS, phase: "exited",
    channel: { kind: "fd", bytes: 0, overflow: true, sha256: null } }));
  assert.deepEqual([overflow.frame_error, overflow.channel.overflow, overflow.channel.bytes], [null, true, null]);
});

test("a file channel states its measured length and digest and carries no bytes", () => {

  const measured = parseAttemptDriverFrame(frame({ schema_version: STATUS, phase: "exited", exit_code: 0,
    channel: { kind: "file", bytes: 50 * 1024 * 1024, sha256: SHA } }));
  assert.deepEqual([measured.frame_error, measured.status.exit_code, measured.channel],
    [null, 0, { kind: "file", bytes: null, size: 50 * 1024 * 1024, sha256: SHA, error: null }]);
  const empty = parseAttemptDriverFrame(frame({ schema_version: STATUS, phase: "exited",
    channel: { kind: "file", bytes: 0, sha256: SHA } }));
  assert.deepEqual([empty.frame_error, empty.channel.size], [null, 0]);

  const unreadable = parseAttemptDriverFrame(frame({ schema_version: STATUS, phase: "exited", exit_code: 1,
    channel: { kind: "file", error: "EACCES" } }));
  assert.deepEqual([unreadable.frame_error, unreadable.status.exit_code, unreadable.channel],
    [null, 1, { kind: "file", bytes: null, size: null, sha256: null, error: "EACCES" }]);
});

test("incomplete or inconsistent frames are refused", () => {
  const body = Buffer.from('{"v":1}\n');
  const status = { schema_version: STATUS, phase: "exited", channel: declared(body) };
  const refused = (bytes, code) => {
    const parsed = parseAttemptDriverFrame(bytes);
    assert.deepEqual([parsed.status, parsed.channel, parsed.frame_error], [null, null, code]);
  };
  refused(Buffer.alloc(0), "status_missing");
  refused(undefined, "status_missing");
  refused(Buffer.from('{"schema_version":'), "status_missing");
  refused(Buffer.from("not json\n"), "status_invalid");

  refused(frame({ ...status, schema_version: "workspace-agent-runner-attempt-status.v2" }, body), "status_invalid");
  refused(frame(status, body.subarray(0, 3)), "channel_digest_mismatch");
  refused(frame(status, Buffer.concat([body, Buffer.from("x")])), "channel_digest_mismatch");
  refused(frame({ ...status, channel: { ...status.channel, sha256: "0".repeat(64) } }, body),
    "channel_digest_mismatch");
  refused(frame({ ...status, channel: null }, body), "channel_unexpected");
  refused(frame({ ...status, channel: { kind: "fd", bytes: 0, overflow: true, sha256: null } }, body),
    "channel_unexpected");

  refused(frame({ ...status, channel: { bytes: body.length, sha256: status.channel.sha256 } }, body),
    "channel_invalid");
  refused(frame({ ...status, channel: { ...status.channel, kind: "socket" } }, body), "channel_invalid");

  const file = { kind: "file", bytes: body.length, sha256: status.channel.sha256 };
  refused(frame({ ...status, channel: file }, body), "channel_unexpected");
  refused(frame({ ...status, channel: { kind: "file", error: "EACCES" } }, body), "channel_unexpected");
  for (const invalid of [{ ...file, bytes: -1 }, { ...file, bytes: "8" }, { ...file, bytes: 1.5 },
    { ...file, sha256: "abc" }, { ...file, sha256: null }, { kind: "file" }, { ...file, error: "" },
    { kind: "file", error: "x".repeat(129) }, { kind: "file", error: 5 }]) {
    refused(frame({ ...status, channel: invalid }), "channel_invalid");
  }
});

test("the driver's stated publication failure is read from its last well-formed marked line", () => {
  const MARKER = "[attempt-driver] completion frame not published:";
  const stated = (value) => `${MARKER} ${JSON.stringify(value)}`;
  const failure = { error: "EPIPE", written_bytes: 12, frame_bytes: 118 };
  assert.deepEqual(parseCompletionPublicationFailure(`test output\n${stated(failure)}\n`), failure);
  assert.deepEqual(parseCompletionPublicationFailure(
    `${stated({ error: "EBADF", written_bytes: 0, frame_bytes: 9 })}\n${stated(failure)}\ntrailing`), failure);

  assert.deepEqual(parseCompletionPublicationFailure(`${stated(failure)}\n${MARKER} not json\n`), failure);
  for (const absent of [undefined, null, "", "  4 tests passed\n", `prefix ${stated(failure)}\n`,
    `${MARKER} not json\n`, stated({ ...failure, error: "" }), stated({ ...failure, error: 5 }),
    stated({ ...failure, error: "x".repeat(129) }), stated({ ...failure, written_bytes: -1 }),
    stated({ ...failure, written_bytes: 119 }), stated({ ...failure, frame_bytes: "118" }), stated(null)]) {
    assert.equal(parseCompletionPublicationFailure(absent), null, String(absent));
  }
});
