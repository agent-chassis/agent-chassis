

import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const ERRNO = Object.freeze({ EACCES: -13, EIO: -5 });

export function injectFilesystemFault(t, { operation, path: faultPath, code = "EIO", descriptor = false }) {
  const original = fs[operation];
  const { fstatSync, statSync } = fs;
  if (typeof original !== "function") throw new Error(`unknown node:fs operation: ${operation}`);
  const syscall = operation.replace(/Sync$/u, "");
  const error = Object.assign(
    new Error(`${code}: injected test fault, ${syscall} '${faultPath}'`,
      { cause: { injected_test_fault: true } }),
    { code, errno: ERRNO[code] ?? -1, syscall, path: faultPath }
  );
  const fault = { error, hits: 0, descriptors: [], restore };
  function targeted(target) {
    if (!descriptor) return String(target) === faultPath;
    if (!Number.isInteger(target)) return false;
    let opened;
    let named;
    try {
      opened = fstatSync(target);
      named = statSync(faultPath);
    } catch {
      return false;
    }
    return opened.dev === named.dev && opened.ino === named.ino;
  }
  function restore() {
    if (fs[operation] === faulted) {
      fs[operation] = original;
      syncBuiltinESMExports();
    }
  }
  function faulted(target, ...rest) {
    if (targeted(target)) {
      fault.hits += 1;
      if (descriptor) fault.descriptors.push(target);
      throw error;
    }
    return original.call(this, target, ...rest);
  }

  Object.assign(faulted, original);
  t.after(restore);
  fs[operation] = faulted;
  syncBuiltinESMExports();
  return fault;
}
