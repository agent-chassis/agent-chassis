import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import schema, { composeStableContractSchemaV1, loadStableContractSchemaV1 } from
  "../../packages/controlled-contract/lib/stable-contract-schema-v1.mjs";
import { deriveControlledContractAuthoringVocabulary } from
  "../../packages/wiki-core/src/operations/controlled-contract/contract-requirement-vocabulary.mjs";

const memberNames = [
  "controlled-acceptance-contract.v1.schema.json",
  "controlled-acceptance-test-proof-definitions.v1.schema.json",
  "controlled-acceptance-requirement-definitions.v1.schema.json",
  "controlled-acceptance-proposition-definitions.v1.schema.json",
  "controlled-acceptance-value-definitions.v1.schema.json"
];
const memberUrl = name => new URL(`../../packages/controlled-contract/schema/${name}`, import.meta.url);
const members = () => memberNames.map(name => JSON.parse(readFileSync(memberUrl(name), "utf8")));

test("one effective schema preserves every member's content and supplies authoring vocabulary", () => {
  const [root, proofs, requirements, propositions, values] = members();
  const before = structuredClone([root, proofs, requirements, propositions, values]);
  assert.deepEqual(Object.keys(propositions), ["$defs"]);
  assert.deepEqual(Object.keys(propositions.$defs), ["proposition"]);
  assert.equal(Object.hasOwn(root.$defs, "proposition"), false);
  const composed = composeStableContractSchemaV1(root, proofs, requirements, propositions, values);
  const { $defs, ...metadata } = composed;
  const { $defs: rootDefinitions, ...rootMetadata } = root;
  assert.deepEqual(metadata, rootMetadata);
  assert.deepEqual(Object.keys($defs).sort(), [...before.flatMap(member => Object.keys(member.$defs)), ...Object.keys(values.$defs).map(name => `authored_${name}`)].sort());
  for (const member of before) {
    for (const [name, definition] of Object.entries(member.$defs)) assert.deepEqual($defs[name], definition);
  }
  assert.deepEqual(composed, schema);
  assert.deepEqual(loadStableContractSchemaV1(), schema);
  assert.deepEqual(composeStableContractSchemaV1(root, proofs), schema);
  assert.deepEqual([root, proofs, requirements, propositions, values], before);
  const vocabulary = deriveControlledContractAuthoringVocabulary(composed);
  assert.ok(vocabulary.operator_signatures.size > 0);
  assert.deepEqual(vocabulary, deriveControlledContractAuthoringVocabulary(schema));
  composed.$defs.proposition.required.push("test-only");
  assert.deepEqual([root, proofs, requirements, propositions, values], before, "composition owns its clone");
  assert.deepEqual(loadStableContractSchemaV1(), schema, "mutations cannot alter the package schema");
});

test("the fixed-path loader names every read or parse failure and preserves its cause", () => {
  const reads = [];
  assert.deepEqual(loadStableContractSchemaV1((url, encoding) => {
    reads.push(url.href);
    assert.equal(encoding, "utf8");
    return readFileSync(url, encoding);
  }), schema);
  assert.deepEqual(reads, memberNames.map(name => memberUrl(name).href));
  for (const name of memberNames) {
    const absent = Object.assign(new Error(`ENOENT: missing ${memberUrl(name).pathname}`), { code: "ENOENT" });
    assert.throws(() => loadStableContractSchemaV1((url, encoding) => {
      if (url.href === memberUrl(name).href) throw absent;
      return readFileSync(url, encoding);
    }), error => {
      assert.equal(error.message, `cannot read stable-v1 schema member ${memberUrl(name).pathname}`);
      assert.equal(error.cause, absent);
      return true;
    });
    assert.throws(() => loadStableContractSchemaV1((url, encoding) =>
      url.href === memberUrl(name).href ? "{" : readFileSync(url, encoding)), error => {
      assert.equal(error.message, `cannot read stable-v1 schema member ${memberUrl(name).pathname}`);
      assert.ok(error.cause instanceof SyntaxError);
      return true;
    });
  }
});

test("proposition fragments refuse missing, extra and malformed definitions without a root alternative", () => {
  const [root, proofs, requirements, propositions] = members();
  for (const fragment of [null, [], {}, { $defs: null }, { $defs: [] }, { $defs: {}, title: "extra" }]) {
    assert.throws(() => composeStableContractSchemaV1(root, proofs, requirements, fragment),
      /malformed proposition fragment/u);
  }
  for (const [fragment, cause] of [
    [{ $defs: {} }, /missing \[proposition\]/u],
    [{ $defs: { ...propositions.$defs, extra: {} } }, /extra \[extra\]/u],
    ...[null, [], "wrong"].map(proposition => [{ $defs: { proposition } }, /malformed \[proposition\]/u])
  ]) {
    assert.throws(() => composeStableContractSchemaV1(root, proofs, requirements, fragment), cause);
    assert.throws(() => loadStableContractSchemaV1((url, encoding) =>
      url.href === memberUrl(memberNames[3]).href ? JSON.stringify(fragment) : readFileSync(url, encoding)), cause);
  }
  const rootWithProposition = structuredClone(root);
  rootWithProposition.$defs.proposition = propositions.$defs.proposition;
  assert.throws(() => composeStableContractSchemaV1(rootWithProposition, proofs, requirements, { $defs: {} }),
    /missing \[proposition\]/u);
});

test("every contributing fragment refuses incomplete definitions and collisions", () => {
  for (let index = 1; index < memberNames.length; index += 1) {
    const inputs = members();
    const name = Object.keys(inputs[index].$defs)[0];
    inputs[0].$defs[name] = structuredClone(inputs[index].$defs[name]);
    assert.throws(() => composeStableContractSchemaV1(...inputs),
      error => error.message === `stable-v1 schema composition has a conflicting definition: ${name}`);
    delete inputs[0].$defs[name];
    delete inputs[index].$defs[name];
    assert.throws(() => composeStableContractSchemaV1(...inputs), /missing \[/u);
    inputs[index].$defs.extra = {};
    assert.throws(() => composeStableContractSchemaV1(...inputs), /extra \[extra\]/u);
  }
  for (const root of [null, [], {}, { $defs: [] }]) {
    const inputs = members();
    assert.throws(() => composeStableContractSchemaV1(root, ...inputs.slice(1)), /malformed root/u);
  }
});

test("publication includes the proposition fragment through the existing schema export", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../packages/controlled-contract/package.json", import.meta.url), "utf8"));
  assert.ok(manifest.files.includes(`schema/${memberNames[3]}`));
  assert.equal(manifest.exports["./schema/*"], "./schema/*");
});
