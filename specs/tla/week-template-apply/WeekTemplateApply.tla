-------------------------- MODULE WeekTemplateApply --------------------------
(***************************************************************************)
(* Model of apply_week_template for ONE restaurant week.                   *)
(*                                                                         *)
(* Design: docs/superpowers/specs/2026-11-28-mcp-week-template-tools-      *)
(*         design.md                                                       *)
(*                                                                         *)
(* A "slot" is one (employee, local day) pair. A shift row is a record     *)
(* [id, slot, val, locked]. "val" stands for the shift fields              *)
(* (start, end, break, position, notes).                                   *)
(*                                                                         *)
(* Actors:                                                                 *)
(*   Manager  - DryRun, then Confirm in two statements: Check and Commit.  *)
(*   Editor   - other sessions: insert, update, delete a shift.            *)
(*   TmplEdit - update_schedule_plan_template (bumps the version).         *)
(*   Approver - approves a time-off request (adds a slot to "off").        *)
(*                                                                         *)
(* Check  = SQL statement 1: advisory lock, SELECT ... FOR UPDATE of the   *)
(*          week rows, template FOR SHARE, token compare, plan compute.    *)
(* Commit = SQL statements 2..n: DELETE/UPDATE by id, INSERT, then the     *)
(*          post-check of the id set and time off. READ COMMITTED: an      *)
(*          INSERT by another session can commit between Check and Commit. *)
(*          Row locks block UPDATE/DELETE of the locked rows only.         *)
(*                                                                         *)
(* Guards (TRUE in the shipped design; each counterfactual .cfg turns one  *)
(* off):                                                                   *)
(*   CheckToken  - Check rejects when the fingerprint differs from token.  *)
(*   PostCheck   - Commit aborts when the week moved after Check.          *)
(*   FillGuard   - fill_gaps adds only to empty slots.                     *)
(*   DiffReplace - replace keeps equal shifts (no delete + re-insert).     *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS Slots, Vals, MaxEdits, MaxApplies,
          CheckToken, PostCheck, FillGuard, DiffReplace

None == 0   \* NULL. Vals start at 1, so 0 never collides.
Modes == {"replace", "fill_gaps"}

VARIABLES week,      \* committed shift rows of the week
          tmpl,      \* template: [Slots -> Vals \cup {None}]
          tver,      \* schedule_plan_templates.updated_at, as a counter
          off,       \* slots whose employee has approved time off
          nextId,    \* id generator for new shift rows
          edits,     \* bound on the other actors
          applies,   \* bound on the manager loop
          mgr,       \* "idle" | "previewed" | "checked"
          mode,      \* mode of the current dry run
          token,     \* fingerprint the dry run returned
          dryWeek,   \* week the dry run saw
          dryPlan,   \* diff the dry run returned
          chkWeek,   \* week that Check saw (rows locked from here)
          chkPlan,   \* plan that Check computed
          chkFp,     \* fingerprint that Check saw
          lastCommit \* {} or {record of the latest commit}

vars == <<week, tmpl, tver, off, nextId, edits, applies, mgr, mode, token,
          dryWeek, dryPlan, chkWeek, chkPlan, chkFp, lastCommit>>

Fp == <<week, tver, off>>          \* week_token inputs
Ids(w) == {r.id : r \in w}
InSlot(w, s) == {r \in w : r.slot = s}
MinId(S) == CHOOSE r \in S : \A q \in S : r.id <= q.id

EmptyPlan == [add |-> {}, del |-> {}, chg |-> {}]

(* The planned value of slot s. Time off: the option "skip" is modelled.   *)
(* "trade" adds the shift plus a draft trade; the shift rows are the same  *)
(* as a plain add, so the invariants do not change.                        *)
Want(t, o, s) == IF s \in o THEN None ELSE t[s]

(* Per-slot plan for replace with the diff (DiffReplace = TRUE).           *)
ReplaceSlot(w, t, o, s) ==
  LET E == InSlot(w, s)
      U == {r \in E : ~r.locked}
      v == Want(t, o, s)
      Eq == {r \in E : r.val = v}
  IN  IF v = None
        THEN [add |-> {}, del |-> Ids(U), chg |-> {}]
      ELSE IF Eq # {}
        THEN [add |-> {}, del |-> Ids(U \ {MinId(Eq)}), chg |-> {}]
      ELSE IF \E r \in E : r.locked
        THEN [add |-> {}, del |-> Ids(U), chg |-> {}]        \* skip: locked
      ELSE IF U # {}
        THEN [add |-> {}, del |-> Ids(U \ {MinId(U)}),
              chg |-> {[id |-> MinId(U).id, val |-> v]}]
      ELSE [add |-> {[slot |-> s, val |-> v]}, del |-> {}, chg |-> {}]

(* Per-slot plan for fill_gaps.                                            *)
FillSlot(w, t, o, s) ==
  LET E == InSlot(w, s)
      v == Want(t, o, s)
  IN  IF v = None THEN [add |-> {}, del |-> {}, chg |-> {}]
      ELSE IF E = {} THEN [add |-> {[slot |-> s, val |-> v]}, del |-> {}, chg |-> {}]
      ELSE IF ~FillGuard /\ (\E r \in E : ~r.locked /\ r.val # v)
        THEN [add |-> {}, del |-> {},                         \* counterfactual
              chg |-> {[id |-> MinId({r \in E : ~r.locked}).id, val |-> v]}]
      ELSE [add |-> {}, del |-> {}, chg |-> {}]

(* The old apply_schedule_plan_template replace: delete every unlocked     *)
(* row, then insert every template shift (DiffReplace = FALSE).            *)
OldReplaceSlot(w, t, o, s) ==
  LET E == InSlot(w, s)
      v == Want(t, o, s)
  IN  [add |-> IF v # None /\ ~(\E r \in E : r.locked)
                 THEN {[slot |-> s, val |-> v]} ELSE {},
       del |-> Ids({r \in E : ~r.locked}), chg |-> {}]

Slot(w, t, o, m, s) ==
  IF m = "fill_gaps" THEN FillSlot(w, t, o, s)
  ELSE IF DiffReplace THEN ReplaceSlot(w, t, o, s)
  ELSE OldReplaceSlot(w, t, o, s)

Plan(w, t, o, m) ==
  [add |-> UNION {Slot(w, t, o, m, s).add : s \in Slots},
   del |-> UNION {Slot(w, t, o, m, s).del : s \in Slots},
   chg |-> UNION {Slot(w, t, o, m, s).chg : s \in Slots}]

IsEmpty(p) == p.add = {} /\ p.del = {} /\ p.chg = {}

(* Apply plan p to rows w. New ids start at n. Ids are assigned by slot    *)
(* order through CHOOSE, so the result is a function of (w, p, n).         *)
RECURSIVE AddRows(_, _)
AddRows(A, n) ==
  IF A = {} THEN {}
  ELSE LET a == CHOOSE x \in A : TRUE
       IN  {[id |-> n, slot |-> a.slot, val |-> a.val, locked |-> FALSE]}
           \cup AddRows(A \ {a}, n + 1)

ChgVal(p, r) == IF \E c \in p.chg : c.id = r.id
                  THEN (CHOOSE c \in p.chg : c.id = r.id).val ELSE r.val

Kept(w, p) ==
  {[id |-> r.id, slot |-> r.slot, val |-> ChgVal(p, r), locked |-> r.locked] :
     r \in {q \in w : q.id \notin p.del}}

ApplyPlan(w, p, n) == Kept(w, p) \cup AddRows(p.add, n)

-----------------------------------------------------------------------------
Init ==
  /\ week \in { {},
                {[id |-> 1, slot |-> "a", val |-> 1, locked |-> FALSE]},
                {[id |-> 1, slot |-> "a", val |-> 1, locked |-> FALSE],
                 [id |-> 2, slot |-> "b", val |-> 2, locked |-> TRUE]} }
  /\ tmpl \in [Slots -> Vals \cup {None}]
  /\ tver = 0
  /\ off = {}
  /\ nextId = 3
  /\ edits = 0
  /\ applies = 0
  /\ mgr = "idle"
  /\ mode = "replace"
  /\ token = None
  /\ dryWeek = {}
  /\ dryPlan = EmptyPlan
  /\ chkWeek = {}
  /\ chkPlan = EmptyPlan
  /\ chkFp = None
  /\ lastCommit = {}

MgrVars == <<mgr, mode, token, dryWeek, dryPlan, chkWeek, chkPlan, chkFp, lastCommit, applies>>

(* preview_week_template_apply: read only.                                 *)
DryRun(m) ==
  /\ mgr \in {"idle", "previewed"}
  /\ applies < MaxApplies
  /\ mgr' = "previewed"
  /\ mode' = m
  /\ token' = Fp
  /\ dryWeek' = week
  /\ dryPlan' = Plan(week, tmpl, off, m)
  /\ UNCHANGED <<week, tmpl, tver, off, nextId, edits, applies, chkWeek, chkPlan, chkFp, lastCommit>>

(* apply_week_template statement 1.                                        *)
Check ==
  /\ mgr = "previewed"
  /\ IF CheckToken /\ Fp # token
       THEN /\ mgr' = "idle"                                  \* stale: RAISE
            /\ UNCHANGED <<chkWeek, chkPlan, chkFp>>
       ELSE /\ mgr' = "checked"
            /\ chkWeek' = week
            /\ chkPlan' = Plan(week, tmpl, off, mode)
            /\ chkFp' = Fp
  /\ UNCHANGED <<week, tmpl, tver, off, nextId, edits, applies, mode, token,
                 dryWeek, dryPlan, lastCommit>>

(* apply_week_template statements 2..n plus the post-check, one commit.    *)
Commit ==
  /\ mgr = "checked"
  /\ LET result   == ApplyPlan(week, chkPlan, nextId)
         expected == ApplyPlan(chkWeek, chkPlan, nextId)
         ok       == ~PostCheck \/ (week = chkWeek /\ off = chkFp[3])
     IN  IF ok
           THEN /\ week' = result
                /\ nextId' = nextId + Cardinality(chkPlan.add)
                /\ lastCommit' = {[mode |-> mode, token |-> token,
                                  fpCheck |-> chkFp,
                                  before |-> week, result |-> result,
                                  dryExpected |-> ApplyPlan(dryWeek, dryPlan, nextId),
                                  dryPlan |-> dryPlan]}
           ELSE UNCHANGED <<week, nextId, lastCommit>>         \* RAISE: rollback
  /\ mgr' = "idle"
  /\ applies' = applies + 1
  /\ UNCHANGED <<tmpl, tver, off, edits, mode, token, dryWeek, dryPlan, chkWeek, chkPlan, chkFp>>

Locked == IF mgr = "checked" THEN Ids(chkWeek) ELSE {}

(* create_shift / any INSERT. Row locks do not block an INSERT.            *)
EditInsert(s, v) ==
  /\ edits < MaxEdits
  /\ week' = week \cup {[id |-> nextId, slot |-> s, val |-> v, locked |-> FALSE]}
  /\ nextId' = nextId + 1
  /\ edits' = edits + 1
  /\ UNCHANGED <<tmpl, tver, off>> /\ UNCHANGED MgrVars

(* update_shift. Blocked while Check holds the row lock.                   *)
EditUpdate(r, v) ==
  /\ edits < MaxEdits
  /\ r \in week /\ r.id \notin Locked /\ r.val # v
  /\ week' = (week \ {r}) \cup {[r EXCEPT !.val = v]}
  /\ edits' = edits + 1
  /\ UNCHANGED <<tmpl, tver, off, nextId>> /\ UNCHANGED MgrVars

(* delete_shift. Blocked while Check holds the row lock.                   *)
EditDelete(r) ==
  /\ edits < MaxEdits
  /\ r \in week /\ r.id \notin Locked
  /\ week' = week \ {r}
  /\ edits' = edits + 1
  /\ UNCHANGED <<tmpl, tver, off, nextId>> /\ UNCHANGED MgrVars

(* update_schedule_plan_template. Blocked by FOR SHARE while checked.      *)
EditTemplate(s, v) ==
  /\ edits < MaxEdits
  /\ mgr # "checked"
  /\ tmpl[s] # v
  /\ tmpl' = [tmpl EXCEPT ![s] = v]
  /\ tver' = tver + 1
  /\ edits' = edits + 1
  /\ UNCHANGED <<week, off, nextId>> /\ UNCHANGED MgrVars

(* A time-off request is approved. Nothing locks time_off_requests.        *)
ApproveTimeOff(s) ==
  /\ edits < MaxEdits
  /\ s \notin off
  /\ off' = off \cup {s}
  /\ edits' = edits + 1
  /\ UNCHANGED <<week, tmpl, tver, nextId>> /\ UNCHANGED MgrVars

Next ==
  \/ \E m \in Modes : DryRun(m)
  \/ Check \/ Commit
  \/ \E s \in Slots, v \in Vals : EditInsert(s, v) \/ EditTemplate(s, v)
  \/ \E r \in week, v \in Vals : EditUpdate(r, v)
  \/ \E r \in week : EditDelete(r)
  \/ \E s \in Slots : ApproveTimeOff(s)

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
\* Invariants. Each one states the bad outcome the design must prevent.

\* 1. A stale dry run never commits.
NoStaleCommit ==
  \A c \in lastCommit : c.fpCheck = c.token

\* 2. The commit result equals the dry-run diff applied to the week the dry
\*    run saw. (With guards on, every commit is one where nothing changed.)
DryRunEqualsResult ==
  \A c \in lastCommit : c.result = c.dryExpected

\* 3. fill_gaps never changes or deletes an existing shift.
FillGapsKeepsRows ==
  \A c \in lastCommit : c.mode = "fill_gaps" => c.before \subseteq c.result

\* 4. replace deletes only the shift ids that the dry run lists.
DeletesOnlyListed ==
  \A c \in lastCommit : (Ids(c.before) \ Ids(c.result)) \subseteq c.dryPlan.del

\* 5. A second apply with the same input changes nothing.
Idempotent ==
  \A m \in Modes :
    IsEmpty(Plan(ApplyPlan(week, Plan(week, tmpl, off, m), nextId), tmpl, off, m))
=============================================================================
