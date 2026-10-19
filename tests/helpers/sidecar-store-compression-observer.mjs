import { DatabaseSync } from "node:sqlite";
import { syncBuiltinESMExports } from "node:module";
import zlib from "node:zlib";

export function observeStoreCompression(t) {
  let mocked = null;
  let active = false;
  const restore = () => {
    if (!active) return;
    active = false;
    mocked.mock.restore();
    syncBuiltinESMExports();
  };
  t.after(restore);
  mocked = t.mock.method(zlib, "deflateSync");
  active = true;
  syncBuiltinESMExports();
  return {

    inputs: () => mocked.mock.calls.map((call) => Buffer.from(call.arguments[0])),
    restore
  };
}

export async function compressedDuring(t, run) {
  const observer = observeStoreCompression(t);
  try {
    const result = await run();
    return { result, compressed: observer.inputs() };
  } catch (error) {
    error.compressed = observer.inputs();
    throw error;
  } finally {
    observer.restore();
  }
}

export function observeStoreDocumentDecoding(t) {
  const reads = [];
  const decoded = [];
  const mocks = [];
  let active = true;
  const restore = () => {
    if (!active) return;
    active = false;
    for (const mock of mocks.reverse()) mock.mock.restore();
    syncBuiltinESMExports();
  };
  t.after(restore);
  const originalPrepare = DatabaseSync.prototype.prepare;
  mocks.push(t.mock.method(DatabaseSync.prototype, "prepare", function(sql, ...args) {
    const statement = originalPrepare.call(this, sql, ...args);
    if (/SELECT d\.did,.*d\.payload[\s\S]*FROM provider_documents d/u.test(sql)) {
      const all = statement.all;
      mocks.push(t.mock.method(statement, "all", function(...parameters) {
        const rows = all.apply(this, parameters);
        reads.push(...rows.map(row => ({ provider_id: row.provider_key, path: row.document_path,
          mode: row.payload[0] })));
        return rows;
      }));
    }
    return statement;
  }));
  const originalDecode = TextDecoder.prototype.decode;
  mocks.push(t.mock.method(TextDecoder.prototype, "decode", function(...args) {
    const value = originalDecode.apply(this, args);
    if (value.startsWith('{"occurrences":')) decoded.push(value);
    return value;
  }));
  const inflate = t.mock.method(zlib, "inflateSync");
  mocks.push(inflate);
  syncBuiltinESMExports();
  return {
    snapshot: () => ({ reads: structuredClone(reads), decoded: [...decoded],
      compressed_decoded: inflate.mock.calls.filter(call => call.result instanceof Uint8Array &&
        Buffer.from(call.result).toString("utf8").startsWith('{"occurrences":')).length }),
    restore
  };
}
