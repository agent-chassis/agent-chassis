# Complete pagination traversal proof pack

`proof.pagination.complete-traversal@1.0.0` proves one finite, exact, package-authenticated traversal. The `mutation-pagination-trace.v1` projection consumes the mechanically complete authoritative ordered-occurrence population, the exact page/transition trace, the authenticated source-of-record occurrence capture, the equality policy, and the resource policy. It accepts only one canonical initial state, one linear opaque cursor chain, one snapshot/version identity, one terminal page, and exact concatenated occurrence equality.

Occurrence identity is derived from authenticated source identity plus stable source occurrence identity, never caller reference IDs. The pack rejects population omission or substitution, duplicate or ambiguous equality identities, missing/extra/duplicate/reordered returns, every cursor-chain fault, snapshot/version drift, incomplete capture, and each declared resource limit plus one.

The guarantee excludes service liveness, snapshot-acquisition atomicity, CAS linearizability, unrepresented concurrency, cross-pack or cross-contract result joins, runtime truth outside captured bytes, and completeness asserted only by a caller or unauthenticated capture.
