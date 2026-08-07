#!/usr/bin/env node
import { createConnection } from 'node:net';
import { constants as fsConstants, promises as fs } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const PROJECTED_ENDPOINT = '/run/agent-launch/mcp.sock';
export const PROJECTED_TOKEN_FILE = '/run/agent-launch/mcp.token';

const TOKEN_HEX_BYTES = 64;
const TOKEN_FILE_BYTES = TOKEN_HEX_BYTES + 1;
const ACKNOWLEDGEMENT_DEADLINE_MS = 40000;
const PRELUDE_PREFIX = Buffer.from('agent-chassis-v1 ', 'ascii');
const ACKNOWLEDGEMENT = Buffer.from('agent-chassis-v1 OK\n', 'ascii');

export const CONNECTOR_ERRORS = Object.freeze({
  TOKEN_MISSING: 'MCP_CONNECTOR_TOKEN_MISSING',
  TOKEN_INVALID: 'MCP_CONNECTOR_TOKEN_INVALID',
  ENDPOINT_CLOSED: 'MCP_CONNECTOR_ENDPOINT_CLOSED',
  AUTH_REJECTED: 'MCP_CONNECTOR_AUTH_REJECTED',
  AUTH_CLOSED: 'MCP_CONNECTOR_AUTH_CLOSED',
  AUTH_TIMEOUT: 'MCP_CONNECTOR_AUTH_TIMEOUT',
  IO_FAILED: 'MCP_CONNECTOR_IO_FAILED',
});

const failure = (code) => {
  const error = new Error(code);
  error.code = code;
  return error;
};

const equalBytes = (left, right) =>
  left.length === right.length && Buffer.compare(left, right) === 0;

export async function readProjectedToken() {
  let token;
  try {
    token = await fs.readFile(PROJECTED_TOKEN_FILE, {
      flag: fsConstants.O_RDONLY,
    });
  } catch {
    throw failure(CONNECTOR_ERRORS.TOKEN_MISSING);
  }

  if (
    token.length !== TOKEN_FILE_BYTES
    || token[TOKEN_HEX_BYTES] !== 0x0a
    || [...token.subarray(0, TOKEN_HEX_BYTES)].some((byte) => (
      !((byte >= 0x30 && byte <= 0x39) || (byte >= 0x61 && byte <= 0x66))
    ))
  ) {
    token.fill(0);
    throw failure(CONNECTOR_ERRORS.TOKEN_INVALID);
  }
  return token;
}

export const waitForAcknowledgement = (socket) => new Promise((resolve, reject) => {
  let received = Buffer.alloc(0);
  let settled = false;
  let acknowledgementDeadline;

  const finish = (error, remainder = Buffer.alloc(0)) => {
    if (settled) return;
    settled = true;
    clearTimeout(acknowledgementDeadline);
    socket.off('data', onData);
    socket.off('end', onEnd);
    socket.off('close', onClose);
    socket.off('error', onError);
    if (error) reject(error);
    else resolve(remainder);
  };

  const onData = (chunk) => {
    received = Buffer.concat([received, chunk]);
    if (received.length < ACKNOWLEDGEMENT.length) return;
    if (!equalBytes(received.subarray(0, ACKNOWLEDGEMENT.length), ACKNOWLEDGEMENT)) {
      finish(failure(CONNECTOR_ERRORS.AUTH_REJECTED));
      return;
    }
    finish(null, received.subarray(ACKNOWLEDGEMENT.length));
  };
  const onEnd = () => finish(failure(CONNECTOR_ERRORS.AUTH_CLOSED));
  const onClose = () => finish(failure(CONNECTOR_ERRORS.AUTH_CLOSED));
  const onError = () => finish(failure(CONNECTOR_ERRORS.IO_FAILED));
  acknowledgementDeadline = setTimeout(
    () => finish(failure(CONNECTOR_ERRORS.AUTH_TIMEOUT)),
    ACKNOWLEDGEMENT_DEADLINE_MS,
  );
  socket.on('data', onData);
  socket.once('end', onEnd);
  socket.once('close', onClose);
  socket.once('error', onError);
});

const openEndpoint = () => new Promise((resolve, reject) => {
  let settled = false;
  const socket = createConnection({ path: PROJECTED_ENDPOINT });
  const fail = (error) => {
    if (settled) return;
    settled = true;
    socket.destroy();
    reject(error);
  };
  socket.once('connect', () => {
    if (settled) return;
    settled = true;
    resolve(socket);
  });
  socket.once('error', () => fail(failure(CONNECTOR_ERRORS.ENDPOINT_CLOSED)));
  socket.once('close', () => {
    if (!settled) fail(failure(CONNECTOR_ERRORS.ENDPOINT_CLOSED));
  });
});

export async function connectAndProxy({
  input = process.stdin,
  output = process.stdout,
} = {}) {
  const token = await readProjectedToken();
  let socket;
  let prelude;
  try {
    socket = await openEndpoint();
    prelude = Buffer.concat([PRELUDE_PREFIX, token]);
    socket.write(prelude);
    const remainder = await waitForAcknowledgement(socket);
    if (remainder.length > 0) output.write(remainder);
    input.pipe(socket);
    socket.pipe(output);
    await new Promise((resolve, reject) => {
      const onError = () => reject(failure(CONNECTOR_ERRORS.IO_FAILED));
      socket.once('error', onError);
      socket.once('close', resolve);
      input.once('error', onError);
      output.once('error', onError);
    });
  } catch (error) {
    socket?.destroy();
    throw error?.code ? error : failure(CONNECTOR_ERRORS.IO_FAILED);
  } finally {
    prelude?.fill(0);
    token.fill(0);
  }
}

const main = async () => {
  try {
    await connectAndProxy();
  } catch (error) {
    process.stderr.write(`${error?.code || CONNECTOR_ERRORS.IO_FAILED}\n`);
    process.exitCode = 1;
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
