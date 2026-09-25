------------------------- MODULE LaborLoaderPaging -------------------------
(***************************************************************************)
(* Model of ONE loader read in the single labor engine design              *)
(* (docs/superpowers/specs/2026-09-24-single-labor-engine-design.md,       *)
(* Layer 2): the loader pages through time_punches (or tip_splits,         *)
(* bank_transactions, ...) while other users write the same table.         *)
(*                                                                         *)
(* Source: src/utils/fetchAllRows.ts:41-56. Each page is a separate        *)
(*   PostgREST request with .range(page * pageSize, ...), so each page     *)
(*   reads its own snapshot. Rows are ordered by (punch_time, id); a key   *)
(*   here stands for that pair.                                            *)
(* Writers: a manager adds or deletes a punch (Timecards, CSV import) and  *)
(*   the kiosk adds clock-ins while the loop runs.                         *)
(*                                                                         *)
(* UseKeyset = FALSE is fetchAllRows as it is now (offset paging).         *)
(* UseKeyset = TRUE reads the next page after the last key it received.    *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS Keys,        \* possible row keys, in sort order
          InitRows,    \* rows in the table when the loader starts
          PageSize,    \* rows per page (1000 in production)
          MaxWrites,   \* bound on concurrent writes during one read
          UseKeyset    \* TRUE = keyset paging, FALSE = offset paging

VARIABLES rows,        \* keys in the table now
          touched,     \* keys inserted or deleted while the loader runs
          got,         \* got[k] = times the loader received row k
          offset,      \* offset paging: the next .range() start
          lastKey,     \* keyset paging: last key received (0 = none)
          done,        \* the loader returned (a short page)
          writes       \* writes so far

vars == <<rows, touched, got, offset, lastKey, done, writes>>

Max(S) == CHOOSE x \in S : \A y \in S : y <= x

\* Position of k in the ORDER BY of the current snapshot.
Rank(k) == Cardinality({j \in rows : j < k})

\* .range(offset, offset + PageSize - 1) on the current snapshot.
OffsetPage == {k \in rows : Rank(k) >= offset /\ Rank(k) < offset + PageSize}

\* Rows after lastKey, first PageSize of them, on the current snapshot.
KeysetPage == {k \in rows : k > lastKey
                 /\ Cardinality({j \in rows : j > lastKey /\ j < k}) < PageSize}

Page == IF UseKeyset THEN KeysetPage ELSE OffsetPage

Init == /\ rows = InitRows
        /\ touched = {}
        /\ got = [k \in Keys |-> 0]
        /\ offset = 0
        /\ lastKey = 0
        /\ done = FALSE
        /\ writes = 0

\* One page request (fetchAllRows.ts:51-54). A short page ends the loop.
ReadPage == /\ ~done
            /\ got' = [k \in Keys |-> got[k] + (IF k \in Page THEN 1 ELSE 0)]
            /\ offset' = offset + PageSize
            /\ lastKey' = IF Page = {} THEN lastKey ELSE Max(Page)
            /\ done' = (Cardinality(Page) < PageSize)
            /\ UNCHANGED <<rows, touched, writes>>

\* Another user inserts a row between two page requests.
Insert(k) == /\ ~done
             /\ writes < MaxWrites
             /\ k \notin rows
             /\ rows' = rows \cup {k}
             /\ touched' = touched \cup {k}
             /\ writes' = writes + 1
             /\ UNCHANGED <<got, offset, lastKey, done>>

\* Another user deletes a row between two page requests.
Delete(k) == /\ ~done
             /\ writes < MaxWrites
             /\ k \in rows
             /\ rows' = rows \ {k}
             /\ touched' = touched \cup {k}
             /\ writes' = writes + 1
             /\ UNCHANGED <<got, offset, lastKey, done>>

Next == \/ ReadPage
        \/ \E k \in Keys : Insert(k) \/ Delete(k)
        \/ (done /\ UNCHANGED vars)

Spec == Init /\ [][Next]_vars

TypeOK == /\ rows \subseteq Keys
          /\ touched \subseteq Keys
          /\ got \in [Keys -> 0..Cardinality(Keys)]
          /\ done \in BOOLEAN

(***************************************************************************)
(* The bad outcome: the loader returns a row twice (a duplicate punch      *)
(* breaks the clock-in / clock-out pairing), or it misses a row that was   *)
(* in the table for the whole read and that nobody changed.                *)
(***************************************************************************)
NoDuplicateRow == \A k \in Keys : got[k] <= 1

NoLostStableRow == done => \A k \in InitRows \ touched : got[k] = 1
=============================================================================
