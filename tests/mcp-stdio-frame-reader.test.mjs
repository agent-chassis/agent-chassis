import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

import {
  createFrameParser,
  createChildFrameReader
} from "./fixtures/mcp-stdio-frame-reader.mjs";

const FRAME = (id) => `${JSON.stringify({ jsonrpc: "2.0", id, result: { ok: true } })}\n`;

function spawnEmitter(source) {
  return spawn(process.execPath, ["-e", source], { stdio: ["pipe", "pipe", "pipe"] });
}

async function reap(child, reader) {
  if (!reader.exitInfo) child.kill("SIGKILL");
  const exit = await reader.waitForExit();
  reader.dispose();
  return exit;
}

test("frame parser emits a frame only once its terminating newline arrives", () => {
  const parser = createFrameParser();
  assert.deepEqual(parser.push('{"id":1}'), []);
  assert.equal(parser.pendingBytes, '{"id":1}');

  const frames = parser.push("\n");
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0].message, { id: 1 });
  assert.equal(parser.pendingBytes, "");
});

test("frame parser reassembles a frame fragmented one byte at a time", () => {
  const parser = createFrameParser();
  const bytes = [...FRAME(7)];
  const collected = [];
  for (const byte of bytes) {
    collected.push(...parser.push(byte));
  }
  assert.equal(collected.length, 1);
  assert.equal(collected[0].message.id, 7);
  assert.equal(parser.pendingBytes, "");
});

test("frame parser splits multiple frames delivered in a single chunk", () => {
  const parser = createFrameParser();
  const frames = parser.push(`${FRAME(1)}${FRAME(2)}${FRAME(3)}`);
  assert.deepEqual(frames.map((frame) => frame.message.id), [1, 2, 3]);
  assert.ok(frames.every((frame) => frame.ok));
});

test("frame parser preserves order and residue across a chunk boundary mid-frame", () => {
  const parser = createFrameParser();
  const stream = `${FRAME(1)}${FRAME(2)}`;
  const cut = stream.indexOf("\n") + 5;

  const first = parser.push(stream.slice(0, cut));
  assert.deepEqual(first.map((frame) => frame.message.id), [1]);
  assert.notEqual(parser.pendingBytes, "");

  const second = parser.push(stream.slice(cut));
  assert.deepEqual(second.map((frame) => frame.message.id), [2]);
  assert.equal(parser.pendingBytes, "");
});

test("frame parser reports a malformed frame without throwing or dropping later frames", () => {
  const parser = createFrameParser();
  const frames = parser.push(`{"id":1,\n${FRAME(2)}`);
  assert.equal(frames.length, 2);
  assert.equal(frames[0].ok, false);
  assert.equal(frames[0].raw, '{"id":1,');
  assert.ok(frames[0].error instanceof Error);
  assert.equal(frames[1].ok, true);
  assert.equal(frames[1].message.id, 2);
});

test("frame parser skips blank padding lines and strips CRLF", () => {
  const parser = createFrameParser();
  const frames = parser.push(`\n\r\n${JSON.stringify({ id: 9 })}\r\n`);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].message.id, 9);
});

test("reader observes a frame emitted synchronously at child startup", async () => {

  const child = spawnEmitter(
    `process.stdout.write(${JSON.stringify(FRAME(1))}); setInterval(() => {}, 1000);`
  );
  const reader = createChildFrameReader(child, { label: "sync-emitter" });
  try {
    const { message } = await reader.waitForResponse(1);
    assert.deepEqual(message.result, { ok: true });
  } finally {
    await reap(child, reader);
  }
});

test("reader replays an already-arrived frame to a waiter registered afterwards", async () => {

  const child = spawnEmitter(`process.stdout.write(${JSON.stringify(FRAME(1))}); process.exit(0);`);
  const reader = createChildFrameReader(child, { label: "replay-emitter" });
  try {
    const exit = await reader.waitForExit();
    assert.equal(exit.code, 0);

    const { message } = await reader.waitForResponse(1);
    assert.equal(message.id, 1);
    assert.equal(reader.frames.length, 1);
  } finally {
    reader.dispose();
  }
});

test("reader reassembles a frame the child writes in fragments", async () => {
  const child = spawnEmitter(
    `const frame = ${JSON.stringify(FRAME(42))};` +
      "let i = 0;" +
      "const t = setInterval(() => {" +
      "  process.stdout.write(frame[i++]);" +
      "  if (i >= frame.length) { clearInterval(t); setInterval(() => {}, 1000); }" +
      "}, 1);"
  );
  const reader = createChildFrameReader(child, { label: "fragment-emitter" });
  try {
    const { message } = await reader.waitForResponse(42);
    assert.deepEqual(message.result, { ok: true });

    assert.equal(reader.frames.length, 1);
  } finally {
    await reap(child, reader);
  }
});

test("reader resolves each of multiple frames independently and in order", async () => {
  const child = spawnEmitter(
    `process.stdout.write(${JSON.stringify(`${FRAME(1)}${FRAME(2)}${FRAME(3)}`)});` +
      "setInterval(() => {}, 1000);"
  );
  const reader = createChildFrameReader(child, { label: "multi-emitter" });
  try {

    assert.equal((await reader.waitForResponse(3)).message.id, 3);
    assert.equal((await reader.waitForResponse(1)).message.id, 1);
    assert.equal((await reader.waitForResponse(2)).message.id, 2);
    assert.deepEqual(reader.frames.map((frame) => frame.message.id), [1, 2, 3]);
  } finally {
    await reap(child, reader);
  }
});

test("reader rejects a pending waiter on early EOF instead of waiting for a timeout", async () => {

  const child = spawnEmitter("process.exit(0);");
  const reader = createChildFrameReader(child, { label: "eof-emitter" });
  try {
    await assert.rejects(
      reader.waitForResponse(1),
      (error) => {
        assert.match(error.message, /eof-emitter/);
        assert.match(error.message, /EOF before a matching frame|exited before a matching frame/);
        assert.match(error.message, /frames_observed=0/);
        return true;
      }
    );
  } finally {
    await reap(child, reader);
  }
});

test("reader reports a truncated frame at EOF rather than silently succeeding", async () => {
  const child = spawnEmitter('process.stdout.write(\'{"id":1,"resu\'); process.exit(0);');
  const reader = createChildFrameReader(child, { label: "truncated-emitter" });
  try {
    await assert.rejects(reader.waitForResponse(1), /truncated frame|exited before a matching frame/);
    assert.equal(reader.frames.length, 0);
  } finally {
    await reap(child, reader);
  }
});

test("reader records a malformed frame and does not resolve a waiter with it", async () => {
  const child = spawnEmitter(
    `process.stdout.write("this is not json\\n"); process.stdout.write(${JSON.stringify(FRAME(1))});` +
      "setInterval(() => {}, 1000);"
  );
  const reader = createChildFrameReader(child, { label: "malformed-emitter" });
  try {

    const { message } = await reader.waitForResponse(1);
    assert.equal(message.id, 1);

    const [malformed, valid] = reader.frames;
    assert.equal(malformed.ok, false);
    assert.equal(malformed.raw, "this is not json");
    assert.equal(valid.ok, true);
  } finally {
    await reap(child, reader);
  }
});

test("reader rejects a pending waiter when the child crashes, carrying stderr", async () => {

  const child = spawnEmitter('process.stderr.write("boom: refusing to start\\n"); process.exit(3);');
  const reader = createChildFrameReader(child, { label: "crash-emitter" });
  try {
    await assert.rejects(reader.waitForResponse(1), (error) => {
      assert.match(error.message, /boom: refusing to start/);
      assert.match(error.message, /frames_observed=0/);
      return true;
    });
    assert.deepEqual(await reader.waitForExit(), { code: 3, signal: null });
  } finally {
    reader.dispose();
  }
});

test("reader rejects a pending waiter on a spawn error", async () => {
  const child = spawn("agent-chassis-no-such-binary-WK-1678", [], {
    stdio: ["pipe", "pipe", "pipe"]
  });
  const reader = createChildFrameReader(child, { label: "spawn-error" });
  try {
    await assert.rejects(reader.waitForResponse(1), /process error/);
  } finally {
    reader.dispose();
  }
});

test("waitForExit resolves immediately for an already-exited child", async () => {

  const child = spawnEmitter("process.exit(0);");
  const reader = createChildFrameReader(child, { label: "exit-twice" });
  try {
    const first = await reader.waitForExit();
    assert.deepEqual(first, { code: 0, signal: null });
    assert.notEqual(reader.exitInfo, null);

    const second = await reader.waitForExit();
    assert.deepEqual(second, first);
  } finally {
    reader.dispose();
  }
});

test("dispose removes every listener the reader installed and is idempotent", async () => {
  const child = spawnEmitter("setInterval(() => {}, 1000);");
  const before = {
    stdoutData: child.stdout.listenerCount("data"),
    stdoutEnd: child.stdout.listenerCount("end"),
    stderrData: child.stderr.listenerCount("data"),
    exit: child.listenerCount("exit"),
    error: child.listenerCount("error")
  };

  const reader = createChildFrameReader(child, { label: "cleanup" });
  const attached = reader.listenerCounts;
  assert.equal(attached.stdoutData, before.stdoutData + 1);
  assert.equal(attached.stdoutEnd, before.stdoutEnd + 1);
  assert.equal(attached.stderrData, before.stderrData + 1);
  assert.equal(attached.exit, before.exit + 1);
  assert.equal(attached.error, before.error + 1);

  reader.dispose();
  assert.deepEqual(reader.listenerCounts, before);
  assert.equal(reader.disposed, true);

  reader.dispose();
  assert.deepEqual(reader.listenerCounts, before);

  child.kill("SIGKILL");
  await reader.waitForExit();
});

test("dispose settles an outstanding waiter instead of leaking a pending promise", async () => {
  const child = spawnEmitter("setInterval(() => {}, 1000);");
  const reader = createChildFrameReader(child, { label: "dispose-waiter" });
  const pending = reader.waitForResponse(1);

  reader.dispose();
  await assert.rejects(pending, /disposed/);

  await assert.rejects(reader.waitForResponse(1), /disposed/);

  child.kill("SIGKILL");
  await reader.waitForExit();
});
