------------------------ MODULE PublishNotifications ------------------------
(***************************************************************************)
(* Model of ONE restaurant week: publish, edits after publish, a second    *)
(* publish, and notifier runs that can fail, crash, and retry.             *)
(*                                                                         *)
(* Design: docs/superpowers/specs/2026-11-28-mcp-publish-notifications-    *)
(*         design.md                                                       *)
(*                                                                         *)
(* Actors:                                                                 *)
(*   - A manager (UI or MCP). Publish, add a draft shift, edit a visible   *)
(*     shift. Each step is one database transaction.                       *)
(*   - Notifier runs (Workers). notify-schedule-published and              *)
(*     notify-shift-changed both claim through the same SQL function, so   *)
(*     the model has one kind of worker. A UI retry or a second publish    *)
(*     is one more worker run.                                             *)
(*   - The email/push provider. It drops a second send with the same       *)
(*     idempotency key (the notification row id).                          *)
(*                                                                         *)
(* A "change" is one schedule_change_logs row with one recipient employee. *)
(* A "notification row" is one schedule_notifications row: one employee,   *)
(* a set of change ids (schedule_notification_changes), and a status.      *)
(*                                                                         *)
(* Design flags (all TRUE in the planned design). Each counterfactual cfg  *)
(* turns off one flag.                                                     *)
(*   TriggerLog   - the shift write and the change-log row commit in one   *)
(*                  transaction (trigger log_shift_change).                *)
(*   UniqueClaim  - claim_schedule_notifications() takes an advisory lock  *)
(*                  and a UNIQUE (change_log_id, employee_id) link.        *)
(*   PendingOnly  - the publish notifier sends only to employees with a    *)
(*                  pending change. FALSE = the current notify-all.        *)
(*   IdemKey      - every send of a row uses the row id as the key.        *)
(*   RecordAfter  - status 'sent' is written only after the provider       *)
(*                  accepts. FALSE = mark sent at claim time.              *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Employees,   \* e.g. {"e1", "e2"}
          Workers,     \* notifier runs that can overlap, e.g. {"w1", "w2"}
          MaxChanges,  \* bound on change-log rows
          MaxRuns,     \* bound on notifier claims (retries included)
          MaxCrashes,  \* bound on notifier crashes
          TriggerLog, UniqueClaim, PendingOnly, IdemKey, RecordAfter

VARIABLES published,   \* TRUE after the first publish of the week
          drafts,      \* employees with a draft shift that is not visible
          chg,         \* chg[c] = recipient of change c (ground truth)
          logCount,    \* logCount[c] = number of change-log rows for change c
          unlogged,    \* changes written but not logged (ClientLog only)
          rows,        \* Seq of [emp, chgs, status, owner]
          pc,          \* pc[w] \in {"idle","claimed","sent","sendfail","crashed"}
          cur,         \* cur[w] = row index the worker holds (0 = none)
          received,    \* received[c][e] = notifications e got about c
          keysSeen,    \* row ids the provider accepted
          emptySends,  \* notifications delivered with no change in them
          runs, crashes

vars == <<published, drafts, chg, logCount, unlogged, rows, pc, cur,
          received, keysSeen, emptySends, runs, crashes>>

ChangeIds == 1..MaxChanges
Statuses  == {"claimed", "sent", "failed"}

Init == /\ published = FALSE
        /\ drafts = Employees           \* every employee has a draft shift
        /\ chg = <<>>
        /\ logCount = [c \in ChangeIds |-> 0]
        /\ unlogged = {}
        /\ rows = <<>>
        /\ pc = [w \in Workers |-> "idle"]
        /\ cur = [w \in Workers |-> 0]
        /\ received = [c \in ChangeIds |-> [e \in Employees |-> 0]]
        /\ keysSeen = {}
        /\ emptySends = 0
        /\ runs = 0
        /\ crashes = 0

Logged == {c \in 1..Len(chg) : logCount[c] > 0}

\* Change c for employee e is in a row with the given status set.
InRow(c, e, S) == \E i \in 1..Len(rows) :
                     /\ rows[i].emp = e
                     /\ c \in rows[i].chgs
                     /\ rows[i].status \in S

\* get_schedule_pending_notifications(): a logged change whose recipient has
\* no link row with status 'sent'. A 'claimed' or 'failed' link still counts
\* as pending (state in_doubt or failed in the tool output).
PendingQuery == {<<c, chg[c]>> : c \in {d \in Logged : ~InRow(d, chg[d], {"sent"})}}

\* What the claim treats as free. With UniqueClaim, any link row blocks the
\* pair (UNIQUE index). Without it, only a 'sent' row blocks it, and two runs
\* that read at the same time both take the pair.
Free(e) == {c \in Logged :
              /\ chg[c] = e
              /\ IF UniqueClaim THEN ~InRow(c, e, Statuses)
                                ELSE ~InRow(c, e, {"sent"})}

\* One change-log row per shift write. AppendChange is the shift write.
AppendChange(e) ==
    /\ chg' = Append(chg, e)
    /\ IF TriggerLog
          THEN /\ logCount' = [logCount EXCEPT ![Len(chg) + 1] = 1]
               /\ UNCHANGED unlogged
          ELSE /\ unlogged' = unlogged \cup {Len(chg) + 1}
               /\ UNCHANGED logCount

Untouched == <<rows, pc, cur, received, keysSeen, emptySends, runs, crashes>>

-----------------------------------------------------------------------------
(* Manager actions *)

\* publish_schedule (20260729120000_publish_schedule_tz_bucketing.sql:93-102)
\* flips each draft to published. The new 'published' trigger branch logs
\* one row per flipped shift. A publish with no draft flips nothing.
\* Model: one draft per step, so the flip of N drafts is N steps; this is a
\* superset of the one-transaction behavior for the invariants below.
PublishFlip(e) ==
    /\ e \in drafts
    /\ Len(chg) < MaxChanges
    /\ published' = TRUE
    /\ drafts' = drafts \ {e}
    /\ AppendChange(e)
    /\ UNCHANGED Untouched

\* A publish with no drafts left: the second publish with no changes.
PublishNoChange ==
    /\ drafts = {}
    /\ published' = TRUE
    /\ UNCHANGED <<drafts, chg, logCount, unlogged>>
    /\ UNCHANGED Untouched

\* A new draft shift in the week (UI ShiftDialog or MCP shift write). Not
\* visible, so not logged until the next publish flips it.
AddDraft(e) ==
    /\ published
    /\ e \notin drafts
    /\ drafts' = drafts \cup {e}
    /\ UNCHANGED <<published, chg, logCount, unlogged>>
    /\ UNCHANGED Untouched

\* An UPDATE or DELETE of a published shift (trigger log_shift_change,
\* 20251123000000_schedule_publishing.sql:96-163).
EditVisible(e) ==
    /\ published
    /\ Len(chg) < MaxChanges
    /\ AppendChange(e)
    /\ UNCHANGED <<published, drafts>>
    /\ UNCHANGED Untouched

\* Counterfactual only: the client writes the log after the shift write. A
\* timeout and a retry can write it twice; a crash writes it zero times.
ClientLog(c) ==
    /\ ~TriggerLog
    /\ c \in 1..Len(chg)
    /\ logCount[c] < 2
    /\ logCount' = [logCount EXCEPT ![c] = @ + 1]
    /\ unlogged' = unlogged \ {c}
    /\ UNCHANGED <<published, drafts, chg>>
    /\ UNCHANGED Untouched

-----------------------------------------------------------------------------
(* Notifier actions *)

NotifierFixed == <<published, drafts, chg, logCount, unlogged>>

\* claim_schedule_notifications(): one statement under the advisory lock.
\* Makes one new row for employee e with every free change of e.
\* RecordAfter = FALSE marks the row 'sent' already at claim time.
ClaimNew(w, e) ==
    /\ pc[w] = "idle"
    /\ published
    /\ runs < MaxRuns
    /\ LET S == Free(e) IN
         /\ (PendingOnly => S # {})
         /\ rows' = Append(rows, [emp |-> e, chgs |-> S, owner |-> w,
                                  status |-> IF RecordAfter THEN "claimed" ELSE "sent"])
    /\ cur' = [cur EXCEPT ![w] = Len(rows) + 1]
    /\ pc' = [pc EXCEPT ![w] = "claimed"]
    /\ runs' = runs + 1
    /\ UNCHANGED NotifierFixed
    /\ UNCHANGED <<received, keysSeen, emptySends, crashes>>

\* The same function also takes back a 'failed' row, or a 'claimed' row
\* whose owner crashed (lease older than the edge function wall-clock
\* limit). The row keeps its id, so it keeps its idempotency key.
Reclaim(w, i) ==
    /\ pc[w] = "idle"
    /\ runs < MaxRuns
    /\ i \in 1..Len(rows)
    /\ \/ rows[i].status = "failed"
       \/ rows[i].status = "claimed" /\ pc[rows[i].owner] = "crashed"
    /\ rows' = [rows EXCEPT ![i].status = "claimed", ![i].owner = w]
    /\ cur' = [cur EXCEPT ![w] = i]
    /\ pc' = [pc EXCEPT ![w] = "claimed"]
    /\ runs' = runs + 1
    /\ UNCHANGED NotifierFixed
    /\ UNCHANGED <<received, keysSeen, emptySends, crashes>>

\* sendEmailResult / sendWebPushToUser. The provider accepts.
SendOk(w) ==
    /\ pc[w] = "claimed"
    /\ LET r == rows[cur[w]]
           dup == IdemKey /\ cur[w] \in keysSeen
       IN /\ received' = IF dup THEN received
                         ELSE [c \in ChangeIds |->
                                 [e \in Employees |->
                                    IF e = r.emp /\ c \in r.chgs
                                       THEN received[c][e] + 1
                                       ELSE received[c][e]]]
          /\ emptySends' = IF ~dup /\ r.chgs = {} THEN emptySends + 1 ELSE emptySends
    /\ keysSeen' = keysSeen \cup {cur[w]}
    /\ pc' = [pc EXCEPT ![w] = "sent"]
    /\ UNCHANGED NotifierFixed
    /\ UNCHANGED <<rows, cur, runs, crashes>>

\* The provider rejects the send. Nothing reaches the employee.
SendFail(w) ==
    /\ pc[w] = "claimed"
    /\ pc' = [pc EXCEPT ![w] = "sendfail"]
    /\ UNCHANGED NotifierFixed
    /\ UNCHANGED <<rows, cur, received, keysSeen, emptySends, runs, crashes>>

\* mark_schedule_notification(id, 'sent').
RecordSent(w) ==
    /\ pc[w] = "sent"
    /\ rows' = [rows EXCEPT ![cur[w]].status = "sent"]
    /\ pc' = [pc EXCEPT ![w] = "idle"]
    /\ cur' = [cur EXCEPT ![w] = 0]
    /\ UNCHANGED NotifierFixed
    /\ UNCHANGED <<received, keysSeen, emptySends, runs, crashes>>

\* mark_schedule_notification(id, 'failed'). The pairs stay pending.
RecordFailed(w) ==
    /\ pc[w] = "sendfail"
    /\ rows' = [rows EXCEPT ![cur[w]].status =
                  IF RecordAfter THEN "failed" ELSE @]
    /\ pc' = [pc EXCEPT ![w] = "idle"]
    /\ cur' = [cur EXCEPT ![w] = 0]
    /\ UNCHANGED NotifierFixed
    /\ UNCHANGED <<received, keysSeen, emptySends, runs, crashes>>

\* The edge function dies after the claim or after the send, before the
\* record step. The row stays 'claimed' until a Reclaim.
Crash(w) ==
    /\ pc[w] \in {"claimed", "sent"}
    /\ crashes < MaxCrashes
    /\ pc' = [pc EXCEPT ![w] = "crashed"]
    /\ crashes' = crashes + 1
    /\ UNCHANGED NotifierFixed
    /\ UNCHANGED <<rows, cur, received, keysSeen, emptySends, runs>>

Next ==
    \/ \E e \in Employees : PublishFlip(e) \/ AddDraft(e) \/ EditVisible(e)
    \/ PublishNoChange
    \/ \E c \in ChangeIds : ClientLog(c)
    \/ \E w \in Workers :
          \/ \E e \in Employees : ClaimNew(w, e)
          \/ \E i \in 1..MaxRuns : Reclaim(w, i)
          \/ SendOk(w) \/ SendFail(w) \/ RecordSent(w) \/ RecordFailed(w)
          \/ Crash(w)

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
TypeOK == /\ published \in BOOLEAN
          /\ drafts \subseteq Employees
          /\ Len(chg) \in 0..MaxChanges
          /\ logCount \in [ChangeIds -> 0..2]
          /\ pc \in [Workers -> {"idle", "claimed", "sent", "sendfail", "crashed"}]
          /\ \A i \in 1..Len(rows) : rows[i].status \in Statuses
          /\ runs \in 0..MaxRuns

\* Each change after publish appears exactly once in the change log.
LogExactlyOnce == \A c \in 1..Len(chg) : logCount[c] = 1

\* No employee gets two notifications for the same change.
NoDuplicateDelivery == \A c \in ChangeIds, e \in Employees : received[c][e] <= 1

\* A second publish with no changes sends no notification: no notification
\* goes out without a change in it.
NoEmptyNotification == emptySends = 0

\* A change is in get_pending_notifications if and only if it has no sent
\* notification. Two halves, against what the employee actually received:
\*  - a 'sent' record is true: the employee got it;
\*  - a change the employee did not get is always listed as pending.
\* The one gap is in_doubt: delivered, then a crash before the record step.
\* The tool shows it as pending with state in_doubt until a Reclaim.
SentRecordIsTrue ==
    \A i \in 1..Len(rows) :
       rows[i].status = "sent" =>
          \A c \in rows[i].chgs : received[c][rows[i].emp] >= 1

UndeliveredIsPending ==
    \A c \in Logged : received[c][chg[c]] = 0 => <<c, chg[c]>> \in PendingQuery

PendingIffNotSent ==
    \A c \in Logged : (<<c, chg[c]>> \in PendingQuery) <=> ~InRow(c, chg[c], {"sent"})
=============================================================================
