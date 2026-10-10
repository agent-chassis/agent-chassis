# Read Selection Policy

This page describes the semantic read-selection grants of the central
role-to-tool access policy. It is an internal contract of
`packages/wiki-core/src/lib/tool-discovery/gating.mjs`, the owner of that
policy's validation and resolution. No registered tool uses these grants, and
the checked-in policy declares none.

## The `read_selections` section

A policy may contain one optional section:

```json
"read_selections": [
  { "source_kind": "record", "selection": "integrity", "roles": ["reviewer"] }
]
```

Each row grants one exact semantic read selection to the listed roles. A row is
strict:

- Its keys are exactly `source_kind`, `selection` and `roles`.
- `source_kind` and `selection` are non-empty exact strings. A value with
  surrounding whitespace, or containing `*` or `?`, is refused; nothing is a
  pattern.
- `roles` is a non-empty list of distinct roles, each declared in the policy's
  `roles`.
- No two rows share the same `source_kind` and `selection`.

When the section is present it must hold at least one row.

## Optional for ordinary use, required for resolution

`validateSessionRoleToolAccessPolicy` validates the section only when it is
present. A policy without it is valid, and the ordinary resolvers
(`resolveRoleToolGrantsFromPolicy`, `resolveToolDispositionsFromPolicy`) return
exactly what they return for the same policy with a valid section.

A malformed section makes the whole policy invalid: every resolver throws,
including the ordinary ones.

Semantic resolution needs the section. Resolving against a policy that omits it
throws `session_role_policy_missing_read_selections`; an absent section is never
read as "no grants".

## Resolution

```js
resolveReadWikiSelectionGrantsFromPolicy(policy, { source_kind, selection })
```

The function validates the policy and the tuple, then returns a new `Set` of
role names:

- A tuple that matches a row returns exactly that row's roles.
- A valid tuple that matches no row returns an empty `Set`.

Matching is equality on both strings. There is no prefix or wildcard matching,
no case folding, no union across rows, no fallback to the `access` tool grants,
and no default role for an unknown tuple or role.

The tuple has exactly the keys `source_kind` and `selection`. Any other key,
such as `role`, `repository` or `reference`, is refused, as is a missing key or
a value that would be refused in a row.

The policy and the tuple are never mutated. Each call returns its own `Set`;
changing one does not affect the policy or a later resolution.

The function authenticates nothing. It answers which roles a tuple grants; the
source owner that calls it supplies a tuple it has already authenticated and
compares the result with the session's role.

## Failures

Every failure is a `SessionRoleToolAccessPolicyError`. Its `diagnostics` list
holds one entry per problem, each with a `code` and a `message`, and its `code`
is the first diagnostic's.

| Code | Cause |
| --- | --- |
| `session_role_policy_invalid_read_selections` | The section is not an array. |
| `session_role_policy_empty_read_selections` | The section is an empty array. |
| `session_role_policy_invalid_read_selection_row` | A row is not an object. |
| `session_role_policy_invalid_read_selection_keys` | A row has a missing or extra key. |
| `session_role_policy_invalid_read_selection_identity` | `source_kind` or `selection` is not a non-empty exact string. |
| `session_role_policy_read_selection_wildcard` | `source_kind` or `selection` contains `*` or `?`. |
| `session_role_policy_duplicate_read_selection` | Two rows name the same tuple. |
| `session_role_policy_invalid_read_selection_roles` | `roles` is not an array. |
| `session_role_policy_empty_read_selection_roles` | `roles` is empty. |
| `session_role_policy_invalid_read_selection_role_entry` | A role is not a non-empty string. |
| `session_role_policy_duplicate_read_selection_role` | A role is listed twice in one row. |
| `session_role_policy_undeclared_read_selection_role` | A role is not declared in the policy's `roles`. |
| `session_role_policy_missing_read_selections` | Semantic resolution against a policy without the section. |
| `session_role_policy_invalid_read_selection_tuple` | The resolved tuple is malformed or carries an extra key. |

The existing policy diagnostics, schema version, file path and loading failures
are unchanged.
