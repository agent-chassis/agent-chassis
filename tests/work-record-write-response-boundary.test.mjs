import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPACT_WRITE_DIAGNOSTIC_LIMITS,
  shapeWriteResponse
} from "../packages/wiki-mcp/src/lib/write-response-boundary.mjs";

const VERBOSE_NEXT_ACTION =
  "Re-call this tool with verbose:true to inspect suppressed write detail";

function oversized(prefix, limit) {
  return `${prefix}${"x".repeat(limit + 10)}`;
}

function restoreOwnDescriptor(target, key, descriptor) {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor);
  } else {
    delete target[key];
  }
}

test("compact diagnostics retain the first 20 in order with declared field caps and accurate metadata", () => {
  const diagnostics = Array.from({ length: 23 }, (_, index) => ({
    code: `stable_code_${String(index).padStart(2, "0")}`,
    severity: index % 2 === 0 ? "error" : "warning",
    message:
      index < 2 || index >= 20
        ? oversized(`message-${index}-`, COMPACT_WRITE_DIAGNOSTIC_LIMITS.message)
        : `message-${index}`,
    path:
      index < 3 || index >= 20
        ? oversized(`path-${index}-`, COMPACT_WRITE_DIAGNOSTIC_LIMITS.path)
        : `path-${index}`,
    value:
      index < 4 || index >= 20
        ? oversized(`value-${index}-`, COMPACT_WRITE_DIAGNOSTIC_LIMITS.value)
        : `value-${index}`,
    bounded_context: `context-${index}`
  }));

  const compact = shapeWriteResponse({
    ok: false,
    valid: false,
    written: false,
    diagnostics
  });

  assert.equal(compact.diagnostics.length, COMPACT_WRITE_DIAGNOSTIC_LIMITS.count);
  assert.deepEqual(
    compact.diagnostics.map((diagnostic) => diagnostic.code),
    diagnostics.slice(0, COMPACT_WRITE_DIAGNOSTIC_LIMITS.count).map(
      (diagnostic) => diagnostic.code
    )
  );
  for (const [index, diagnostic] of compact.diagnostics.entries()) {
    assert.equal(diagnostic.code, diagnostics[index].code);
    assert.equal(diagnostic.severity, diagnostics[index].severity);
    assert.equal(diagnostic.bounded_context, diagnostics[index].bounded_context);
    assert.equal(
      diagnostic.message,
      diagnostics[index].message.slice(0, COMPACT_WRITE_DIAGNOSTIC_LIMITS.message)
    );
    assert.equal(
      diagnostic.path,
      diagnostics[index].path.slice(0, COMPACT_WRITE_DIAGNOSTIC_LIMITS.path)
    );
    assert.equal(
      diagnostic.value,
      diagnostics[index].value.slice(0, COMPACT_WRITE_DIAGNOSTIC_LIMITS.value)
    );
  }
  assert.deepEqual(compact.diagnostics_truncation, {
    truncated: true,
    total_count: 23,
    returned_count: 20,
    omitted_count: 3,
    limits: COMPACT_WRITE_DIAGNOSTIC_LIMITS,
    truncated_fields: {
      message: 2,
      path: 3,
      value: 4
    }
  });
  assert.equal(compact.detail_available, true);
  assert.equal(compact.next_action, VERBOSE_NEXT_ACTION);
});

test("a response within compact primitive limits retains its shape without truncation metadata", () => {
  const response = {
    ok: false,
    valid: false,
    written: false,
    no_op: false,
    diagnostics: [
      {
        code: "stable_invalid_record",
        severity: "error",
        message: "The work record is invalid",
        path: "acceptance.criteria",
        value: "invalid",
        bounded_context: "preserved"
      }
    ],
    next_action: "Repair the invalid acceptance criteria"
  };

  const compact = shapeWriteResponse(response);

  assert.deepEqual(compact, response);
  assert.equal(Object.hasOwn(compact, "diagnostics_truncation"), false);
  assert.equal(Object.hasOwn(compact, "detail_available"), false);
});

test("compact truncation preserves next_action and supplies the verbose hint only when absent", () => {
  const diagnostic = {
    code: "oversized_message",
    severity: "error",
    message: oversized("message-", COMPACT_WRITE_DIAGNOSTIC_LIMITS.message)
  };
  const existingNextAction = "Use the route-specific recovery action";

  const withExistingAction = shapeWriteResponse({
    valid: false,
    written: false,
    diagnostics: [diagnostic],
    next_action: existingNextAction
  });
  const withoutExistingAction = shapeWriteResponse({
    valid: false,
    written: false,
    diagnostics: [diagnostic]
  });

  assert.equal(withExistingAction.next_action, existingNextAction);
  assert.equal(withExistingAction.detail_available, true);
  assert.equal(withoutExistingAction.next_action, VERBOSE_NEXT_ACTION);
  assert.equal(withoutExistingAction.detail_available, true);
});

test("compact values retain only inert bounded primitives and stable sentinels", () => {
  let hostileCalls = 0;
  const manyKeys = {};
  for (let index = 0; index < 20_000; index += 1) {
    manyKeys[`key_${index}`] = index;
  }
  manyKeys.nested = { payload: "n".repeat(2_000_000) };
  Object.defineProperty(manyKeys, "hostile", {
    enumerable: true,
    get() {
      hostileCalls += 1;
      throw new Error("nested diagnostic getters must not execute");
    }
  });
  manyKeys.toJSON = () => {
    hostileCalls += 1;
    throw new Error("nested diagnostic toJSON must not execute");
  };

  const throwingTrap = () => {
    hostileCalls += 1;
    throw new Error("nested Proxy traps must not execute");
  };
  const proxy = new Proxy({}, {
    get: throwingTrap,
    getOwnPropertyDescriptor: throwingTrap,
    getPrototypeOf: throwingTrap,
    ownKeys: throwingTrap
  });
  const unsupported = [
    manyKeys,
    [1, 2, 3],
    1n,
    Symbol("value"),
    () => "value",
    Number.NaN,
    Number.POSITIVE_INFINITY,
    new Date(0),
    new Map([["key", "value"]]),
    new Set([1]),
    new Uint8Array([1, 2]),
    proxy
  ];
  const response = {
    valid: false,
    written: false,
    diagnostics: unsupported.map((value, index) => ({
      code: `unsupported_${index}`,
      severity: "error",
      message: "unsupported",
      value
    }))
  };

  const first = shapeWriteResponse(response);
  const second = shapeWriteResponse(response);

  assert.equal(hostileCalls, 0);
  assert.deepEqual(second, first);
  assert.deepEqual(
    first.diagnostics.map((diagnostic) => diagnostic.value),
    [
      "[unsupported:object]",
      "[unsupported:object]",
      "[unsupported:bigint]",
      "[unsupported:symbol]",
      "[unsupported:function]",
      "[unsupported:non_finite_number]",
      "[unsupported:non_finite_number]",
      "[unsupported:object]",
      "[unsupported:object]",
      "[unsupported:object]",
      "[unsupported:object]",
      "[unsupported:proxy]"
    ]
  );
  assert.equal(first.diagnostics_truncation.value_projection.projected_count, 12);
  assert.equal(
    first.diagnostics_truncation.value_projection.unsupported_replaced_count,
    12
  );
  assert.equal(first.diagnostics_truncation.value_projection.proxy_replaced_count, 1);
  assert.deepEqual(first.diagnostics_truncation.truncated_fields, {
    message: 0,
    path: 0,
    value: 12
  });
});

test("very large direct strings and summaries are capped with summary counted as message truncation", () => {
  const direct = "v".repeat(2_000_000);
  const summary = "s".repeat(2_000_000);

  const compact = shapeWriteResponse({
    valid: false,
    written: false,
    diagnostics: [
      {
        code: "large_direct_strings",
        severity: "error",
        summary,
        value: direct
      }
    ]
  });

  assert.equal(compact.diagnostics[0].summary, summary.slice(0, 512));
  assert.equal(compact.diagnostics[0].value, direct.slice(0, 512));
  assert.deepEqual(compact.diagnostics_truncation.truncated_fields, {
    message: 1,
    path: 0,
    value: 1
  });
  assert.equal(compact.diagnostics_truncation.value_projection, undefined);
  assert.equal(compact.detail_available, true);
});

test("a Proxy diagnostics container is rejected before length, indices, or methods are read", () => {
  const calls = { get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0 };
  const throwingTrap = (name) => () => {
    calls[name] += 1;
    throw new Error(`${name} trap must not execute`);
  };
  const diagnostics = new Proxy([], {
    get: throwingTrap("get"),
    getOwnPropertyDescriptor: throwingTrap("getOwnPropertyDescriptor"),
    getPrototypeOf: throwingTrap("getPrototypeOf"),
    ownKeys: throwingTrap("ownKeys")
  });
  const response = { valid: false, written: false, diagnostics };

  const first = shapeWriteResponse(response);
  const second = shapeWriteResponse(response);

  assert.deepEqual(calls, { get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0 });
  assert.deepEqual(second, first);
  assert.deepEqual(first.diagnostics, ["[unsupported:diagnostics_container]"]);
  assert.deepEqual(first.diagnostics_truncation.container_projection, {
    reason: "proxy",
    sentinel: "[unsupported:diagnostics_container]"
  });
  assert.equal(first.diagnostics_truncation.total_count, null);
  assert.equal(first.diagnostics_truncation.returned_count, 1);
  assert.equal(first.diagnostics_truncation.omitted_count, null);
  assert.equal(first.diagnostics_truncation.count_known, false);
  assert.equal(first.detail_available, true);
});

test("accessor-backed length and other non-array containers use the same bounded container sentinel", () => {
  let lengthGetterCalls = 0;
  const accessorLength = {};
  Object.defineProperty(accessorLength, "length", {
    enumerable: true,
    get() {
      lengthGetterCalls += 1;
      throw new Error("diagnostics length getter must not execute");
    }
  });
  const plainArrayLike = {
    0: { code: "must_not_be_read", severity: "error", message: "unsafe" },
    length: 1
  };

  const accessorResult = shapeWriteResponse({
    valid: false,
    written: false,
    diagnostics: accessorLength
  });
  const nonArrayResult = shapeWriteResponse({
    valid: false,
    written: false,
    diagnostics: plainArrayLike
  });

  assert.equal(lengthGetterCalls, 0);
  assert.deepEqual(accessorResult.diagnostics, ["[unsupported:diagnostics_container]"]);
  assert.deepEqual(nonArrayResult.diagnostics, accessorResult.diagnostics);
  assert.equal(
    accessorResult.diagnostics_truncation.container_projection.reason,
    "accessor_length"
  );
  assert.equal(nonArrayResult.diagnostics_truncation.container_projection.reason, "non_array");
});

test("safe arrays inspect indices individually and replace holes, accessors, Proxies, and unsupported entries", () => {
  let indexGetterCalls = 0;
  let proxyTrapCalls = 0;
  const proxyEntry = new Proxy({}, {
    get() {
      proxyTrapCalls += 1;
      throw new Error("entry Proxy get trap must not execute");
    },
    getOwnPropertyDescriptor() {
      proxyTrapCalls += 1;
      throw new Error("entry Proxy descriptor trap must not execute");
    },
    ownKeys() {
      proxyTrapCalls += 1;
      throw new Error("entry Proxy ownKeys trap must not execute");
    }
  });
  const diagnostics = [
    { code: "before", severity: "error", message: "before" },
    null,
    null,
    proxyEntry,
    42,
    { code: "after", severity: "warning", message: "after" }
  ];
  Object.defineProperty(diagnostics, "1", {
    configurable: true,
    enumerable: true,
    get() {
      indexGetterCalls += 1;
      throw new Error("diagnostic index getter must not execute");
    }
  });
  delete diagnostics[2];

  const compact = shapeWriteResponse({ valid: false, written: false, diagnostics });

  assert.equal(indexGetterCalls, 0);
  assert.equal(proxyTrapCalls, 0);
  assert.deepEqual(compact.diagnostics, [
    { code: "before", severity: "error", message: "before" },
    "[unsupported:diagnostic_index_accessor]",
    "[unsupported:missing_diagnostic]",
    "[unsupported:proxy]",
    "[unsupported:diagnostic_entry]",
    { code: "after", severity: "warning", message: "after" }
  ]);
  assert.deepEqual(compact.diagnostics_truncation.unsupported_projection, {
    projected_entry_count: 4,
    entry_proxy_replaced_count: 1,
    accessor_replaced_count: 0,
    nested_proxy_replaced_count: 0,
    unsupported_value_replaced_count: 0,
    missing_entry_replaced_count: 1,
    indexed_accessor_replaced_count: 1,
    unsupported_entry_replaced_count: 1
  });
});

test("overridden array methods, iterators, and poisoned prototype toJSON callbacks never execute", () => {
  let callbackCalls = 0;
  const diagnostics = [
    {
      code: "ordinary",
      severity: "error",
      message: "ordinary",
      value: { nested: "x".repeat(1_000_000) }
    }
  ];
  for (const key of ["slice", "map"]) {
    Object.defineProperty(diagnostics, key, {
      configurable: true,
      get() {
        callbackCalls += 1;
        throw new Error(`${key} must not be read`);
      }
    });
  }
  Object.defineProperty(diagnostics, Symbol.iterator, {
    configurable: true,
    get() {
      callbackCalls += 1;
      throw new Error("diagnostic iterator must not be read");
    }
  });

  const objectToJSON = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
  const arrayToJSON = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
  Object.defineProperty(Object.prototype, "toJSON", {
    configurable: true,
    value() {
      callbackCalls += 1;
      throw new Error("Object.prototype.toJSON must not execute");
    }
  });
  Object.defineProperty(Array.prototype, "toJSON", {
    configurable: true,
    value() {
      callbackCalls += 1;
      throw new Error("Array.prototype.toJSON must not execute");
    }
  });

  let compact;
  try {
    compact = shapeWriteResponse({ valid: false, written: false, diagnostics });
  } finally {
    restoreOwnDescriptor(Array.prototype, "toJSON", arrayToJSON);
    restoreOwnDescriptor(Object.prototype, "toJSON", objectToJSON);
  }

  assert.equal(callbackCalls, 0);
  assert.equal(compact.diagnostics[0].value, "[unsupported:object]");
});

test("allowlisted diagnostic accessors become sentinels without reading unknown properties", () => {
  let getterCalls = 0;
  const diagnostic = {};
  for (const key of ["code", "severity", "message", "summary", "path", "value", "bounded_context"]) {
    Object.defineProperty(diagnostic, key, {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error(`${key} getter must not execute`);
      }
    });
  }
  Object.defineProperty(diagnostic, "unknown", {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error("unknown diagnostic fields must not be inspected");
    }
  });

  const compact = shapeWriteResponse({
    valid: false,
    written: false,
    diagnostics: [diagnostic]
  });

  assert.equal(getterCalls, 0);
  assert.deepEqual(Object.keys(compact.diagnostics[0]), [
    "code",
    "severity",
    "message",
    "summary",
    "path",
    "value",
    "bounded_context"
  ]);
  for (const key of Object.keys(compact.diagnostics[0])) {
    assert.equal(compact.diagnostics[0][key], "[unsupported:accessor]");
  }
  assert.deepEqual(compact.diagnostics_truncation.truncated_fields, {
    message: 2,
    path: 1,
    value: 1
  });
  assert.equal(
    compact.diagnostics_truncation.unsupported_projection.accessor_replaced_count,
    7
  );
});

test("ordinary null, boolean, finite number, and bounded string values remain unchanged", () => {
  const values = [null, true, false, 0, -0, 42.5, "bounded"];
  const response = {
    ok: false,
    valid: false,
    written: false,
    diagnostics: values.map((value, index) => ({
      code: `primitive_${index}`,
      severity: "error",
      message: `primitive-${index}`,
      value
    }))
  };

  const compact = shapeWriteResponse(response);

  assert.deepEqual(compact, response);
  assert.deepEqual(
    compact.diagnostics.map((diagnostic) => diagnostic.code),
    response.diagnostics.map((diagnostic) => diagnostic.code)
  );
  assert.equal(Object.hasOwn(compact, "diagnostics_truncation"), false);
  assert.equal(Object.hasOwn(compact, "detail_available"), false);
});

test("verbose:true bypasses even a hostile Proxy diagnostics container by identity", () => {
  let trapCalls = 0;
  const throwingTrap = () => {
    trapCalls += 1;
    throw new Error("verbose mode must not inspect diagnostics");
  };
  const diagnostics = new Proxy([], {
    get: throwingTrap,
    getOwnPropertyDescriptor: throwingTrap,
    getPrototypeOf: throwingTrap,
    ownKeys: throwingTrap
  });
  const response = { valid: false, written: false, diagnostics };

  const verbose = shapeWriteResponse(response, { verbose: true });

  assert.equal(trapCalls, 0);
  assert.strictEqual(verbose, response);
  assert.strictEqual(verbose.diagnostics, diagnostics);
  assert.equal(Object.hasOwn(verbose, "diagnostics_truncation"), false);
  assert.equal(Object.hasOwn(verbose, "detail_available"), false);
});
