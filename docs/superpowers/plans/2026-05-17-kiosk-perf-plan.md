# Kiosk Punch Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make kiosk punch in/out perceptually instant (<300 ms after tap) and fix the broken "Skip photo" button. Backend writes happen optimistically in the background while the UI shows success. Critical: a re-entry guard prevents double-punches during the optimistic window, and the post-INSERT dialogs (force_reset PIN-change, tip prompt) only open after the write confirms.

**Architecture:**
- Pure-client change. No DB migration, no new edge function.
- `ImageCapture` becomes ref-forwarding with optional `maxWidth`/`quality` props; capture is downscaled to 480×360 @ q0.6 (matches `EmployeeClock`).
- `useTimePunches` drops the `auth.getUser()` round-trip in favor of cached `getSession()`, and gains an opt-in `silent` flag so kiosk can suppress the duplicate global success toast.
- `KioskMode` rewires `handlePunch` from "await everything serially" to "verify PIN, show success, fire `mutate()` in background." A `processing` boolean guards re-entry. `force_reset` and tip dialogs are deferred to the per-call `onSuccess`. `resetCameraState` tears down the MediaStream via the new ref before closing the dialog.
- `punchContext` exposes `startPunchContext(timeoutMs)` so geolocation begins the moment the camera dialog opens (in parallel with capture), not when the user taps Confirm.
- Punch-status cache short-circuit is gated on `!hasQueuedPunches()` from `useOfflineQueue`.

**Tech Stack:** React 18 + TypeScript + Vite, TailwindCSS + shadcn/ui, Supabase JS client, React Query, Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-05-17-kiosk-perf-design.md`

---

## File Structure

### New
- `tests/unit/punchContext.test.ts` — eager geolocation start
- `tests/unit/ImageCapture.test.tsx` — downscale, quality, ref handle, lowered getUserMedia constraints
- `tests/unit/useTimePunches.test.tsx` — getSession (not getUser), silent toast, last_used_at not awaited
- `tests/unit/KioskMode.test.tsx` — skip-photo dialog close, optimistic success, rollback, re-entry guard, deferred dialogs, cache+offlineQueue, aria-live

### Modified
- `src/components/ImageCapture.tsx` — forwardRef + imperative `stopCamera`, `maxWidth`/`quality` props, lower getUserMedia ideal when maxWidth ≤ 480
- `src/utils/punchContext.ts` — add `startPunchContext(timeoutMs)`; preserve `collectPunchContext` behavior
- `src/hooks/useTimePunches.tsx` — `getSession()`, optional `silent`, fire-and-forget side effects
- `src/pages/KioskMode.tsx` — processing guard, optimistic flow, deferred dialogs, stopCamera ref call, cache gating, aria-live on success Alert
- `src/main.tsx` or `index.html` — one-line comment documenting `user-scalable=no` trade-off (no functional change)

---

## Task 1: ImageCapture — forwardRef + downscale + lowered constraints

**Why first:** Pure component, no React Query / Supabase dependencies. Failing-then-passing unit test is cheap.

**Files:**
- Modify: `src/components/ImageCapture.tsx`
- Create: `tests/unit/ImageCapture.test.tsx`

- [ ] **Step 1: Write failing tests.**

```ts
// tests/unit/ImageCapture.test.tsx
describe('ImageCapture', () => {
  it('exposes stopCamera via forwarded ref', async () => {
    const ref = createRef<ImageCaptureHandle>();
    render(<ImageCapture ref={ref} onCapture={() => {}} />);
    await waitFor(() => expect(ref.current?.stopCamera).toBeTypeOf('function'));
  });

  it('downscales to maxWidth before encoding', async () => {
    const onCapture = vi.fn();
    const ref = createRef<ImageCaptureHandle>();
    // mock getUserMedia to return a 1920x1080 track
    render(<ImageCapture ref={ref} onCapture={onCapture} maxWidth={480} quality={0.6} />);
    // trigger capture; assert the canvas was sized to 480x270 and toBlob called with 0.6
  });

  it('requests lower getUserMedia constraints when maxWidth <= 480', async () => {
    const getUserMedia = vi.spyOn(navigator.mediaDevices, 'getUserMedia');
    render(<ImageCapture onCapture={() => {}} maxWidth={480} />);
    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          video: expect.objectContaining({
            width: { ideal: 640 },
            height: { ideal: 480 },
          }),
        }),
      );
    });
  });

  it('stopCamera() halts all MediaStream tracks', async () => {
    const stopSpy = vi.fn();
    // ...mock MediaStreamTrack.stop = stopSpy
    const ref = createRef<ImageCaptureHandle>();
    render(<ImageCapture ref={ref} onCapture={() => {}} />);
    await waitFor(() => ref.current?.stopCamera());
    expect(stopSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement.**

Refactor `ImageCapture` to `React.forwardRef<ImageCaptureHandle, Props>(...)`. Inside:
- Keep `streamRef`, `videoRef`, `canvasRef` as today.
- Add `useImperativeHandle(ref, () => ({ stopCamera }), [stopCamera])` where `stopCamera` stops every track and clears the refs (extract the existing inline teardown into a `useCallback`).
- Read new optional props `maxWidth?: number` and `quality?: number` (default 0.8).
- In `getUserMedia` constraints, if `maxWidth && maxWidth <= 480`, request `{ width: { ideal: 640 }, height: { ideal: 480 } }`. Otherwise keep the existing 1920×1080 ideal.
- In `capturePhoto()`, when `maxWidth` is set, compute `scale = Math.min(1, maxWidth / video.videoWidth)`, size the canvas to `Math.round(video.videoWidth * scale) × Math.round(video.videoHeight * scale)` and draw the video into it. Pass `quality` through `canvas.toBlob('image/jpeg', quality)`.

Type-export `ImageCaptureHandle` for callers.

- [ ] **Step 3: `npm run test -- tests/unit/ImageCapture.test.tsx` → green.**

---

## Task 2: punchContext — eager geolocation

**Files:**
- Modify: `src/utils/punchContext.ts`
- Create: `tests/unit/punchContext.test.ts`

- [ ] **Step 1: Write failing test.**

```ts
// tests/unit/punchContext.test.ts
import { startPunchContext, collectPunchContext } from '@/utils/punchContext';

describe('startPunchContext', () => {
  it('begins geolocation immediately and returns a single shared promise', () => {
    const spy = vi.spyOn(navigator.geolocation, 'getCurrentPosition');
    const p1 = startPunchContext(3000);
    const p2 = startPunchContext(3000);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(p1).toBe(p2);
  });

  it('collectPunchContext awaits the in-flight start when present', async () => {
    const spy = vi.spyOn(navigator.geolocation, 'getCurrentPosition');
    startPunchContext(3000);
    await collectPunchContext(3000);
    expect(spy).toHaveBeenCalledTimes(1); // not started again
  });
});
```

- [ ] **Step 2: Implement.**

Add module-scoped `let inFlight: Promise<PunchContext> | null = null;`.

```ts
export const startPunchContext = (timeoutMs = 3000): Promise<PunchContext> => {
  if (inFlight) return inFlight;
  inFlight = collectPunchContext(timeoutMs).finally(() => {
    // Keep the resolved value addressable for ~10s, then clear so a stale
    // location isn't reused for the next employee's punch.
    setTimeout(() => { inFlight = null; }, 10_000);
  });
  return inFlight;
};
```

Update `collectPunchContext` so callers can opt into the shared promise: if `inFlight` exists, await it instead of starting a fresh `getCurrentPosition`. (Same behaviour, just reused.)

- [ ] **Step 3: `npm run test -- tests/unit/punchContext.test.ts` → green.**

---

## Task 3: useTimePunches — getSession, silent, last_used_at fire-and-forget

**Files:**
- Modify: `src/hooks/useTimePunches.tsx`
- Create: `tests/unit/useTimePunches.test.tsx`

- [ ] **Step 1: Write failing tests.**

Use a mocked Supabase client (`vi.mock('@/integrations/supabase/client')`) and a React Query test wrapper.

```ts
describe('useCreateTimePunch', () => {
  it('reads user from getSession() (no auth.getUser network call)', async () => {
    const getUser = vi.fn(); // should NOT be called
    const getSession = vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    // ...wire mocks
    const { result } = renderHook(() => useCreateTimePunch(), { wrapper });
    await act(() => result.current.mutateAsync({ /* payload */ }));
    expect(getUser).not.toHaveBeenCalled();
    expect(getSession).toHaveBeenCalled();
  });

  it('skips success toast when silent: true', async () => {
    const toast = vi.fn();
    // ...mock useToast
    const { result } = renderHook(() => useCreateTimePunch(), { wrapper });
    await act(() => result.current.mutateAsync({ /* payload */, silent: true }));
    expect(toast).not.toHaveBeenCalled();
  });

  it('does NOT await the punch INSERT before resolving when invoked via mutate()', async () => {
    // Optional, lower-priority — mostly covered by KioskMode test instead
  });
});
```

- [ ] **Step 2: Implement.**

In `useCreateTimePunch`:
- Replace `const { data: { user } } = await supabase.auth.getUser();` with `const { data: { session } } = await supabase.auth.getSession();` and use `session?.user?.id`. Throw the same "User not authenticated" error when missing.
- Add `silent?: boolean` to the mutation payload type. In `onSuccess`, only call `toast(...)` when `!variables?.silent`.
- The existing `await supabase.from('employee_pins').update(...)` at the KioskMode level is being removed in Task 4; no change here.

- [ ] **Step 3: `npm run test -- tests/unit/useTimePunches.test.tsx` → green.**

---

## Task 4: KioskMode — optimistic flow, processing guard, deferred dialogs, stopCamera, cache gating

**Why last:** Composes Tasks 1–3. This is the file that ties the perf win together; the unit test here is the closest thing to an integration test we have.

**Files:**
- Modify: `src/pages/KioskMode.tsx`
- Create: `tests/unit/KioskMode.test.tsx`

- [ ] **Step 1: Write failing tests.** Mock `verifyPinForRestaurant`, `useCreateTimePunch`, `useEmployeePunchStatus`, `useOfflineQueue`, `startPunchContext`, `ImageCaptureHandle.stopCamera`.

```ts
describe('KioskMode handlePunch', () => {
  it('Skip photo closes the camera dialog before running the punch', async () => {
    // render, open dialog, click Skip
    // assert: dialog is closed in the same tick; verifyPin still runs
  });

  it('shows success UI after verifyPin without waiting for INSERT', async () => {
    // verifyPin resolves immediately; mutate is a pending promise
    // assert: setLastResult / statusMessage rendered before mutate resolves
  });

  it('rolls back lastResult, closes force_reset and tip dialogs when INSERT errors', async () => {
    // mutate.onError fires; assert UI is back to idle, both dialogs closed
  });

  it('ignores a second tap during the in-flight punch window', async () => {
    // simulate two rapid Confirm clicks; assert verifyPin called once
  });

  it('opens force_reset PIN-change dialog only after INSERT resolves', async () => {
    // verifyPin returns force_reset=true; mutate pending; dialog not yet open
    // resolve mutate; dialog now open
  });

  it('opens tip submission dialog only after INSERT resolves', async () => {
    // analogous: tip-eligible result
  });

  it('uses cached punch status when fresh AND offline queue is empty', async () => {
    // assert fetchPunchStatus not called
  });

  it('skips cache when hasQueuedPunches() is true', async () => {
    // assert fetchPunchStatus IS called
  });

  it('success Alert has role="status" and aria-live="polite"', async () => {
    // after a success render
  });

  it('stopCamera is invoked before the dialog unmounts', async () => {
    // spy on the ref handle; assert called before cameraDialogOpen becomes false
  });
});
```

- [ ] **Step 2: Implement KioskMode changes.**

State:
- Add `const [processing, setProcessing] = useState(false);`
- Add `const imageCaptureRef = useRef<ImageCaptureHandle>(null);`
- Add `const pendingVerifyRef = useRef<EmployeePinWithEmployee | null>(null);` (carries the verify result into the per-call onSuccess).

`resetCameraState`:
```tsx
const resetCameraState = useCallback(() => {
  imageCaptureRef.current?.stopCamera();
  setCameraDialogOpen(false);
  setPendingAction(null);
  setCapturedPhoto(null);
}, []);
```

Open the camera dialog (existing `setCameraDialogOpen(true)` callsites): also call `setProcessing(false)` is NOT here — `processing` is set when we commit (Confirm/Skip tap).

`handleSkipPhoto`:
```tsx
const handleSkipPhoto = useCallback(() => {
  if (!pendingAction || processing) return;
  setProcessing(true);
  resetCameraState();
  void handlePunch(pendingAction, null);
}, [pendingAction, processing, resetCameraState]);
```

`handleConfirmPunch` (the Confirm-photo button handler): same pattern — `setProcessing(true)`, `resetCameraState()`, `void handlePunch(pendingAction, capturedPhoto)`.

`handlePunch`:
```tsx
const handlePunch = useCallback(async (action: 'in' | 'out', photo: Blob | null) => {
  if (processing && !pendingVerifyRef.current) {
    // Already entered via Confirm/Skip; allow continuation, not a second entry
  }

  // 1. Verify PIN
  const pinRow = await verifyPinForRestaurant(restaurantId, pinInput);
  if (!pinRow) {
    // existing failure path: increment attempts, clear, toast
    setProcessing(false);
    return;
  }
  pendingVerifyRef.current = pinRow;

  // 2. Determine in/out (cached or RPC)
  const status = await resolvePunchStatus(pinRow.employee_id);

  // 3. Optimistic success
  setLastResult({ employeeName: pinRow.employee.name, action: status.next });
  setStatusMessage(`Clocked ${status.next}`);
  setPinInput('');
  resetAttempts();

  // 4. Background mutation
  createPunch.mutate(
    {
      restaurantId,
      employeeId: pinRow.employee_id,
      action: status.next,
      photo,
      context: await startPunchContext(3000), // already in-flight, basically free
      silent: true,
    },
    {
      onSuccess: () => {
        // Open dependent dialogs NOW (after INSERT confirms)
        if (pinRow.force_reset) setPinChangeDialogOpen(true);
        else if (shouldPromptTip(status)) setTipDialogOpen(true);
        setProcessing(false);
        pendingVerifyRef.current = null;
      },
      onError: () => {
        // Roll back
        setLastResult(null);
        setStatusMessage('');
        setPinChangeDialogOpen(false);
        setTipDialogOpen(false);
        setProcessing(false);
        pendingVerifyRef.current = null;
        // useCreateTimePunch.onError already toasted
      },
    },
  );

  // 5. Fire-and-forget bookkeeping
  void supabase
    .from('employee_pins')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', pinRow.id)
    .then(({ error }) => { if (error) console.warn('last_used_at update failed', error); });
}, [/* deps */]);
```

Add `if (processing) return;` at the top of every handler that could re-enter (keypad digit, Confirm, Skip).

`resolvePunchStatus`:
```tsx
const resolvePunchStatus = async (employeeId: string) => {
  const queueDirty = hasQueuedPunches();
  if (!queueDirty) {
    const cached = queryClient.getQueryData<PunchStatus>(['employeePunchStatus', employeeId]);
    const cachedAt = queryClient.getQueryState(['employeePunchStatus', employeeId])?.dataUpdatedAt ?? 0;
    if (cached && Date.now() - cachedAt < 5_000) return cached;
  }
  return fetchPunchStatus(employeeId);
};
```

Camera dialog: pass `ref={imageCaptureRef}`, `maxWidth={480}`, `quality={0.6}` to `<ImageCapture />`. The keypad buttons get `disabled={processing}`.

Success Alert: `<div role="status" aria-live="polite" className="...">`.

When the camera dialog opens, call `void startPunchContext(3000)` so geolocation begins immediately.

- [ ] **Step 3: Document the user-scalable trade-off.** Add a one-line comment in `index.html` next to the viewport meta tag (or in `src/main.tsx` if set there). Example:

```html
<!-- user-scalable=no is intentional for the kiosk surface; see
     docs/superpowers/specs/2026-05-17-kiosk-perf-design.md (Major #4).
     The personal /clock page is unaffected. -->
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />
```

- [ ] **Step 4: `npm run test -- tests/unit/KioskMode.test.tsx` → green.**

---

## Task 5: Local verification (Phase 8 preflight)

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run test` (all unit tests, including the new files)
- [ ] `npm run build`
- [ ] `npm run dev` — manually walk the local kiosk: open dialog, Skip photo (dialog closes immediately), Confirm photo (success ≤ 300 ms), double-tap Confirm (only one punch). Mid-flow, kill the network and confirm the failure toast + UI rollback. Re-enable network and confirm the queued punch flushes.
- [ ] Existing E2E: `npm run test:e2e -- kiosk` continues to pass.

---

## Task 6: Phase 7 reviews

- [ ] code-simplifier pass (Phase 6).
- [ ] Multi-model code review (Phase 7a) on the diff.
- [ ] CodeRabbit (Phase 7b) on the PR.
- [ ] Address any concerns; re-run `npm run test` after fixes.

---

## Task 7: Ship

- [ ] Push `fix/kiosk-perf` and open the PR. PR description should:
  - Link to the design doc and this plan.
  - Note the WCAG 1.4.4 trade-off (user-scalable=no) and invite challenge.
  - Show before/after numbers from the local-kiosk smoke test.
- [ ] Watch CI; if anything goes red, iterate.
- [ ] Phase 10: retrospective + lessons capture.

---

## Done when

All 10 acceptance criteria in the design doc pass, the new unit tests are green, existing Playwright E2E suites pass, and a local-kiosk smoke test confirms perceptual latency ≤ 300 ms on the happy path.
