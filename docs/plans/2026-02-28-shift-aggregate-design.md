# Shift Aggregate Domain Layer — Design

**Goal:** Implement a pure TypeScript domain layer for the Shift aggregate following event-sourcing patterns (decide/evolve/replay). No database, no UI — just domain logic with comprehensive TDD tests.

**Architecture:** Functional event-sourced aggregate. Commands produce events or throw DomainError. State is derived by folding events via `evolve`. All functions are pure — no side effects, no I/O.

**Tech Stack:** TypeScript, Vitest

---

## 1. State Machine

```
Draft ──→ Published ──→ Canceled
  │                        ▲
  └────────────────────────┘
```

- **Draft**: All edits allowed.
- **Published**: Edits allowed but emit explicit change events.
- **Canceled**: Terminal. No edits.

## 2. ShiftState

Derived from events via `replay(shiftId, events)`:

- `shiftId`, `restaurantId`, `locationId`, `timezone` (IANA), `businessDate` (YYYY-MM-DD)
- `startAt`, `endAt` (ISO instant, UTC)
- `roleId`, `shiftTypeId?`, `employeeId?` (null = open shift)
- `stations?`, `notes?`
- `status: Draft | Published | Canceled`
- `publishedAt?`, `canceledAt?`, `cancelReasonCode?`
- `version: number` (event stream position)

## 3. Events (12 types)

| Event | Payload |
|-------|---------|
| `ShiftCreated` | Full initial state |
| `ShiftTimeChanged` | oldStartAt, oldEndAt, newStartAt, newEndAt, reason? |
| `ShiftRoleChanged` | oldRoleId, newRoleId, reason? |
| `ShiftTypeChanged` | oldShiftTypeId?, newShiftTypeId?, reason? |
| `ShiftStationsChanged` | oldStations?, newStations? |
| `ShiftNotesChanged` | oldNotes?, newNotes? |
| `ShiftAssigned` | employeeId, reason? |
| `ShiftUnassigned` | oldEmployeeId, reason? |
| `ShiftReassigned` | oldEmployeeId, newEmployeeId, reason? |
| `ShiftPublished` | publishedAt |
| `ShiftUnpublished` | reason? |
| `ShiftCanceled` | canceledAt, reasonCode, notes? |

Event envelope: `eventId`, `shiftId`, `occurredAt`, `actor`, `correlationId?`, `causationId?`.

## 4. Commands (8 types)

| Command | Preconditions | Emits |
|---------|--------------|-------|
| `CreateShift` | I-01, I-02, version == 0 | `ShiftCreated` |
| `ChangeShiftTime` | Status ∈ {Draft, Published}, I-01 | `ShiftTimeChanged` |
| `ChangeRole` | Status ∈ {Draft, Published}, new ≠ current | `ShiftRoleChanged` |
| `AssignEmployee` | Status ∈ {Draft, Published}, shift is open | `ShiftAssigned` |
| `UnassignEmployee` | Status ∈ {Draft, Published}, has employee | `ShiftUnassigned` |
| `ReassignEmployee` | Status ∈ {Draft, Published}, has employee, new ≠ current | `ShiftReassigned` |
| `PublishShift` | Status == Draft, all invariants hold | `ShiftPublished` |
| `CancelShift` | Status ∈ {Draft, Published}, reasonCode required | `ShiftCanceled` |

Command envelope: `commandId`, `shiftId`, `expectedVersion`, `actor`, `payload`.

## 5. Invariants

| Code | Rule |
|------|------|
| I-01 | `endAt > startAt` and `duration >= 15 min` |
| I-02 | Required fields present after creation |
| I-03 | Status transitions follow state machine |
| I-04 | Assignment only on Draft/Published; no silent overwrite |
| I-05 | Published changes emit explicit events |
| I-06 | Overlap/clopening/availability are policy concerns, not aggregate |

## 6. ShiftInterval Value Object

Pure value object for time math:
- `create(businessDate, startTime, endTime)` — factory with validation
- `durationInHours` / `durationInMinutes` — handles overnight
- `endsOnNextDay` — true when end < start numerically
- `overlapsWith(other)` — detects overlap including overnight
- `restHoursBefore(other)` — gap calculation for clopening

Invariants at creation: duration > 0, duration ≤ 16h.

## 7. Policy Interfaces

Defined as interfaces with stub implementations. Called by application service, not by aggregate.

```typescript
interface PolicyResult { outcome: 'ok' | 'warn' | 'block'; code?: string; message?: string; }
interface ShiftPolicy { evaluate(context: PolicyContext): PolicyResult; }
```

5 policies: OverlapPolicy, RestHoursPolicy, AvailabilityPolicy, TimeOffPolicy, OvertimeForecastPolicy.

## 8. File Structure

```
src/domain/scheduling/
├── types.ts
├── shift-aggregate.ts
├── shift-interval.ts
├── invariants.ts
├── policies.ts
└── index.ts

tests/unit/domain/
├── shift-aggregate.test.ts   (~23 tests)
├── shift-interval.test.ts    (~12 tests)
├── invariants.test.ts         (~6 tests)
└── policies.test.ts           (~10 tests)
```

## 9. Out of Scope

- No database tables or migrations
- No event store infrastructure
- No UI changes or hook rewiring
- No edge function changes
- `ShiftUnpublished` command handler deferred (type defined only)
- Swap/claim events deferred entirely
