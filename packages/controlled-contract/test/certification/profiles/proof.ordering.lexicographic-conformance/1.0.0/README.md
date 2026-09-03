# Lexicographic conformance certification

This directory is the development certification source for
`proof.ordering.lexicographic-conformance@1.0.0`. The fixed negative fixtures and
weakening witnesses cover every guarantee-critical profile surface. The
independent fixture oracle calculates expected orders without importing the
package comparator, while the implementation harness exercises the package-owned
transformer against semantic mutants.

`exact-binding.json` binds four exact captured sources to the derived conformance
report and projects all three exact populations from that report. The package
admission build verifies both the profile census and the exact-binding
certification corpus before publishing the compact pack.
