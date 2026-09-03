import assert from "node:assert/strict";
import { test } from "node:test";

test("the intentionally absent public module cannot be imported", async () => {
  await assert.rejects(
    import("./agent-chassis-snapshot-intentionally-absent.mjs"),
    (error) => error?.code === "ERR_MODULE_NOT_FOUND",
  );
});
