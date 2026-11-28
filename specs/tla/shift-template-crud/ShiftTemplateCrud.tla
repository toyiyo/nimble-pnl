------------------------- MODULE ShiftTemplateCrud -------------------------
(***************************************************************************)
(* Model of the MCP shift template tools against concurrent planner edits. *)
(*                                                                         *)
(* Design: docs/superpowers/specs/2026-11-28-mcp-shift-template-tools-design.md *)
(*                                                                         *)
(* Actors:                                                                 *)
(*   - One MCP agent. It runs ONE tool: a batch create of the rows in New, *)
(*     an update of the template "t1", or a hard delete of "t1". Each tool *)
(*     is two requests: preview (reads only), then confirmed (writes).     *)
(*   - The planner UI in a second browser. It edits "t1"                   *)
(*     (useShiftTemplates.tsx update), deletes "t1", links shifts to "t1"  *)
(*     (apply suggested shifts, claim approval), adds pending open-shift   *)
(*     claims on "t1", and takes the slot of a row in New (a UI create).   *)
(*                                                                         *)
(* Planned design (all four flags TRUE):                                   *)
(*   StaleCheck  - the confirm RPC locks the template rows FOR UPDATE and  *)
(*                 compares the preview fingerprint. For update: only      *)
(*                 updated_at. For hard delete: updated_at, the ids of the *)
(*                 linked shifts, and the ids and status of all claims.    *)
(*   IdFingerprint - the fingerprint holds row ids (a hash in SQL). FALSE  *)
(*                 is the count-only fingerprint, open to an A-B-A change. *)
(*   AtomicBatch - the confirm RPC writes every row of the batch in one    *)
(*                 transaction. One bad row rolls back all rows.           *)
(*   FkGuard     - shifts.shift_template_id (ON DELETE SET NULL) and       *)
(*                 open_shift_claims.shift_template_id (ON DELETE CASCADE) *)
(*                 are foreign keys. An insert that references a template  *)
(*                 checks the row and takes FOR KEY SHARE in the same      *)
(*                 statement, so it cannot interleave with the delete.     *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS New,          \* rows of the MCP batch create, e.g. {"n1", "n2"}
          Shifts,       \* shift rows the UI can link to t1, e.g. {"s1"}
          Claims,       \* open-shift claims the UI can add on t1, e.g. {"c1"}
          MaxEdits,     \* bound on UI edits of t1
          StaleCheck,   \* TRUE in the planned design
          IdFingerprint, \* TRUE in the planned design
          AtomicBatch,  \* TRUE in the planned design
          FkGuard       \* TRUE in the planned design (real schema)

NONE == "none"

VARIABLES t1Exists,     \* shift_templates row t1 exists
          t1Ver,        \* t1.updated_at, as a counter
          created,      \* the rows of New that exist
          slotTaken,    \* rows of New whose active slot a UI create took
          shiftTpl,     \* shiftTpl[s] \in {"t1", NONE}
          claimSt,      \* claimSt[c] \in {"none", "pending", "approved"} (all on t1)
          mcpPc,        \* "idle", "previewed", "writing", "done", "failed"
          mcpOp,        \* "create", "update", "delete", or NONE
          snap,         \* preview fingerprint of t1
          writeQueue,   \* rows still to insert in the non-atomic batch
          uiPc,         \* uiPc[s] for the two-step link in the no-FK variant
          edits,        \* number of UI edits so far
          staleCommit   \* TRUE when a confirm wrote over a changed fingerprint

vars == <<t1Exists, t1Ver, created, slotTaken, shiftTpl, claimSt, mcpPc,
          mcpOp, snap, writeQueue, uiPc, edits, staleCommit>>

LinkedShifts == {s \in Shifts : shiftTpl[s] = "t1"}
LiveClaims == {c \in Claims : claimSt[c] # "none"}

\* The true state that a confirm of op acts on. Update touches only the
\* template row. Hard delete also changes every linked shift and claim.
Truth(op) == IF op = "update"
             THEN [exists |-> t1Exists, ver |-> t1Ver, shifts |-> {}, claims |-> claimSt]
             ELSE [exists |-> t1Exists, ver |-> t1Ver, shifts |-> LinkedShifts, claims |-> claimSt]

\* What the RPC compares. The count-only variant loses the row identity.
Checked(fp) == IF IdFingerprint THEN fp
               ELSE [exists |-> fp.exists, ver |-> fp.ver,
                     shifts |-> Cardinality(fp.shifts),
                     claims |-> Cardinality({c \in Claims : fp.claims[c] # "none"})]

Init == /\ t1Exists = TRUE
        /\ t1Ver = 0
        /\ created = {}
        /\ slotTaken = {}
        /\ shiftTpl = [s \in Shifts |-> NONE]
        /\ claimSt = [c \in Claims |-> "none"]
        /\ mcpPc = "idle"
        /\ mcpOp = NONE
        /\ snap = Truth("delete")
        /\ writeQueue = {}
        /\ uiPc = [s \in Shifts |-> "idle"]
        /\ edits = 0
        /\ staleCommit = FALSE

(* ---------------- MCP agent ---------------- *)

\* preview:true. Read-only. It reads t1, its linked shifts and its pending
\* claims (the same reads as useTemplateDeletionImpact.ts), and the slots of
\* the New rows. It returns the fingerprint inside preview_token.
Preview(op) == /\ mcpPc = "idle"
               /\ op = "create" \/ t1Exists
               /\ mcpOp' = op
               /\ snap' = Truth(op)
               /\ mcpPc' = "previewed"
               /\ UNCHANGED <<t1Exists, t1Ver, created, slotTaken, shiftTpl,
                              claimSt, writeQueue, uiPc, edits, staleCommit>>

\* confirmed:true for update or delete. One RPC transaction.
\* StaleCheck: SELECT ... FOR UPDATE on t1, then compare with the fingerprint.
ConfirmT1 == /\ mcpPc = "previewed"
             /\ mcpOp \in {"update", "delete"}
             /\ LET ok == t1Exists /\ (~StaleCheck \/ Checked(Truth(mcpOp)) = Checked(snap))
                IN IF ok
                   THEN /\ staleCommit' = (staleCommit \/ Truth(mcpOp) # snap)
                        /\ mcpPc' = "done"
                        /\ IF mcpOp = "update"
                           THEN /\ t1Ver' = t1Ver + 1
                                /\ UNCHANGED <<t1Exists, shiftTpl, claimSt>>
                           \* DELETE: the FK actions run in the same statement.
                           ELSE /\ t1Exists' = FALSE
                                /\ shiftTpl' = [s \in Shifts |->
                                       IF shiftTpl[s] = "t1" THEN NONE ELSE shiftTpl[s]]
                                /\ claimSt' = [c \in Claims |-> "none"]
                                /\ UNCHANGED t1Ver
                   ELSE /\ mcpPc' = "failed"   \* STALE_PREVIEW or NOT_FOUND
                        /\ UNCHANGED <<t1Exists, t1Ver, shiftTpl, claimSt, staleCommit>>
             /\ UNCHANGED <<created, slotTaken, mcpOp, snap, writeQueue, uiPc, edits>>

\* confirmed:true for the batch create, planned design: one transaction.
\* The partial unique index uq_shift_templates_active_slot rejects a row
\* whose slot is taken, and the error rolls back every row.
ConfirmCreateAtomic ==
    /\ AtomicBatch
    /\ mcpPc = "previewed"
    /\ mcpOp = "create"
    /\ IF New \cap slotTaken = {}
       THEN /\ created' = New
            /\ mcpPc' = "done"
       ELSE /\ UNCHANGED created
            /\ mcpPc' = "failed"
    /\ UNCHANGED <<t1Exists, t1Ver, slotTaken, shiftTpl, claimSt, mcpOp, snap,
                   writeQueue, uiPc, edits, staleCommit>>

\* Counterfactual: one INSERT per row, each in its own request.
StartCreateLoop ==
    /\ ~AtomicBatch
    /\ mcpPc = "previewed"
    /\ mcpOp = "create"
    /\ writeQueue' = New
    /\ mcpPc' = "writing"
    /\ UNCHANGED <<t1Exists, t1Ver, created, slotTaken, shiftTpl, claimSt,
                   mcpOp, snap, uiPc, edits, staleCommit>>

CreateOne(n) ==
    /\ mcpPc = "writing"
    /\ n \in writeQueue
    /\ IF n \in slotTaken
       THEN /\ mcpPc' = "failed"          \* stops; earlier rows stay
            /\ UNCHANGED <<created, writeQueue>>
       ELSE /\ created' = created \cup {n}
            /\ writeQueue' = writeQueue \ {n}
            /\ mcpPc' = IF writeQueue \ {n} = {} THEN "done" ELSE "writing"
    /\ UNCHANGED <<t1Exists, t1Ver, slotTaken, shiftTpl, claimSt, mcpOp, snap,
                   uiPc, edits, staleCommit>>

(* ---------------- Planner UI ---------------- *)

\* updateMutation -> update_shift_template_with_cascade (bumps updated_at).
UiEdit == /\ t1Exists
          /\ edits < MaxEdits
          /\ t1Ver' = t1Ver + 1
          /\ edits' = edits + 1
          /\ UNCHANGED <<t1Exists, created, slotTaken, shiftTpl, claimSt, mcpPc,
                         mcpOp, snap, writeQueue, uiPc, staleCommit>>

\* deleteMutation: DELETE FROM shift_templates; FK actions in the same statement.
UiDelete == /\ t1Exists
            /\ t1Exists' = FALSE
            /\ shiftTpl' = [s \in Shifts |->
                   IF shiftTpl[s] = "t1" THEN NONE ELSE shiftTpl[s]]
            /\ claimSt' = [c \in Claims |-> "none"]
            /\ UNCHANGED <<t1Ver, created, slotTaken, mcpPc, mcpOp, snap,
                           writeQueue, uiPc, edits, staleCommit>>

\* A UI create that takes the active slot of a row in New.
UiTakeSlot(n) == /\ n \notin slotTaken
                 /\ n \notin created
                 /\ slotTaken' = slotTaken \cup {n}
                 /\ UNCHANGED <<t1Exists, t1Ver, created, shiftTpl, claimSt, mcpPc,
                                mcpOp, snap, writeQueue, uiPc, edits, staleCommit>>

\* FK insert: the reference check and the write are one statement.
UiLinkShift(s) == /\ FkGuard
                  /\ shiftTpl[s] = NONE
                  /\ t1Exists
                  /\ shiftTpl' = [shiftTpl EXCEPT ![s] = "t1"]
                  /\ UNCHANGED <<t1Exists, t1Ver, created, slotTaken, claimSt, mcpPc,
                                 mcpOp, snap, writeQueue, uiPc, edits, staleCommit>>

\* Counterfactual without the FK: read the template, then write the shift.
UiReadTpl(s) == /\ ~FkGuard
                /\ uiPc[s] = "idle"
                /\ shiftTpl[s] = NONE
                /\ t1Exists
                /\ uiPc' = [uiPc EXCEPT ![s] = "read"]
                /\ UNCHANGED <<t1Exists, t1Ver, created, slotTaken, shiftTpl, claimSt,
                               mcpPc, mcpOp, snap, writeQueue, edits, staleCommit>>

UiWriteShift(s) == /\ ~FkGuard
                   /\ uiPc[s] = "read"
                   /\ shiftTpl' = [shiftTpl EXCEPT ![s] = "t1"]
                   /\ uiPc' = [uiPc EXCEPT ![s] = "done"]
                   /\ UNCHANGED <<t1Exists, t1Ver, created, slotTaken, claimSt, mcpPc,
                                  mcpOp, snap, writeQueue, edits, staleCommit>>

\* claim_open_shift: INSERT into open_shift_claims (FK to shift_templates).
UiAddClaim(c) == /\ claimSt[c] = "none"
                 /\ t1Exists
                 /\ claimSt' = [claimSt EXCEPT ![c] = "pending"]
                 /\ UNCHANGED <<t1Exists, t1Ver, created, slotTaken, shiftTpl, mcpPc,
                                mcpOp, snap, writeQueue, uiPc, edits, staleCommit>>

\* approve_open_shift_claim: a status change, no FK write on the template.
UiApproveClaim(c) == /\ claimSt[c] = "pending"
                     /\ claimSt' = [claimSt EXCEPT ![c] = "approved"]
                     /\ UNCHANGED <<t1Exists, t1Ver, created, slotTaken, shiftTpl, mcpPc,
                                    mcpOp, snap, writeQueue, uiPc, edits, staleCommit>>

\* A manager moves a shift off the template, or deletes the shift.
\* With UiLinkShift on another shift, the count stays the same (A-B-A).
UiUnlinkShift(s) == /\ shiftTpl[s] = "t1"
                    /\ shiftTpl' = [shiftTpl EXCEPT ![s] = NONE]
                    /\ UNCHANGED <<t1Exists, t1Ver, created, slotTaken, claimSt, mcpPc,
                                   mcpOp, snap, writeQueue, uiPc, edits, staleCommit>>

Next == \/ \E op \in {"create", "update", "delete"} : Preview(op)
        \/ ConfirmT1
        \/ ConfirmCreateAtomic
        \/ StartCreateLoop
        \/ \E n \in New : CreateOne(n)
        \/ UiEdit
        \/ UiDelete
        \/ \E n \in New : UiTakeSlot(n)
        \/ \E s \in Shifts : UiLinkShift(s) \/ UiReadTpl(s) \/ UiWriteShift(s)
        \/ \E c \in Claims : UiAddClaim(c) \/ UiApproveClaim(c)
        \/ \E s \in Shifts : UiUnlinkShift(s)

Spec == Init /\ [][Next]_vars

(* ---------------- Invariants ---------------- *)

TypeOK == /\ t1Exists \in BOOLEAN
          /\ t1Ver \in Nat
          /\ created \subseteq New
          /\ slotTaken \subseteq New
          /\ shiftTpl \in [Shifts -> {"t1", NONE}]
          /\ claimSt \in [Claims -> {"none", "pending", "approved"}]
          /\ mcpPc \in {"idle", "previewed", "writing", "done", "failed"}
          /\ mcpOp \in {"create", "update", "delete", NONE}
          /\ uiPc \in [Shifts -> {"idle", "read", "done"}]
          /\ staleCommit \in BOOLEAN

\* A stale preview never commits.
NoStaleCommit == ~staleCommit

\* A batch commits all rows or no rows (checked when the tool call ends).
BatchAllOrNothing == mcpPc \in {"done", "failed"} => created \in {{}, New}

\* No shift or coverage claim points to a missing template.
NoDanglingRef == /\ \A s \in Shifts : shiftTpl[s] = "t1" => t1Exists
                 /\ LiveClaims # {} => t1Exists
=============================================================================
