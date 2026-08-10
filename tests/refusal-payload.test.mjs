import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRefusal,
  defineRefusalCode,
  forwardRefusal
} from "../packages/wiki-core/src/lib/refusal-payload.mjs";
import {
  WorktreeReaperError
} from "../packages/agent-launch-cli/src/lib/worktree-reaper-diagnostics.mjs";

test("defineRefusalCode returns a frozen extensible definition", () => {
  const definition = defineRefusalCode({
    code: "test.refusal.definition.v1",
    namespace: "test.refusal",
    responsible_actor: "operator",
    next_action: { kind: "retry" },
    remediation: ["repair_configuration"]
  });

  assert.equal(definition.code, "test.refusal.definition.v1");
  assert.equal(typeof definition.code, "string");
  assert.equal(definition.namespace, "test.refusal");
  assert.ok(Object.isFrozen(definition));
  assert.ok(Object.isFrozen(definition.next_action));
  assert.ok(Object.isFrozen(definition.remediation));
});

test("definition normalization still rejects cycles", () => {
  const definition = {
    code: "test.refusal.cyclic-definition.v1",
    namespace: "test.refusal"
  };
  definition.remediation = definition;

  assert.throws(() => defineRefusalCode(definition), /must not contain cycles/);
});

test("structurally identical registration returns the first definition unchanged", () => {
  const first = defineRefusalCode({
    code: "test.refusal.duplicate.v1",
    namespace: "test.refusal",
    responsible_actor: "operator",
    remediation: { steps: ["repair_configuration"] }
  });
  const duplicate = defineRefusalCode({
    remediation: { steps: ["repair_configuration"] },
    responsible_actor: "operator",
    namespace: "test.refusal",
    code: "test.refusal.duplicate.v1"
  });

  assert.strictEqual(duplicate, first);
});

test("divergence in nested definition metadata is refused without echoing its content", () => {
  const code = "test.refusal.divergent-remediation.v1";
  defineRefusalCode({
    code,
    namespace: "test.refusal",
    remediation: { steps: ["registered_private_remediation"] }
  });

  assert.throws(
    () => defineRefusalCode({
      code,
      namespace: "test.refusal",
      remediation: { steps: ["incoming_private_remediation"] }
    }),
    (error) => {
      assert.match(error.message, /divergent refusal definition/);
      assert.match(error.message, new RegExp(code.replaceAll(".", "\\.")));
      assert.doesNotMatch(error.message, /registered_private_remediation/);
      assert.doesNotMatch(error.message, /incoming_private_remediation/);
      return true;
    }
  );
});

test("whole-definition equality includes future enumerable metadata", () => {
  const code = "test.refusal.divergent-future-field.v1";
  defineRefusalCode({
    code,
    namespace: "test.refusal",
    future_metadata: { state: "registered_private_value" }
  });

  assert.throws(
    () => defineRefusalCode({
      code,
      namespace: "test.refusal",
      future_metadata: { state: "incoming_private_value" }
    }),
    (error) => {
      assert.match(error.message, /divergent refusal definition/);
      assert.doesNotMatch(error.message, /registered_private_value/);
      assert.doesNotMatch(error.message, /incoming_private_value/);
      return true;
    }
  );
});

test("non-enumerable fields are outside normalized-definition equality", () => {
  const code = "test.refusal.non-enumerable-metadata.v1";
  const first = defineRefusalCode({ code, namespace: "test.refusal" });
  const duplicate = { code, namespace: "test.refusal" };
  Object.defineProperty(duplicate, "non_enumerable_metadata", {
    value: "not_part_of_the_registered_definition"
  });

  assert.strictEqual(defineRefusalCode(duplicate), first);
});

test("buildRefusal accepts only the registered definition object", () => {
  const definition = defineRefusalCode({
    code: "test.refusal.registered-definition.v1",
    namespace: "test.refusal"
  });

  assert.deepEqual(buildRefusal(definition, { severity: "error" }), {
    code: definition.code,
    severity: "error"
  });
  assert.throws(
    () => buildRefusal({ code: definition.code, namespace: definition.namespace }),
    /registered refusal definition/
  );
  assert.throws(
    () => buildRefusal({ code: "test.refusal.unregistered.v1", namespace: "test.refusal" }),
    /registered refusal definition/
  );
  assert.throws(
    () => buildRefusal("test.refusal.unregistered.v1"),
    /registered refusal definition/
  );
});

test("forwardRefusal validates a code received at runtime", () => {
  const definition = defineRefusalCode({
    code: "test.refusal.forwarded.v1",
    namespace: "test.refusal"
  });
  const incomingCode = String(definition.code);

  assert.deepEqual(forwardRefusal(incomingCode, { level: "blocking" }), {
    code: definition.code,
    level: "blocking"
  });
  assert.throws(
    () => forwardRefusal("test.refusal.forwarded-unregistered.v1"),
    /registered refusal code/
  );
});

test("buildRefusal preserves extensible payload fields and excludes next_action", () => {
  const definition = defineRefusalCode({
    code: "test.refusal.extensible.v1",
    namespace: "test.refusal"
  });
  const payload = buildRefusal(definition, {
    severity: "warning",
    audience: "operator",
    future_controlled_field: { value: "stable_value" }
  });

  assert.deepEqual(payload.future_controlled_field, { value: "stable_value" });
  assert.throws(
    () => buildRefusal(definition, { next_action: "retry" }),
    /belongs beside the refusal payload/
  );
});

test("payload wraps a real WorktreeReaperError without changing its identity or code", () => {
  const definition = defineRefusalCode({
    code: "test.refusal.worktree-reaper.v1",
    namespace: "test.refusal"
  });
  const message = "worktree cleanup refused";
  const error = new WorktreeReaperError(message, {
    code: definition.code,
    detail: buildRefusal(definition, { severity: "error" })
  });

  assert.ok(error instanceof WorktreeReaperError);
  assert.equal(error.message, message);
  assert.equal(error.code, definition.code);
  assert.deepEqual(error.detail, {
    code: definition.code,
    severity: "error"
  });
});
