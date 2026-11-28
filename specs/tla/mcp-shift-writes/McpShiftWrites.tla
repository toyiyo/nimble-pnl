--------------------------- MODULE McpShiftWrites ---------------------------
(***************************************************************************)
(* Model of the MCP shift write tools (update_shift, delete_shift) on ONE  *)
(* shift, with concurrent UI edits and publish/unpublish.                  *)
(*                                                                         *)
(* Design: docs/superpowers/specs/2026-11-28-mcp-shift-writes-design.md    *)
(*                                                                         *)
(* Actors:                                                                 *)
(*   - Calls: MCP tool calls. Each call runs Preview, then Confirm         *)
(*     (the CAS write), then Notify. The client can retry a Confirm after  *)
(*     a timeout (mcpHandler.ts:345-352 says a write can be saved).        *)
(*   - The Scheduling UI: one manager edits or deletes the shift and       *)
(*     notifies its own change log row (usePublishedShiftGuard.tsx:173).   *)
(*   - publish_schedule / unpublish_schedule flip is_published and touch   *)
(*     the row, so the BEFORE UPDATE trigger bumps updated_at              *)
(*     (20251114100000_create_scheduling_tables.sql:276).                  *)
(*                                                                         *)
(* `ver` stands for shifts.updated_at. Every committed UPDATE gets a new   *)
(* value, so the model uses a counter.                                     *)
(*                                                                         *)
(* The log_shift_change trigger (20251123000000_schedule_publishing.sql:96)*)
(* writes a schedule_change_logs row in the same transaction as an UPDATE  *)
(* or DELETE of a published shift. notify-shift-changed reads that row,    *)
(* claims notified_at, and derives the recipients from before/after        *)
(* (shiftChangedNotification.ts deriveShiftChangeRecipients).              *)
(*                                                                         *)
(* Guards of the planned design (each one has a counterfactual .cfg):      *)
(*   UseCas      - the confirm UPDATE/DELETE has .eq('updated_at', token). *)
(*   ArgsBound   - the confirm args must hash to the preview token.        *)
(*   ExactLookup - the notify step finds the change log row by the new     *)
(*                 updated_at of its own write, not "latest row".          *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Calls,        \* MCP tool calls, e.g. {"c1", "c2"}
          Emp,          \* employees, e.g. {"e1", "e2", "e3"}
          UIMax,        \* max UI writes (edit or delete)
          ToggleMax,    \* max publish/unpublish steps
          UseCas,
          ArgsBound,
          ExactLookup

None == "none"

\* Upper bound on change log rows: two writes per call (a retry), UI, toggles.
MaxLogs == 2 * Cardinality(Calls) + UIMax + ToggleMax

Changes == {[op |-> "reassign", to |-> e] : e \in Emp}
           \cup {[op |-> "retime", to |-> None], [op |-> "delete", to |-> None]}

AfterEmp(b, ch) == IF ch.op = "reassign" THEN ch.to ELSE b

\* deriveShiftChangeRecipients (shiftChangedNotification.ts:72-90).
LogRecipients(row) ==
    IF row.kind = "deleted" THEN {row.before}
    ELSE IF row.kind = "updated" THEN {row.before, row.after}
    ELSE {}

\* What the preview shows in notifications.will_notify.
Shown(p) ==
    IF p.pub /\ p.notify
    THEN IF p.change.op = "delete" THEN {p.before}
         ELSE {p.before, AfterEmp(p.before, p.change)}
    ELSE {}

NoPreview == [ver |-> 0, before |-> None, pub |-> FALSE, notify |-> FALSE,
              change |-> [op |-> "retime", to |-> None]]

VARIABLES exists, emp, ver, pub,   \* the shifts row
          logs,                    \* schedule_change_logs, a sequence
          latch,                   \* log indexes with notified_at set
          cnt,                     \* cnt[i][e] = notifications to e about log row i
          sentBy,                  \* set of <<logIndex, sender>>
          pc, pv, fromVer, retried, \* per MCP call
          uiWrites, toggles, uiOwn  \* UI budget; UI log rows not yet notified

vars == <<exists, emp, ver, pub, logs, latch, cnt, sentBy, pc, pv, fromVer,
          retried, uiWrites, toggles, uiOwn>>

Init == /\ exists = TRUE
        /\ emp = "e1"
        /\ ver = 1
        /\ pub \in BOOLEAN
        /\ logs = <<>>
        /\ latch = {}
        /\ cnt = [i \in 1..MaxLogs |-> [e \in Emp |-> 0]]
        /\ sentBy = {}
        /\ pc = [c \in Calls |-> "idle"]
        /\ pv = [c \in Calls |-> NoPreview]
        /\ fromVer = [c \in Calls |-> 0]
        /\ retried = [c \in Calls |-> FALSE]
        /\ uiWrites = 0
        /\ toggles = 0
        /\ uiOwn = {}

LogRow(by, kind, before, after, v) ==
    [by |-> by, kind |-> kind, before |-> before, after |-> after, ver |-> v]

(***************************************************************************)
(* MCP: preview. One SELECT of the row (mcpScheduleWriteTools.ts          *)
(* loadShiftForWrite). It returns the token = hash(updated_at, args).     *)
(***************************************************************************)
Preview(c, ch, n) ==
    /\ pc[c] = "idle"
    /\ exists
    /\ pv' = [pv EXCEPT ![c] = [ver |-> ver, before |-> emp, pub |-> pub,
                                notify |-> n, change |-> ch]]
    /\ pc' = [pc EXCEPT ![c] = "previewed"]
    /\ UNCHANGED <<exists, emp, ver, pub, logs, latch, cnt, sentBy, fromVer,
                   retried, uiWrites, toggles, uiOwn>>

\* One UPDATE ... WHERE id = $1 AND restaurant_id = $2 AND updated_at = $token
\* (or DELETE with the same WHERE). The trigger writes the log row in the
\* same transaction. Zero rows back = stale.
Write(c, ch) ==
    LET p == pv[c]
        casOk == exists /\ (~UseCas \/ ver = p.ver)
    IN IF ~casOk
       THEN /\ pc' = [pc EXCEPT ![c] = IF pc[c] = "previewed" THEN "stale" ELSE pc[c]]
            /\ UNCHANGED <<exists, emp, ver, pub, logs, fromVer>>
       ELSE /\ fromVer' = [fromVer EXCEPT ![c] = ver]
            /\ pc' = [pc EXCEPT ![c] = IF pc[c] = "previewed" THEN "committed" ELSE "dupcommit"]
            /\ IF ch.op = "delete"
               THEN /\ exists' = FALSE
                    /\ UNCHANGED <<emp, ver, pub>>
                    /\ logs' = IF pub THEN Append(logs, LogRow(c, "deleted", emp, None, ver))
                               ELSE logs
               ELSE /\ emp' = AfterEmp(emp, ch)
                    /\ ver' = ver + 1
                    /\ UNCHANGED <<exists, pub>>
                    /\ logs' = IF pub THEN Append(logs, LogRow(c, "updated", emp, AfterEmp(emp, ch), ver + 1))
                               ELSE logs

\* Confirm. The model (the LLM) can send args that differ from the preview.
Confirm(c, ch) ==
    /\ pc[c] = "previewed"
    /\ IF ArgsBound /\ ch /= pv[c].change
       THEN /\ pc' = [pc EXCEPT ![c] = "rejected"]
            /\ UNCHANGED <<exists, emp, ver, pub, logs, fromVer>>
       ELSE Write(c, ch)
    /\ UNCHANGED <<latch, cnt, sentBy, pv, retried, uiWrites, toggles, uiOwn>>

\* The MCP client retries the same confirm after a timeout. Same token.
Retry(c) ==
    /\ pc[c] \in {"committed", "done"}
    /\ ~retried[c]
    /\ retried' = [retried EXCEPT ![c] = TRUE]
    /\ Write(c, pv[c].change)
    /\ UNCHANGED <<latch, cnt, sentBy, pv, uiWrites, toggles, uiOwn>>

\* Index of the log row that the notify step uses.
OwnRow(c) == {i \in 1..Len(logs) : logs[i].by = c}
NotifyKinds == {"updated", "deleted"}
LatestRow == {i \in 1..Len(logs) : logs[i].kind \in NotifyKinds /\
                \A j \in 1..Len(logs) : logs[j].kind \in NotifyKinds => j <= i}
LookupRow(c) == IF ExactLookup THEN OwnRow(c) ELSE LatestRow

\* notify-shift-changed: claim notified_at (zero rows = already sent), then
\* one email/push per recipient derived from the row.
SendRow(i, sender) ==
    IF i \in latch
    THEN UNCHANGED <<latch, cnt, sentBy>>
    ELSE /\ latch' = latch \cup {i}
         /\ cnt' = [cnt EXCEPT ![i] = [e \in Emp |->
                        cnt[i][e] + (IF e \in LogRecipients(logs[i]) THEN 1 ELSE 0)]]
         /\ sentBy' = sentBy \cup {<<i, sender>>}

\* Notify: only after a commit, only when the preview said notify on a
\* published shift. One invoke of notify-shift-changed with the row id.
Notify(c) ==
    /\ pc[c] = "committed"
    /\ pc' = [pc EXCEPT ![c] = "done"]
    /\ IF pv[c].notify /\ pv[c].pub /\ LookupRow(c) /= {}
       THEN SendRow(CHOOSE i \in LookupRow(c) : TRUE, c)
       ELSE UNCHANGED <<latch, cnt, sentBy>>
    /\ UNCHANGED <<exists, emp, ver, pub, logs, pv, fromVer, retried,
                   uiWrites, toggles, uiOwn>>

(***************************************************************************)
(* The Scheduling UI. A manager edit (useUpdateShift) or delete.          *)
(***************************************************************************)
UIEdit(e) ==
    /\ exists /\ uiWrites < UIMax
    /\ uiWrites' = uiWrites + 1
    /\ emp' = e
    /\ ver' = ver + 1
    /\ IF pub THEN /\ logs' = Append(logs, LogRow("ui", "updated", emp, e, ver + 1))
                   /\ uiOwn' = uiOwn \cup {Len(logs) + 1}
              ELSE UNCHANGED <<logs, uiOwn>>
    /\ UNCHANGED <<exists, pub, latch, cnt, sentBy, pc, pv, fromVer, retried, toggles>>

UIDelete ==
    /\ exists /\ uiWrites < UIMax
    /\ uiWrites' = uiWrites + 1
    /\ exists' = FALSE
    /\ IF pub THEN /\ logs' = Append(logs, LogRow("ui", "deleted", emp, None, ver))
                   /\ uiOwn' = uiOwn \cup {Len(logs) + 1}
              ELSE UNCHANGED <<logs, uiOwn>>
    /\ UNCHANGED <<emp, ver, pub, latch, cnt, sentBy, pc, pv, fromVer, retried, toggles>>

\* The UI notifies its own row (the checkbox is on).
UINotify(i) ==
    /\ i \in uiOwn
    /\ uiOwn' = uiOwn \ {i}
    /\ SendRow(i, "ui")
    /\ UNCHANGED <<exists, emp, ver, pub, logs, pc, pv, fromVer, retried,
                   uiWrites, toggles>>

\* publish_schedule / unpublish_schedule touch the row.
Toggle ==
    /\ exists /\ toggles < ToggleMax
    /\ toggles' = toggles + 1
    /\ pub' = ~pub
    /\ ver' = ver + 1
    /\ logs' = IF pub THEN Append(logs, LogRow("pub", "unpublished", emp, emp, ver + 1)) ELSE logs
    /\ UNCHANGED <<exists, emp, latch, cnt, sentBy, pc, pv, fromVer, retried, uiWrites, uiOwn>>

Next ==
    \/ \E c \in Calls, ch \in Changes, n \in BOOLEAN : Preview(c, ch, n)
    \/ \E c \in Calls, ch \in Changes : Confirm(c, ch)
    \/ \E c \in Calls : Retry(c) \/ Notify(c)
    \/ \E e \in Emp : UIEdit(e)
    \/ UIDelete
    \/ \E i \in 1..Len(logs) : UINotify(i)
    \/ Toggle

Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ exists \in BOOLEAN /\ pub \in BOOLEAN /\ emp \in Emp
    /\ pc \in [Calls -> {"idle", "previewed", "committed", "done", "stale",
                         "rejected", "dupcommit"}]

-----------------------------------------------------------------------------
(* Invariants. Each one names the bad outcome.                             *)

SentFor(i) == {e \in Emp : cnt[i][e] > 0}
Committed(c) == pc[c] \in {"committed", "done"}

\* 1. A stale preview never commits: the row version at the write is the
\*    version that the preview showed. A retry never writes a second time.
StaleNeverCommits ==
    \A c \in Calls :
        /\ pc[c] /= "dupcommit"
        /\ Committed(c) => fromVer[c] = pv[c].ver

\* 2. After the notify step, the employees notified about the change of
\*    call c are exactly the employees that its preview showed.
NotifiedEqualsPreview ==
    \A c \in Calls :
        pc[c] = "done" =>
            LET rows == OwnRow(c)
                notified == UNION {SentFor(i) : i \in rows}
            IN notified = Shown(pv[c])

\* 3. A failed write (stale or rejected confirm) sends no notification.
FailedWriteSendsNothing ==
    \A c \in Calls :
        pc[c] \in {"stale", "rejected"} =>
            \A x \in sentBy : x[2] /= c

\* 4. No employee gets two notifications for one change log row, and on a
\*    published shift each affected employee of a done MCP change gets one.
ExactlyOnce ==
    /\ \A i \in 1..MaxLogs, e \in Emp : cnt[i][e] <= 1
    /\ \A c \in Calls :
         (pc[c] = "done" /\ pv[c].pub /\ pv[c].notify) =>
             \A i \in OwnRow(c) : \A e \in LogRecipients(logs[i]) : cnt[i][e] = 1

=============================================================================
