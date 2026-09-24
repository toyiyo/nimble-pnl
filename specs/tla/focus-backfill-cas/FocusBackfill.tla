---------------------------- MODULE FocusBackfill ----------------------------
(***************************************************************************)
(* Model of the focus-backfill-sync CAS on focus_connections.sync_cursor.  *)
(* Design: docs/superpowers/specs/2026-09-01-focus-backfill-cron-timeout-  *)
(*   design.md. With timeout_milliseconds := 5000, pg_net starts a second  *)
(*   worker for one tick. Both workers read the same cursor.               *)
(*                                                                         *)
(* Source:                                                                 *)
(*   supabase/functions/_shared/focusBackfillSyncHandler.ts:254 read cursor *)
(*   supabase/functions/_shared/focusBackfillSyncHandler.ts:293-299 CAS    *)
(*   supabase/functions/_shared/focusBackfillSyncHandler.ts:314-330 catch  *)
(*     path: fire-and-forget error write, CAS on the cursor it read        *)
(*   supabase/functions/_shared/focusBackfillBatch.ts:155-194 day loop:    *)
(*     'error' and 'inprogress' do not advance the cursor                  *)
(* Cursor c means days 0..c-1 are done (0 = yesterday).                    *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS Workers,     \* {"w1"} after the fix; {"w1", "w2"} with the 5 s timeout
          TargetDays,  \* days to backfill
          MaxDays,     \* MAX_DAYS_PER_CONNECTION per run
          Runs,        \* cron ticks per worker
          UseCas       \* TRUE = .eq('sync_cursor', readCursor) on the write

VARIABLES cursor,      \* focus_connections.sync_cursor
          done,        \* focus_connections.initial_sync_done
          status,      \* connection_status: "connected" or "error"
          errDay,      \* the day that last_error refers to
          errKind,     \* "conflict" = vendor 400 from a same-day fetch
          fetched,     \* days whose orders are upserted (idempotent)
          inflight,    \* days that a worker fetches now
          wpc,         \* worker program counter
          rc,          \* readCursor of each worker
          lc,          \* local cursor of each worker (batch progress)
          ndays,       \* days processed in this run
          wst,         \* local batch status: "ok" or "error"
          wkind,       \* local error kind
          runsLeft,
          beCursor     \* pending best-effort write: its CAS cursor, or None

vars == <<cursor, done, status, errDay, errKind, fetched, inflight,
          wpc, rc, lc, ndays, wst, wkind, runsLeft, beCursor>>

None == 999

Init == /\ cursor = 0 /\ done = FALSE
        /\ status = "connected" /\ errDay = None /\ errKind = "none"
        /\ fetched = {} /\ inflight = {}
        /\ wpc = [w \in Workers |-> "idle"]
        /\ rc = [w \in Workers |-> 0] /\ lc = [w \in Workers |-> 0]
        /\ ndays = [w \in Workers |-> 0]
        /\ wst = [w \in Workers |-> "ok"] /\ wkind = [w \in Workers |-> "none"]
        /\ runsLeft = [w \in Workers |-> Runs]
        /\ beCursor = [w \in Workers |-> None]

conn == <<cursor, done, status, errDay, errKind>>

\* The handler SELECTs rows WHERE initial_sync_done = false and reads the cursor.
Start(w) == /\ wpc[w] = "idle" /\ runsLeft[w] > 0 /\ ~done
            /\ wpc' = [wpc EXCEPT ![w] = "running"]
            /\ rc' = [rc EXCEPT ![w] = cursor]
            /\ lc' = [lc EXCEPT ![w] = cursor]
            /\ ndays' = [ndays EXCEPT ![w] = 0]
            /\ wst' = [wst EXCEPT ![w] = "ok"]
            /\ wkind' = [wkind EXCEPT ![w] = "none"]
            /\ runsLeft' = [runsLeft EXCEPT ![w] = @ - 1]
            /\ UNCHANGED <<conn, fetched, inflight, beCursor>>

\* Request the datafeed for day lc[w]. A concurrent request for the same day
\* gets HTTP 400 from the vendor (the production symptom).
FetchBegin(w) ==
    /\ wpc[w] = "running" /\ lc[w] < TargetDays /\ ndays[w] < MaxDays
    /\ IF lc[w] \in inflight
          THEN /\ wpc' = [wpc EXCEPT ![w] = "writing"]
               /\ wst' = [wst EXCEPT ![w] = "error"]
               /\ wkind' = [wkind EXCEPT ![w] = "conflict"]
               /\ UNCHANGED inflight
          ELSE /\ wpc' = [wpc EXCEPT ![w] = "fetching"]
               /\ inflight' = inflight \cup {lc[w]}
               /\ UNCHANGED <<wst, wkind>>
    /\ UNCHANGED <<conn, fetched, rc, lc, ndays, runsLeft, beCursor>>

\* Day upserted: ok or empty advances the local cursor.
FetchOk(w) == /\ wpc[w] = "fetching"
              /\ inflight' = inflight \ {lc[w]}
              /\ fetched' = fetched \cup {lc[w]}
              /\ lc' = [lc EXCEPT ![w] = @ + 1]
              /\ ndays' = [ndays EXCEPT ![w] = @ + 1]
              /\ wpc' = [wpc EXCEPT ![w] = "running"]
              /\ UNCHANGED <<conn, rc, wst, wkind, runsLeft, beCursor>>

\* Any other vendor error, or 'inprogress': the cursor does not advance.
FetchFail(w) == /\ wpc[w] = "fetching"
                /\ inflight' = inflight \ {lc[w]}
                /\ wpc' = [wpc EXCEPT ![w] = "writing"]
                /\ wst' = [wst EXCEPT ![w] = "error"]
                /\ wkind' = [wkind EXCEPT ![w] = "vendor"]
                /\ UNCHANGED <<conn, fetched, rc, lc, ndays, runsLeft, beCursor>>

\* The loop ends: budget, maxDays, or all days done.
Stop(w) == /\ wpc[w] = "running"
           /\ wpc' = [wpc EXCEPT ![w] = "writing"]
           /\ UNCHANGED <<conn, fetched, inflight, rc, lc, ndays, wst, wkind, runsLeft, beCursor>>

\* An exception before or at the write (decrypt, CAS error). The catch path
\* starts a fire-and-forget write and the loop continues.
Throw(w) == /\ wpc[w] \in {"running", "writing"}
            /\ beCursor[w] = None
            /\ beCursor' = [beCursor EXCEPT ![w] = rc[w]]
            /\ wpc' = [wpc EXCEPT ![w] = "idle"]
            /\ UNCHANGED <<conn, fetched, inflight, rc, lc, ndays, wst, wkind, runsLeft>>

\* The main write. With UseCas it filters .eq('sync_cursor', readCursor).
Write(w) == /\ wpc[w] = "writing"
            /\ wpc' = [wpc EXCEPT ![w] = "idle"]
            /\ IF ~UseCas \/ cursor = rc[w]
                  THEN /\ cursor' = lc[w]
                       /\ done' = (lc[w] >= TargetDays)
                       /\ status' = IF wst[w] = "error" THEN "error" ELSE "connected"
                       /\ errDay' = IF wst[w] = "error" THEN lc[w] ELSE None
                       /\ errKind' = IF wst[w] = "error" THEN wkind[w] ELSE "none"
                  ELSE UNCHANGED conn    \* CAS miss: skip silently
            /\ UNCHANGED <<fetched, inflight, rc, lc, ndays, wst, wkind, runsLeft, beCursor>>

\* The fire-and-forget error write lands, maybe much later.
LandBestEffort(w) ==
    /\ beCursor[w] # None
    /\ beCursor' = [beCursor EXCEPT ![w] = None]
    /\ IF ~UseCas \/ cursor = beCursor[w]
          THEN /\ status' = "error" /\ errDay' = cursor /\ errKind' = "thrown"
          ELSE UNCHANGED <<status, errDay, errKind>>
    /\ UNCHANGED <<cursor, done, fetched, inflight, wpc, rc, lc, ndays, wst, wkind, runsLeft>>

Next == \E w \in Workers :
          \/ Start(w) \/ FetchBegin(w) \/ FetchOk(w) \/ FetchFail(w)
          \/ Stop(w) \/ Throw(w) \/ Write(w) \/ LandBestEffort(w)

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
\* Data safety. These must hold with the CAS, for any number of workers.

\* Every day before the cursor has its orders upserted.
NoGap == \A d \in 0..(cursor - 1) : d \in fetched

\* initial_sync_done only after every day.
DoneMeansAllDays == done => (0..(TargetDays - 1)) \subseteq fetched

\* An error banner points at the day that the next run retries.
ErrorPointsAtCursor == status = "error" => errDay = cursor

\* The cursor never moves back (no lost progress, no re-entry after done).
CursorMonotonic == [][cursor' >= cursor /\ (done => done')]_<<cursor, done>>

\* Symptom. The user sees the vendor 400 that only a duplicate worker causes.
NoConflictBanner == ~(status = "error" /\ errKind = "conflict")
=============================================================================
