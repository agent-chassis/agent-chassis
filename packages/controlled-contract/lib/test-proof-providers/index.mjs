

import ava from "./ava.mjs";
import cargoTest from "./cargo-test.mjs";
import deno from "./deno.mjs";
import goTest from "./go-test.mjs";
import jest from "./jest.mjs";
import lib0Testing from "./lib0-testing.mjs";
import mocha from "./mocha.mjs";
import nodeTest from "./node-test.mjs";
import pytest from "./pytest.mjs";
import stestr from "./stestr.mjs";
import vitest from "./vitest.mjs";

export const TEST_PROOF_PROVIDER_FAMILIES = Object.freeze([
  nodeTest, pytest, jest, vitest, mocha, ava, deno, lib0Testing, stestr, goTest, cargoTest
]);
