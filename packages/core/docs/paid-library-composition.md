# Paid capability availability and recovery

`@agent-chassis/cce` supplies paid code queries and controlled requirement
editing. Install a compatible package explicitly alongside the public serving
packages in the same installation; public dependencies do not fetch it.
Standard hoisted and nested installations are supported. Installing a provider
in another working directory does not repair the serving installation. Detailed
implementation documentation accompanies the private package.

Provider installation grants no entitlement. The serving session's existing
role, tier and CCE authority determine access. Free sessions need neither the private provider nor its runtime SDK. The SDK-backed
policy wire and canonical-record projection owners ship only in the private package. Shared canonical compilation, normalization, stored reads, assessment,
proof execution, indexing, persistence and transactions remain public. Operator
index build/status/rebuild and help remain available without the provider.

Paid startup refuses before readiness when its installation is unusable:

| Code | Required correction |
| --- | --- |
| `paid_provider_missing` | Install the compatible private package in the named serving installation. |
| `paid_provider_load_failed` | Correct the reported load or dependency failure in that installation. |
| `paid_provider_identity_invalid` | Correct the named package identity or version. |
| `paid_provider_contract_unsupported` | Install a package supporting the interface named by the diagnostic. |
| `paid_provider_contract_invalid` | Replace the package with a complete compatible implementation, correcting the reported member or vocabulary defect. |

After correcting the installation, restart the serving process. There is no
automatic downgrade. `paid_provider_operation_failed` reports an unexpected
invoked-operation failure with the installed version, affected member, cause
and observed effects. The package maintainer must diagnose that cause; install
a corrected compatible package and restart. Declared domain errors retain their
specific recovery. Authoring preparation publishes nothing; queries may have
requested refresh, so unknown effects remain unknown.

See [package installation](package-install.md) and
[tool availability](tool-discovery-tiers.md) for the supported user routes.
Private package registry provisioning is not supplied here. This capability
boundary does not certify source artifact confidentiality or release exclusion.
