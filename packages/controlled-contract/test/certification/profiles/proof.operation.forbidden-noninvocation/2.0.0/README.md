# Forbidden-operation noninvocation 1.0.0

This certification source admits `proof.operation.forbidden-noninvocation@1.0.0`.

The pack proves only the caller-authored planning graph: one subject operation does
not use any member of one complete exact nonempty forbidden-operation population in
one declared context, and the selected verification reads the exact proof subjects
and carries same-subject, same-context positive use as its falsifier.

The pack does not execute a mutation test, discover production call paths, establish
the truth or completeness of caller grounding, or cover invocations outside the
declared context. Restoring a forbidden call is an executable certification mutant
for this profile and may be delivery evidence for a consuming implementation, but it
is not itself the controlled proof intent.

Release certification includes twelve positive controls spanning three unrelated
domains, role/type breadth, population sizes, verification methods, and legitimate
scope isolation; four executed forbidden-call mutants; thirteen independently
authored plan rejections; six explicit boundary demonstrations; and a fixed surface
corpus covering every mechanically open profile weakening.
