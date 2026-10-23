import assert from "node:assert/strict";
import test from "node:test";
import { parseSidecarRuntimeConfig, sidecarBuildHeapMaximumMiB } from
  "../../packages/wiki-core/src/lib/sidecar-runtime-config.mjs";

test("WK2818 explicit behavior check", () => {
  assert.equal(sidecarBuildHeapMaximumMiB(64), 17592186044415);
  assert.equal(sidecarBuildHeapMaximumMiB(32), 4095);
  for (const value of [1, 1024, 2048, 17592186044415]) {
    assert.equal(parseSidecarRuntimeConfig(`[code_index]\nbuild_heap_mib = ${value}`,
      { nativeWordBits: 64 }).buildHeapMiB, value);
  }
  assert.equal(parseSidecarRuntimeConfig("[code_index]\nbuild_heap_mib = 4095",
    { nativeWordBits: 32 }).buildHeapMiB, 4095);
  for (const [value, code] of [["1024.0", "invalid_type"], ["1e3", "invalid_type"],
    ["1.5", "fractional"], ["0", "nonpositive"], ["-1", "nonpositive"],
    ["9007199254740992", "out_of_range"], ["17592186044416", "out_of_range"],
    ['"1024"', "invalid_type"], ["true", "invalid_type"], ["[]", "invalid_type"],
    ["{}", "invalid_type"], ["inf", "invalid_type"], ["nan", "invalid_type"]]) {
    assert.throws(() => parseSidecarRuntimeConfig(`[code_index]\nbuild_heap_mib = ${value}`),
      { code: `sidecar_config_${code}` }, value);
  }
  assert.throws(() => parseSidecarRuntimeConfig("[code_index\n"),
    { code: "sidecar_config_malformed_toml" });
  assert.throws(() => parseSidecarRuntimeConfig("code_index = 1"),
    { code: "sidecar_config_invalid_type" });
});

test("WK2818 default-representability behavior check", () => {
  for (const source of [null, "", "[roles.worker]\nmodel = 'fixture'", "[code_index]\nother = 42"]) {
    assert.equal(parseSidecarRuntimeConfig(source, { nativeWordBits: 64 }).buildHeapMiB, 8192);
    assert.throws(() => parseSidecarRuntimeConfig(source, { nativeWordBits: 32 }), error => {
      assert.equal(error.code, "sidecar_config_out_of_range");
      assert.match(error.details.correction, /1 through 4095/);
      return true;
    });
  }
});
