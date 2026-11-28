------------------------- MODULE AvailabilityWrites -------------------------
(***************************************************************************)
(* Model of the MCP availability write tools for ONE employee.             *)
(*                                                                         *)
(* Design: docs/superpowers/specs/2026-11-28-mcp-availability-tools-design *)
(*                                                                         *)
(* Storage (PR #874, supabase/migrations/20261105120000_availability_local *)
(* _time.sql):                                                             *)
(*   employee_availability keeps the local clock (start_time_local).       *)
(*   availability_exceptions keeps a UTC clock. The writer converts with   *)
(*   the offset of the exception date (AvailabilityExceptionDialog.tsx:88) *)
(*                                                                         *)
(* Actors:                                                                 *)
(*   MCP:  preview (read rows + token), then confirm (one RPC: lock, check *)
(*         token, write). The confirm runs under FOR UPDATE locks, so it   *)
(*         is one atomic step.                                             *)
(*   UI:   AvailabilityDialog / AvailabilityExceptionDialog direct writes. *)
(*                                                                         *)
(* Time unit: one hour. Each date has its own weekday, so the recurring    *)
(* row of date d is rec[d]. DstDate is the date of the time change.        *)
(* America/Chicago: CST = UTC-6, CDT = UTC-5. The change is at 02:00.      *)
(***************************************************************************)
EXTENDS Integers, FiniteSets

CONSTANTS Dates,          \* e.g. {1, 2, 3}
          DstDate,        \* the date of the time change, e.g. 2
          DstKind,        \* "spring" (02:00 CST -> 03:00 CDT) or "fall" (02:00 CDT -> 01:00 CST)
          WriteHours,     \* local hours that a writer can send
          MaxMcp,         \* bound on MCP previews
          MaxUi,          \* bound on UI edits
          UseToken,       \* TRUE = confirm checks the preview token (design)
          RejectGap,      \* TRUE = writer rejects a local time that does not exist (design)
          ReaderMode,     \* "canonical" (design) or "ui" (anchor the UTC clock to the exception date)
          Priority        \* "exception" (design) or "latest"

NoRow   == -1    \* no row
Unavail == -2    \* is_available = false

Inputs == WriteHours \cup {Unavail}

VARIABLES rec,        \* rec[d]: recurring row local hour, Unavail, or NoRow
          exc,        \* exc[d]: exception UTC clock, Unavail, or NoRow
          lastWriter, \* lastWriter[d] \in {"rec", "exc", "none"}: ghost for Priority = "latest"
          mcp,        \* the MCP session state
          mcpCount, uiCount,
          lastMcp,    \* lastMcp[k] = local value that the last MCP write received, or NoRow
          staleCommit \* ghost: TRUE when a confirm wrote over a change it did not preview

vars == <<rec, exc, lastWriter, mcp, mcpCount, uiCount, lastMcp, staleCommit>>

Kinds == {"rec", "exc"}
Keys  == Kinds \X Dates

(* ---------------- Time zone math (America/Chicago) ---------------------- *)
\* Absolute UTC hour of local hour h on date d: abs = d*24 + h - offset.
Std == -6
Dst == -5
\* Offset before / after the change.
Before == IF DstKind = "spring" THEN Std ELSE Dst
After  == IF DstKind = "spring" THEN Dst ELSE Std
\* The change instant in absolute UTC hours: 02:00 local in the "Before" offset.
ChangeAbs == DstDate * 24 + 2 - Before

\* Local hour that does not exist (spring 02:00) on the change date.
Nonexistent(d, h) == DstKind = "spring" /\ d = DstDate /\ h = 2

\* fromZonedTime: local -> UTC. A gap hour and an ambiguous hour take the
\* "Before" offset (the first occurrence). Same as date-fns-tz.
LocalToAbs(d, h) ==
  LET off == IF d < DstDate THEN Before
             ELSE IF d > DstDate THEN After
             ELSE IF h < 2 THEN Before
             ELSE IF Nonexistent(d, h) THEN Before
             ELSE IF DstKind = "fall" /\ h = 1 THEN Before
             ELSE After
  IN d * 24 + h - off

OffsetAt(abs) == IF abs < ChangeAbs THEN Before ELSE After
AbsToLocalHour(abs) == (abs + OffsetAt(abs)) % 24
AbsToLocalDate(abs) == (abs + OffsetAt(abs)) \div 24

\* Exception write: store the UTC clock (TIME column, mod 24).
ExcEncode(d, h) == IF h = Unavail THEN Unavail ELSE LocalToAbs(d, h) % 24

\* Exception read, design: pick the UTC date (d-1, d, d+1) whose instant
\* has the local date d.
CanonicalRead(d, u) ==
  LET c == {a \in {(d - 1) * 24 + u, d * 24 + u, (d + 1) * 24 + u} : AbsToLocalDate(a) = d}
  IN IF c = {} THEN NoRow ELSE AbsToLocalHour(CHOOSE a \in c : TRUE)

\* Exception read, counterfactual: the UI and SQL reader anchor the UTC
\* clock to the exception date (AvailabilityExceptionDialog.tsx:60,
\* 20261105120100_availability_conflict_local_time.sql:106-109).
UiRead(d, u) == AbsToLocalHour(d * 24 + u)

ReadExc(d) ==
  IF exc[d] \in {NoRow, Unavail} THEN exc[d]
  ELSE IF ReaderMode = "canonical" THEN CanonicalRead(d, exc[d]) ELSE UiRead(d, exc[d])

\* get_availability: the local value of one key.
Read(k) == IF k[1] = "rec" THEN rec[k[2]] ELSE ReadExc(k[2])

\* Stored state of one key. The preview token is a hash of this value.
Stored(k) == IF k[1] = "rec" THEN rec[k[2]] ELSE exc[k[2]]

\* Effective availability on date d, as the conflict list reads it.
Effective(d) ==
  IF Priority = "exception"
    THEN IF exc[d] # NoRow THEN ReadExc(d) ELSE rec[d]
    ELSE IF lastWriter[d] = "exc" THEN ReadExc(d) ELSE rec[d]

(* ---------------- Actions ----------------------------------------------- *)
Init == /\ rec = [d \in Dates |-> NoRow]
        /\ exc = [d \in Dates |-> NoRow]
        /\ lastWriter = [d \in Dates |-> "none"]
        /\ mcp = [pc |-> "idle", key |-> <<"rec", DstDate>>, input |-> NoRow, snap |-> NoRow]
        /\ mcpCount = 0
        /\ uiCount = 0
        /\ lastMcp = [k \in Keys |-> NoRow]
        /\ staleCommit = FALSE

\* Write one key and record the writer for Priority = "latest".
Put(k, v) ==
  /\ IF k[1] = "rec"
       THEN /\ rec' = [rec EXCEPT ![k[2]] = v] /\ UNCHANGED exc
       ELSE /\ exc' = [exc EXCEPT ![k[2]] = v] /\ UNCHANGED rec
  /\ lastWriter' = [lastWriter EXCEPT ![k[2]] = k[1]]

Encode(k, h) == IF k[1] = "rec" THEN h ELSE ExcEncode(k[2], h)

\* mcpAvailabilityTools.ts preview: check the input, read the rows, return
\* the conflict list and the token. A new preview replaces an old one.
Preview(k, h) ==
  /\ mcpCount < MaxMcp
  /\ ~(RejectGap /\ k[1] = "exc" /\ h # Unavail /\ Nonexistent(k[2], h))
  /\ mcp' = [pc |-> "previewed", key |-> k, input |-> h, snap |-> Stored(k)]
  /\ mcpCount' = mcpCount + 1
  /\ UNCHANGED <<rec, exc, lastWriter, uiCount, lastMcp, staleCommit>>

\* set_*_availability RPC: lock the employee row and the key rows, compare
\* the token, then write. One atomic step.
Confirm ==
  /\ mcp.pc = "previewed"
  /\ LET k == mcp.key
         fresh == Stored(k) = mcp.snap
     IN IF UseToken /\ ~fresh
          THEN /\ mcp' = [mcp EXCEPT !.pc = "idle"]      \* STALE_PREVIEW, no write
               /\ UNCHANGED <<rec, exc, lastWriter, lastMcp, staleCommit>>
          ELSE /\ Put(k, Encode(k, mcp.input))
               /\ lastMcp' = [lastMcp EXCEPT ![k] = mcp.input]
               /\ staleCommit' = (staleCommit \/ ~fresh)
               /\ mcp' = [mcp EXCEPT !.pc = "idle"]
  /\ UNCHANGED <<mcpCount, uiCount>>

\* The user drops the preview.
Abandon == /\ mcp.pc = "previewed"
           /\ mcp' = [mcp EXCEPT !.pc = "idle"]
           /\ UNCHANGED <<rec, exc, lastWriter, mcpCount, uiCount, lastMcp, staleCommit>>

\* A UI edit or delete (AvailabilityDialog.tsx:89, AvailabilityExceptionDialog.tsx:88).
\* The UI writes the same storage format as the MCP writer.
UiWrite(k, h) ==
  /\ uiCount < MaxUi
  /\ Put(k, IF h = NoRow THEN NoRow ELSE Encode(k, h))
  /\ lastMcp' = [lastMcp EXCEPT ![k] = NoRow]   \* the MCP write is no longer the last write
  /\ uiCount' = uiCount + 1
  /\ UNCHANGED <<mcp, mcpCount, staleCommit>>

\* All bounded steps are done. Stutter, so that the end is not a deadlock.
Done == /\ mcpCount = MaxMcp /\ uiCount = MaxUi /\ mcp.pc = "idle"
        /\ UNCHANGED vars

Next ==
  \/ \E k \in Keys, h \in Inputs : Preview(k, h)
  \/ Confirm
  \/ Abandon
  \/ \E k \in Keys, h \in Inputs \cup {NoRow} :
        /\ ~(k[1] = "exc" /\ h \in WriteHours /\ Nonexistent(k[2], h))   \* the UI form blocks a gap hour
        /\ UiWrite(k, h)
  \/ Done

Spec == Init /\ [][Next]_vars

(* ---------------- Invariants -------------------------------------------- *)
TypeOK ==
  /\ mcp.pc \in {"idle", "previewed"}
  /\ mcpCount \in 0..MaxMcp
  /\ uiCount \in 0..MaxUi
  /\ staleCommit \in BOOLEAN

\* A stale preview never commits.
NoStaleCommit == ~staleCommit

\* The local time that a read returns is equal to the local time that the
\* last write received.
RoundTrip == \A k \in Keys : lastMcp[k] # NoRow => Read(k) = lastMcp[k]

\* An exception has priority over the recurring row on its date.
ExceptionWins == \A d \in Dates : exc[d] # NoRow => Effective(d) = ReadExc(d)
=============================================================================
