------------------------ MODULE ToastRollupWatermark ------------------------
(***************************************************************************)
(* Model of the 5-minute Toast rollup skip for ONE restaurant.             *)
(*                                                                         *)
(* Source: supabase/migrations/20260815090400_toast_rollup_watermark_skip  *)
(*   The rollup reads GREATEST(max(synced_at), last_sync_time) and skips   *)
(*   when that value equals rollup_source_watermark.                       *)
(* Writers: toast-bulk-sync and toast-sync-data can run at the same time.  *)
(*   Each stamps synced_at = new Date() BEFORE its upsert commits, then    *)
(*   sets last_sync_time = new Date() when it finishes.                    *)
(*                                                                         *)
(* UseLastSync = FALSE drops last_sync_time from GREATEST. TLC then finds  *)
(* a lost row. UseLastSync = TRUE is the shipped design and passes.        *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS Syncs,        \* the edge sync runs, e.g. {"bulk", "manual"}
          UseLastSync   \* TRUE = last_sync_time is an input to GREATEST

VARIABLES clock,        \* last value that new Date() returned (no skew)
          pc,           \* pc[s] \in {"idle", "stamped", "committed", "done"}
          stamp,        \* stamp[s] = synced_at that sync s wrote on its row
          lastSync,     \* toast_connections.last_sync_time
          watermark,    \* toast_connections.rollup_source_watermark
          rolled,       \* set of syncs whose row is in unified_sales
          rpc,          \* rollup program counter: "idle" or "read"
          captured      \* v_source_max captured by the rollup before it syncs

vars == <<clock, pc, stamp, lastSync, watermark, rolled, rpc, captured>>

None == 0   \* NULL. Now starts at 1, so 0 never collides.

Max(S) == IF S = {} THEN None ELSE CHOOSE x \in S : \A y \in S : y <= x

Committed == {s \in Syncs : pc[s] \in {"committed", "done"}}

\* GREATEST(max(synced_at) over visible rows, last_sync_time)
SourceMax == Max({stamp[s] : s \in Committed}
                 \cup (IF UseLastSync /\ lastSync # None THEN {lastSync} ELSE {}))

Init == /\ clock = None
        /\ pc = [s \in Syncs |-> "idle"]
        /\ stamp = [s \in Syncs |-> None]
        /\ lastSync = None
        /\ watermark = None
        /\ rolled = {}
        /\ rpc = "idle"
        /\ captured = None

\* Each new Date() call returns a strictly later value. The first model
\* let two calls return the same value, and TLC reported a false lost row
\* for the shipped design. Microsecond timestamps make that tie unrealistic.
Now == clock + 1

\* toastOrderProcessor builds the row with synced_at = new Date().
Stamp(s) == /\ pc[s] = "idle"
            /\ pc' = [pc EXCEPT ![s] = "stamped"]
            /\ stamp' = [stamp EXCEPT ![s] = Now]
            /\ clock' = Now
            /\ UNCHANGED <<lastSync, watermark, rolled, rpc, captured>>

\* The upsert commits. The row is now visible to the rollup.
Commit(s) == /\ pc[s] = "stamped"
             /\ pc' = [pc EXCEPT ![s] = "committed"]
             /\ UNCHANGED <<clock, stamp, lastSync, watermark, rolled, rpc, captured>>

\* The edge function sets last_sync_time = new Date() at the end.
Finish(s) == /\ pc[s] = "committed"
             /\ pc' = [pc EXCEPT ![s] = "done"]
             /\ lastSync' = Now
             /\ clock' = Now
             /\ UNCHANGED <<stamp, watermark, rolled, rpc, captured>>

\* Statement 1 of the loop body: capture v_source_max, maybe CONTINUE.
RollupRead == /\ rpc = "idle"
              /\ IF SourceMax = watermark
                    THEN UNCHANGED <<rpc, captured>>            \* skip
                    ELSE /\ rpc' = "read"
                         /\ captured' = SourceMax
              /\ UNCHANGED <<clock, pc, stamp, lastSync, watermark, rolled>>

\* Statements 2-3: sync_toast_to_unified_sales sees every row committed
\* NOW (READ COMMITTED), then the watermark takes the CAPTURED value.
RollupApply == /\ rpc = "read"
               /\ rolled' = rolled \cup Committed
               /\ watermark' = captured
               /\ rpc' = "idle"
               /\ captured' = None
               /\ UNCHANGED <<clock, pc, stamp, lastSync>>

Next == \/ \E s \in Syncs : Stamp(s) \/ Commit(s) \/ Finish(s)
        \/ RollupRead \/ RollupApply

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
TypeOK == /\ clock \in Nat
          /\ pc \in [Syncs -> {"idle", "stamped", "committed", "done"}]
          /\ stamp \in [Syncs -> Nat]
          /\ lastSync \in Nat
          /\ watermark \in Nat
          /\ rolled \subseteq Syncs
          /\ rpc \in {"idle", "read"}

\* The safety property the skip must keep: when every sync is done and the
\* rollup is idle and WOULD SKIP, no committed row is missing from
\* unified_sales. A violation means the row is lost until the next sync.
NoLostRowOnSkip ==
    ( /\ \A s \in Syncs : pc[s] = "done"
      /\ rpc = "idle"
      /\ SourceMax = watermark )
    => Committed \subseteq rolled
=============================================================================
