------------------------- MODULE LaborLoaderPaging -------------------------
(***************************************************************************)
(* Model of ONE loader read in the single labor engine design              *)
(* (docs/superpowers/specs/2026-09-24-single-labor-engine-design.md,       *)
(* Layer 2): the loader pages through time_punches (or tip_splits,         *)
(* bank_transactions, ...) while other users write the same table.         *)
(*                                                                         *)
(* Source: supabase/functions/_shared/labor/fetchAllRows.ts. Each page is  *)
(*   a separate PostgREST request, so each page reads its own snapshot.    *)
(* A row is an id with an order key (key[i], for example punch_time). The  *)
(*   ORDER BY is (key, id). A new row i starts with key i.                 *)
(* Writers: a manager adds, deletes or edits a punch (Timecards, CSV       *)
(*   import) and the kiosk adds clock-ins while the loop runs. An edit can *)
(*   change the order key of a row (Update).                               *)
(*                                                                         *)
(* UseKeyset = FALSE is fetchAllRows (offset paging).                      *)
(* UseKeyset = TRUE is fetchAllRowsKeyset: the next page starts after the  *)
(*   last (key, id) that the loader received.                              *)
(* Dedupe = TRUE: the loader keeps one copy of each id (the last one).     *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS Keys,        \* possible row ids, and possible order keys
          InitRows,    \* ids in the table when the loader starts
          PageSize,    \* rows per page (1000 in production)
          MaxWrites,   \* bound on concurrent writes during one read
          UseKeyset,   \* TRUE = keyset paging, FALSE = offset paging
          Dedupe       \* TRUE = keep one copy of each id in the result

VARIABLES rows,        \* ids in the table now
          key,         \* key[i] = order key of row i now
          touched,     \* ids inserted, deleted or updated while the loader runs
          got,         \* got[i] = copies of row i in the loader result
          offset,      \* offset paging: the next .range() start
          curKey,      \* keyset paging: key of the last row received
          curId,       \* keyset paging: id of the last row received (0 = none)
          done,        \* the loader returned (a short page)
          writes       \* writes so far

vars == <<rows, key, touched, got, offset, curKey, curId, done, writes>>

\* The ORDER BY (key, id) on the current snapshot.
Before(a, b) == key[a] < key[b] \/ (key[a] = key[b] /\ a < b)

\* Position of i in the ORDER BY of the current snapshot.
Rank(i) == Cardinality({j \in rows : Before(j, i)})

\* .range(offset, offset + PageSize - 1) on the current snapshot.
OffsetPage == {i \in rows : Rank(i) >= offset /\ Rank(i) < offset + PageSize}

\* The rows after the cursor (key > curKey, or key = curKey and id > curId).
AfterCursor(i) == curId = 0 \/ key[i] > curKey \/ (key[i] = curKey /\ i > curId)

\* The first PageSize rows after the cursor, on the current snapshot.
KeysetPage == {i \in rows : AfterCursor(i)
                 /\ Cardinality({j \in rows : AfterCursor(j) /\ Before(j, i)}) < PageSize}

Page == IF UseKeyset THEN KeysetPage ELSE OffsetPage

\* The last row of a non-empty page in the ORDER BY.
LastOf(P) == CHOOSE i \in P : \A j \in P : j = i \/ Before(j, i)

Init == /\ rows = InitRows
        /\ key = [i \in Keys |-> i]
        /\ touched = {}
        /\ got = [i \in Keys |-> 0]
        /\ offset = 0
        /\ curKey = 0
        /\ curId = 0
        /\ done = FALSE
        /\ writes = 0

\* One page request. A short page ends the loop.
ReadPage == /\ ~done
            /\ got' = [i \in Keys |->
                         IF i \in Page
                         THEN (IF Dedupe THEN 1 ELSE got[i] + 1)
                         ELSE got[i]]
            /\ offset' = offset + PageSize
            /\ curKey' = IF Page = {} THEN curKey ELSE key[LastOf(Page)]
            /\ curId' = IF Page = {} THEN curId ELSE LastOf(Page)
            /\ done' = (Cardinality(Page) < PageSize)
            /\ UNCHANGED <<rows, key, touched, writes>>

\* Another user inserts row i (with key i) between two page requests.
Insert(i) == /\ ~done
             /\ writes < MaxWrites
             /\ i \notin rows
             /\ rows' = rows \cup {i}
             /\ key' = [key EXCEPT ![i] = i]
             /\ touched' = touched \cup {i}
             /\ writes' = writes + 1
             /\ UNCHANGED <<got, offset, curKey, curId, done>>

\* Another user deletes row i between two page requests.
Delete(i) == /\ ~done
             /\ writes < MaxWrites
             /\ i \in rows
             /\ rows' = rows \ {i}
             /\ touched' = touched \cup {i}
             /\ writes' = writes + 1
             /\ UNCHANGED <<key, got, offset, curKey, curId, done>>

\* Another user changes the order key of row i (k -> k') between two page
\* requests, for example a punch_time edit on the Timecards page.
Update(i, k) == /\ ~done
                /\ writes < MaxWrites
                /\ i \in rows
                /\ k # key[i]
                /\ key' = [key EXCEPT ![i] = k]
                /\ touched' = touched \cup {i}
                /\ writes' = writes + 1
                /\ UNCHANGED <<rows, got, offset, curKey, curId, done>>

Next == \/ ReadPage
        \/ \E i \in Keys : Insert(i) \/ Delete(i)
        \/ \E i, k \in Keys : Update(i, k)
        \/ (done /\ UNCHANGED vars)

Spec == Init /\ [][Next]_vars

TypeOK == /\ rows \subseteq Keys
          /\ key \in [Keys -> Keys]
          /\ touched \subseteq Keys
          /\ got \in [Keys -> Nat]
          /\ curId \in Keys \cup {0}
          /\ done \in BOOLEAN

(***************************************************************************)
(* The bad outcome: the loader returns a row twice (a duplicate punch      *)
(* breaks the clock-in / clock-out pairing), or it misses a row that was   *)
(* in the table for the whole read and that nobody changed.                *)
(***************************************************************************)
NoDuplicateRow == \A i \in Keys : got[i] <= 1

NoLostStableRow == done => \A i \in InitRows \ touched : got[i] = 1
=============================================================================
