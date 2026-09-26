------------------------ MODULE ShiftTradeReminders ------------------------
(***************************************************************************)
(* Model of ONE reminder stage (for example "24h") for ONE open trade.     *)
(*                                                                         *)
(* Design: docs/superpowers/specs/2026-09-25-shift-trade-reminders-design.md *)
(* Actors:                                                                 *)
(*   - Two runs of the shift-trade-reminders cron. A slow run can overlap  *)
(*     the next tick (pg_cron does not wait for the edge function).        *)
(*   - One employee who accepts the trade (accept_shift_trade sets         *)
(*     status = 'pending_approval').                                       *)
(*                                                                         *)
(* ClaimFirst = TRUE is the planned design. Each run reads the candidate   *)
(* list, then calls claim_shift_trade_reminder(). That is ONE statement:   *)
(*   INSERT ... SELECT ... WHERE status = 'open' ON CONFLICT DO NOTHING    *)
(* The run sends only when the INSERT returned a row.                      *)
(*                                                                         *)
(* ClaimFirst = FALSE is the bank-reauth-notices order: send first, then   *)
(* record the dedupe row with ON CONFLICT DO NOTHING. TLC must find a      *)
(* double send.                                                            *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS Runs,        \* the overlapping cron runs, e.g. {"r1", "r2"}
          ClaimFirst   \* TRUE = claim row before the send (planned design)

VARIABLES status,      \* shift_trades.status: "open" or "pending_approval"
          claimed,     \* TRUE when the (trade, stage) dedupe row exists
          pc,          \* pc[r] \in {"idle", "read", "claimed", "sent", "done"}
          sends,       \* number of reminder fan-outs sent for this stage
          badClaim     \* TRUE if a claim row was written for a non-open trade

vars == <<status, claimed, pc, sends, badClaim>>

Init == /\ status = "open"
        /\ claimed = FALSE
        /\ pc = [r \in Runs |-> "idle"]
        /\ sends = 0
        /\ badClaim = FALSE

\* get_shift_trade_reminder_candidates(): statement 1. The run sees the
\* trade as open with no dedupe row for the stage.
Read(r) == /\ pc[r] = "idle"
           /\ status = "open"
           /\ ~claimed
           /\ pc' = [pc EXCEPT ![r] = "read"]
           /\ UNCHANGED <<status, claimed, sends, badClaim>>

\* claim_shift_trade_reminder(): one atomic statement. The unique index on
\* (shift_trade_id, stage) and the status re-check run in the same INSERT.
Claim(r) == /\ ClaimFirst
            /\ pc[r] = "read"
            /\ IF status = "open" /\ ~claimed
                  THEN /\ claimed' = TRUE
                       /\ pc' = [pc EXCEPT ![r] = "claimed"]
                  ELSE /\ UNCHANGED claimed
                       /\ pc' = [pc EXCEPT ![r] = "done"]
            /\ UNCHANGED <<status, sends, badClaim>>

\* The edge function sends the push fan-out.
Send(r) == /\ pc[r] = IF ClaimFirst THEN "claimed" ELSE "read"
           /\ sends' = sends + 1
           /\ pc' = [pc EXCEPT ![r] = IF ClaimFirst THEN "done" ELSE "sent"]
           /\ UNCHANGED <<status, claimed, badClaim>>

\* Counterfactual only: record the dedupe row after the send.
Record(r) == /\ ~ClaimFirst
             /\ pc[r] = "sent"
             /\ badClaim' = (badClaim \/ status # "open")
             /\ claimed' = TRUE
             /\ pc' = [pc EXCEPT ![r] = "done"]
             /\ UNCHANGED <<status, sends>>

\* accept_shift_trade (20260903034800:194-302) moves open -> pending_approval.
Accept == /\ status = "open"
          /\ status' = "pending_approval"
          /\ UNCHANGED <<claimed, pc, sends, badClaim>>

Next == \/ \E r \in Runs : Read(r) \/ Claim(r) \/ Send(r) \/ Record(r)
        \/ Accept

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
TypeOK == /\ status \in {"open", "pending_approval"}
          /\ claimed \in BOOLEAN
          /\ pc \in [Runs -> {"idle", "read", "claimed", "sent", "done"}]
          /\ sends \in 0..3
          /\ badClaim \in BOOLEAN

\* The bad outcome: employees get the same stage reminder twice.
AtMostOneSendPerStage == sends <= 1

\* The bad outcome: a dedupe row claims a stage for a trade that is no
\* longer open.
NoClaimForClosedTrade == ~badClaim
=============================================================================
