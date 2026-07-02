import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs } from "./cli.mjs";

test("parseArgs preserves content after the first equals sign", () => {
  const result = parseArgs(["--query=a=b", "positional"]);

  assert.deepEqual(result, {
    positionals: ["positional"],
    options: {
      query: "a=b"
    }
  });
});

test("parseArgs preserves dash-leading inline values", () => {
  const result = parseArgs(["--query=--blocked"]);

  assert.deepEqual(result, {
    positionals: [],
    options: {
      query: "--blocked"
    }
  });
});

test("parseArgs keeps dash-leading space-separated tokens out of values", () => {
  const result = parseArgs(["--query", "-blocked"]);

  assert.deepEqual(result, {
    positionals: ["-blocked"],
    options: {
      query: true
    }
  });
});

test("parseArgs keeps ordinary flag and value handling", () => {
  const result = parseArgs(["--profile", "standard", "--flag", "--next"]);

  assert.deepEqual(result, {
    positionals: [],
    options: {
      profile: "standard",
      flag: true,
      next: true
    }
  });
});
