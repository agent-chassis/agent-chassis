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
