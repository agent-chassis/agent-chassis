

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { parseAttemptDriverFrame } from
  "../../packages/agent-launch-cli/src/lib/test-execution/confined-invocation.mjs";

const STATUS = "workspace-agent-runner-attempt-status.v2";
const frame = (status, body = Buffer.alloc(0)) =>
  Buffer.concat([Buffer.from(`${JSON.stringify(status)}\n`), body]);
const declared = (body) => ({ bytes: body.length,
  sha256: createHash("sha256").update(body).digest("hex") });

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
    channel: { overflow: true } }));
  assert.deepEqual([overflow.frame_error, overflow.channel.overflow, overflow.channel.bytes], [null, true, null]);
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
  refused(frame({ ...status, schema_version: "workspace-agent-runner-attempt-status.v1" }, body), "status_invalid");
  refused(frame(status, body.subarray(0, 3)), "channel_digest_mismatch");
  refused(frame(status, Buffer.concat([body, Buffer.from("x")])), "channel_digest_mismatch");
  refused(frame({ ...status, channel: { ...status.channel, sha256: "0".repeat(64) } }, body),
    "channel_digest_mismatch");
  refused(frame({ ...status, channel: null }, body), "channel_unexpected");
  refused(frame({ ...status, channel: { overflow: true } }, body), "channel_unexpected");
  refused(frame({ ...status, channel: { error: "EACCES" } }, body), "channel_unexpected");
});
