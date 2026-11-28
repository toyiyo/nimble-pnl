---- MODULE CiCanary ----
\* TEST ONLY. This spec proves that the CI job fails on a broken invariant.
\* A revert commit deletes it.
EXTENDS Naturals
VARIABLE x
Init == x = 0
Next == x < 3 /\ x' = x + 1
\* Broken on purpose: x reaches 2.
Inv == x < 2
====
