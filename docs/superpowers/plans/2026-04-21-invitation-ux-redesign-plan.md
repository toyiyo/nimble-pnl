# Invitation UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the invitation UX with resend buttons for expired invites, a collapsed history view, pending-invite confirmation before re-sending, and a helpful expired-link page.

**Architecture:** Extract shared utility functions into `src/lib/invitationUtils.ts`; modify the three affected components (`TeamInvitations`, `CollaboratorInvitations`, `AcceptInvitation`) and the `useCollaborators` hook. No backend changes required.

**Tech Stack:** React 18, TypeScript, Supabase JS SDK, React Query, shadcn/ui, Vitest + React Testing Library.

---

### Task 1: Create `invitationUtils.ts` and tests

**Files:**
- Create: `src/lib/invitationUtils.ts`
- Create: `tests/unit/invitationUtils.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/invitationUtils.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatExpiresIn, classifyInvitationError } from '@/lib/invitationUtils';

describe('formatExpiresIn', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T12:00:00Z'));
  });

  it('returns "Expires in 3 days" for a future date 3 days away', () => {
    const future = new Date('2026-04-24T12:00:00Z').toISOString();
    expect(formatExpiresIn(future)).toBe('Expires in 3 days');
  });

  it('returns "Expires tomorrow" for a future date 1 day away', () => {
    const tomorrow = new Date('2026-04-22T12:00:00Z').toISOString();
    expect(formatExpiresIn(tomorrow)).toBe('Expires tomorrow');
  });

  it('returns "Expires today" when less than 1 day remains', () => {
    const soonish = new Date('2026-04-21T18:00:00Z').toISOString();
    expect(formatExpiresIn(soonish)).toBe('Expires today');
  });

  it('returns "Expired yesterday" for yesterday', () => {
    const yesterday = new Date('2026-04-20T12:00:00Z').toISOString();
    expect(formatExpiresIn(yesterday)).toBe('Expired yesterday');
  });

  it('returns "Expired 5 days ago" for 5 days past', () => {
    const past = new Date('2026-04-16T12:00:00Z').toISOString();
    expect(formatExpiresIn(past)).toBe('Expired 5 days ago');
  });
});

describe('classifyInvitationError', () => {
  it('returns "expired" for the exact expired message', () => {
    expect(classifyInvitationError('Invitation has expired')).toBe('expired');
  });

  it('returns "invalid" for any other message', () => {
    expect(classifyInvitationError('Invalid token')).toBe('invalid');
    expect(classifyInvitationError('')).toBe('invalid');
    expect(classifyInvitationError('Not found')).toBe('invalid');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test -- tests/unit/invitationUtils.test.ts
```
Expected: FAIL with "Cannot find module '@/lib/invitationUtils'"

- [ ] **Step 3: Create the utility file**

```typescript
// src/lib/invitationUtils.ts

export function formatExpiresIn(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  if (days > 1) return `Expires in ${days} days`;
  if (days === 1) return 'Expires tomorrow';
  if (days === 0) return 'Expires today';
  const expiredDays = Math.abs(days);
  if (expiredDays === 1) return 'Expired yesterday';
  return `Expired ${expiredDays} days ago`;
}

export function classifyInvitationError(message: string): 'expired' | 'invalid' {
  return message === 'Invitation has expired' ? 'expired' : 'invalid';
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test -- tests/unit/invitationUtils.test.ts
```
Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/invitationUtils.ts tests/unit/invitationUtils.test.ts
git commit -m "feat: add invitation utility functions (formatExpiresIn, classifyInvitationError)"
```

---

### Task 2: `AcceptInvitation.tsx` — Expired vs invalid UX

**Files:**
- Modify: `src/pages/AcceptInvitation.tsx`

- [ ] **Step 1: Add `'expired'` to the status type and wire up `classifyInvitationError`**

In `AcceptInvitation.tsx`, make the following changes:

1. Add import at top (after existing imports):
```typescript
import { classifyInvitationError } from '@/lib/invitationUtils';
```

2. Change the `useState` for `status` on line 24 from:
```typescript
const [status, setStatus] = useState<'loading' | 'valid' | 'invalid' | 'accepted' | 'error' | 'needs_auth'>('loading');
```
to:
```typescript
const [status, setStatus] = useState<'loading' | 'valid' | 'invalid' | 'expired' | 'accepted' | 'error' | 'needs_auth'>('loading');
```

3. Change the `else` branch in `validateInvitation` (line 88–90) from:
```typescript
      } else {
        throw new Error(data.error || 'Invalid invitation');
      }
```
to:
```typescript
      } else {
        throw new Error(data.error || '');
      }
```

4. Change the `catch` block in `validateInvitation` (lines 91–96) from:
```typescript
    } catch (error: any) {
      console.error('Error validating invitation:', error);
      setStatus('invalid');
    } finally {
```
to:
```typescript
    } catch (error: any) {
      console.error('Error validating invitation:', error);
      setStatus(classifyInvitationError(error?.message || ''));
    } finally {
```

- [ ] **Step 2: Add the expired render branch**

Add this block immediately **before** the `if (status === 'invalid')` block (before line 243):

```typescript
  if (status === 'expired') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 to-secondary/5">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
              <Clock className="w-6 h-6 text-amber-600" />
            </div>
            <CardTitle>Invitation Expired</CardTitle>
            <CardDescription>
              This invitation link is no longer valid. Ask your manager to resend it from the Team page.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => navigate('/')}>
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run typecheck 2>&1 | grep -i "AcceptInvitation\|invitationUtils"
```
Expected: no errors for these files

- [ ] **Step 4: Commit**

```bash
git add src/pages/AcceptInvitation.tsx
git commit -m "feat: show helpful expired message on invitation link page"
```

---

### Task 3: `TeamInvitations.tsx` — Resend button + expires-in label

**Files:**
- Modify: `src/components/TeamInvitations.tsx`

- [ ] **Step 1: Add import, resend state, and resend function**

1. Add `RefreshCw` to the lucide import on line 11:
```typescript
import { Mail, Plus, Clock, CheckCircle, XCircle, Trash2, RefreshCw } from 'lucide-react';
```

2. Add import for the utility (after the lucide import):
```typescript
import { formatExpiresIn } from '@/lib/invitationUtils';
```

3. Add `resendingIds` state after the existing `sending` state (after line 36):
```typescript
  const [resendingIds, setResendingIds] = useState<Set<string>>(new Set());
```

4. Add `resendInvitation` function after `sendInvitation` (after line 153):
```typescript
  const resendInvitation = async (invitation: Invitation) => {
    setResendingIds(prev => new Set(prev).add(invitation.id));
    try {
      const { error } = await supabase.functions.invoke('send-team-invitation', {
        body: { restaurantId, email: invitation.email, role: invitation.role },
      });
      if (error) throw error;
      toast({ title: 'Invitation resent', description: `New invite sent to ${invitation.email}` });
      fetchInvitations();
    } catch {
      toast({ title: 'Error', description: 'Failed to resend invitation', variant: 'destructive' });
    } finally {
      setResendingIds(prev => { const s = new Set(prev); s.delete(invitation.id); return s; });
    }
  };
```

- [ ] **Step 2: Update the date label and add the Resend button in the render**

1. Replace the expires date display (lines 259–264) from:
```typescript
                      <p>
                        {new Date(invitation.createdAt).toLocaleDateString()}
                        {invitation.expiresAt && (
                          <span> • Expires {new Date(invitation.expiresAt).toLocaleDateString()}</span>
                        )}
                      </p>
```
to:
```typescript
                      <p>
                        {invitation.expiresAt && invitation.status === 'pending'
                          ? formatExpiresIn(invitation.expiresAt)
                          : invitation.expiresAt && invitation.status === 'expired'
                          ? formatExpiresIn(invitation.expiresAt)
                          : new Date(invitation.createdAt).toLocaleDateString()}
                      </p>
```

2. Replace the action buttons area (lines 269–284) from:
```typescript
                <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-3">
                  <Badge variant={statusColors[invitation.status]} className="flex items-center gap-1 text-xs">
                    {statusIcons[invitation.status]}
                    <span className="capitalize">{invitation.status}</span>
                  </Badge>
                  
                  {canManageInvites && invitation.status === 'pending' && (
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => deleteInvitation(invitation.id, invitation.email)}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 p-2"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
```
to:
```typescript
                <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-3">
                  <Badge variant={statusColors[invitation.status]} className="flex items-center gap-1 text-xs">
                    {statusIcons[invitation.status]}
                    <span className="capitalize">{invitation.status}</span>
                  </Badge>
                  
                  {canManageInvites && invitation.status === 'pending' && (
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => deleteInvitation(invitation.id, invitation.email)}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 p-2"
                      aria-label={`Cancel invitation for ${invitation.email}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}

                  {canManageInvites && invitation.status === 'expired' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => resendInvitation(invitation)}
                      disabled={resendingIds.has(invitation.id)}
                      className="text-primary hover:text-primary hover:bg-primary/10 p-2"
                      aria-label={`Resend invitation to ${invitation.email}`}
                    >
                      <RefreshCw className={`h-4 w-4 ${resendingIds.has(invitation.id) ? 'animate-spin' : ''}`} />
                    </Button>
                  )}
                </div>
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run typecheck 2>&1 | grep -i "TeamInvitations"
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/components/TeamInvitations.tsx
git commit -m "feat: add resend button and expires-in label to team invitations"
```

---

### Task 4: `TeamInvitations.tsx` — History collapse

**Files:**
- Modify: `src/components/TeamInvitations.tsx`

- [ ] **Step 1: Add `showHistory` state and split invitations into active vs history**

Add after the `resendingIds` state:
```typescript
  const [showHistory, setShowHistory] = useState(false);
```

Add computed values after the `statusColors` object (before the return statement, around line 168):
```typescript
  const activeInvitations = invitations.filter(
    inv => inv.status === 'pending' || inv.status === 'expired'
  );
  const historyInvitations = invitations.filter(
    inv => inv.status === 'accepted' || inv.status === 'cancelled'
  );
  const visibleInvitations = showHistory ? invitations : activeInvitations;
```

- [ ] **Step 2: Replace `invitations.map(...)` with `visibleInvitations.map(...)` and add history toggle**

1. In the render, change line 249 from:
```typescript
          <div className="space-y-3 md:space-y-4">
            {invitations.map((invitation) => (
```
to:
```typescript
          <div className="space-y-3 md:space-y-4">
            {visibleInvitations.map((invitation) => (
```

2. After the closing `</div>` of the map (before the closing `</div>` of the outer content div, around line 287), add the history toggle:
```typescript
            {historyInvitations.length > 0 && (
              <button
                onClick={() => setShowHistory(prev => !prev)}
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-2 transition-colors"
              >
                {showHistory
                  ? 'Hide history'
                  : `Show history (${historyInvitations.length})`}
              </button>
            )}
```

- [ ] **Step 3: Handle empty active state (all accepted/cancelled)**

Change the condition on line 247 from:
```typescript
        ) : invitations.length > 0 ? (
```
to:
```typescript
        ) : invitations.length > 0 || activeInvitations.length === 0 ? (
```

Wait — actually the empty state should only show when `invitations.length === 0`. The current condition is correct. But when all invitations are in history (e.g., all accepted), `visibleInvitations` would be empty while `invitations.length > 0`. We need to handle that:

Replace the top-level ternary (lines 247–300) — change the condition at line 247 from:
```typescript
        ) : invitations.length > 0 ? (
```
to:
```typescript
        ) : invitations.length > 0 ? (
```
(keep this the same — the outer block stays as-is since `historyInvitations` still renders the toggle when `visibleInvitations` is empty)

Then inside the map block, add a fallback when `visibleInvitations` is empty but `invitations` is not:
```typescript
            {visibleInvitations.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-2">
                All invitations are in history.
              </p>
            )}
```
Add this line immediately after the `visibleInvitations.map(...)` block.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npm run typecheck 2>&1 | grep -i "TeamInvitations"
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/components/TeamInvitations.tsx
git commit -m "feat: collapse accepted/cancelled invitations behind history toggle"
```

---

### Task 5: `TeamInvitations.tsx` — Pending invite confirmation

**Files:**
- Modify: `src/components/TeamInvitations.tsx`

- [ ] **Step 1: Add `pendingConflict` state**

Add after the `showHistory` state:
```typescript
  const [pendingConflict, setPendingConflict] = useState(false);
```

- [ ] **Step 2: Add conflict check to `sendInvitation`**

At the top of `sendInvitation` (after the email/role validation block, around line 122), add before `setSending(true)`:
```typescript
    const hasConflict = invitations.some(
      inv => inv.email.toLowerCase() === inviteForm.email.toLowerCase() && inv.status === 'pending'
    );
    if (hasConflict && !pendingConflict) {
      setPendingConflict(true);
      return;
    }
    setPendingConflict(false);
```

- [ ] **Step 3: Add confirmation UI inside the dialog**

In the `DialogContent` section, add a warning block immediately before the `<DialogFooter>` (around line 228):
```typescript
                {pendingConflict && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[13px]">
                    <Clock className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <p className="text-amber-800 dark:text-amber-200">
                      A pending invite for <strong>{inviteForm.email}</strong> already exists. Sending a new one will cancel the old link.
                    </p>
                  </div>
                )}
```

Change the Send button label to reflect the confirmation state (line 232):
```typescript
                  <Button onClick={sendInvitation} disabled={sending}>
                    {sending ? 'Sending...' : pendingConflict ? 'Yes, resend anyway' : 'Send Invitation'}
                  </Button>
```

Also reset `pendingConflict` when the dialog closes. Find the `onOpenChange` handler on the `Dialog` (line 180) and update it:
```typescript
              <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) setPendingConflict(false); }}>
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npm run typecheck 2>&1 | grep -i "TeamInvitations"
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/components/TeamInvitations.tsx
git commit -m "feat: warn before re-inviting email with existing pending invite"
```

---

### Task 6: `useCollaborators.ts` — Add `useResendCollaboratorInvitation`

**Files:**
- Modify: `src/hooks/useCollaborators.ts`
- Modify: `tests/unit/useCollaborators.test.ts`

- [ ] **Step 1: Write failing test**

In `tests/unit/useCollaborators.test.ts`, add this describe block at the end (after existing tests):

```typescript
describe('useResendCollaboratorInvitation', () => {
  it('calls send-team-invitation edge function with correct params', async () => {
    mockInvoke.mockResolvedValueOnce({ data: {}, error: null });

    const { result } = renderHook(() => useResendCollaboratorInvitation(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        restaurantId: 'rest-1',
        email: 'sam@example.com',
        role: 'collaborator_accountant' as Role,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockInvoke).toHaveBeenCalledWith('send-team-invitation', {
      body: { restaurantId: 'rest-1', email: 'sam@example.com', role: 'collaborator_accountant' },
    });
  });

  it('invalidates collaborator-invites query on success', async () => {
    mockInvoke.mockResolvedValueOnce({ data: {}, error: null });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useResendCollaboratorInvitation(), { wrapper });

    await act(async () => {
      result.current.mutate({ restaurantId: 'rest-1', email: 'sam@example.com', role: 'collaborator_accountant' as Role });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['collaborator-invites', 'rest-1'] });
  });
});
```

Also add `useResendCollaboratorInvitation` to the import from `@/hooks/useCollaborators`.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- tests/unit/useCollaborators.test.ts 2>&1 | tail -20
```
Expected: FAIL — `useResendCollaboratorInvitation` not exported

- [ ] **Step 3: Add `useResendCollaboratorInvitation` to `useCollaborators.ts`**

Add this export at the end of `src/hooks/useCollaborators.ts` (after the existing `useRemoveCollaborator`):

```typescript
/**
 * Resends an expired invitation to a collaborator
 */
export const useResendCollaboratorInvitation = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ restaurantId, email, role }: SendInvitationParams) => {
      const { error } = await supabase.functions.invoke('send-team-invitation', {
        body: { restaurantId, email, role },
      });
      if (error) throw error;
      return { email, role, restaurantId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['collaborator-invites', data.restaurantId] });
      toast({
        title: 'Invitation resent',
        description: `New invite sent to ${data.email}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error resending invitation',
        description: error.message || 'Failed to resend invitation',
        variant: 'destructive',
      });
    },
  });
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test -- tests/unit/useCollaborators.test.ts
```
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useCollaborators.ts tests/unit/useCollaborators.test.ts
git commit -m "feat: add useResendCollaboratorInvitation hook"
```

---

### Task 7: `CollaboratorInvitations.tsx` — Expired invites, resend, history collapse

**Files:**
- Modify: `src/components/CollaboratorInvitations.tsx`

- [ ] **Step 1: Import the new hook and add local state**

1. Add `useResendCollaboratorInvitation` to the import from `@/hooks/useCollaborators` (line 17):
```typescript
import {
  useCollaboratorsQuery,
  useCollaboratorInvitesQuery,
  useSendCollaboratorInvitation,
  useCancelCollaboratorInvitation,
  useRemoveCollaborator,
  useResendCollaboratorInvitation,
} from '@/hooks/useCollaborators';
```

2. Add `RefreshCw` to the lucide import (line 9):
```typescript
import { Calculator, Package, ChefHat, Clock, CheckCircle, XCircle, Trash2, Check, ArrowLeft, UserPlus, Users, AlertCircle, RefreshCw } from 'lucide-react';
```

3. Add state and hook after `removeCollaboratorMutation` (after line 44):
```typescript
  const resendInvitationMutation = useResendCollaboratorInvitation();
  const [showCancelledInvites, setShowCancelledInvites] = useState(false);
```

4. Add handler after `handleRemoveCollaborator`:
```typescript
  const handleResendInvitation = (invite: { email: string; role: string }) => {
    resendInvitationMutation.mutate({
      restaurantId,
      email: invite.email,
      role: invite.role as Role,
    });
  };
```

- [ ] **Step 2: Update the Pending Invitations section**

Replace the entire `{/* Pending Invitations */}` `Card` block (lines 314–394) with:

```tsx
      {/* Pending & Expired Invitations */}
      {(invitesLoading || invitesError || pendingInvites?.some(i => i.status === 'pending' || i.status === 'expired')) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Pending Invitations</CardTitle>
            <CardDescription>
              Collaborator invitations waiting to be accepted
            </CardDescription>
          </CardHeader>
          <CardContent>
            {invitesLoading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-8 w-8 rounded-lg" />
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                    </div>
                    <Skeleton className="h-6 w-20" />
                  </div>
                ))}
              </div>
            ) : invitesError ? (
              <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 text-destructive">
                <AlertCircle className="h-5 w-5 flex-shrink-0" />
                <p className="text-sm">Failed to load invitations</p>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingInvites
                  ?.filter(invite => invite.status === 'pending' || invite.status === 'expired')
                  .map((invite) => {
                    const Icon = roleIcons[invite.role] || Calculator;
                    const isExpired = invite.status === 'expired';

                    return (
                      <div
                        key={invite.id}
                        className="flex items-center justify-between p-3 border rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-muted">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">{invite.email}</p>
                            <p className="text-xs text-muted-foreground">
                              {isExpired
                                ? `Expired — invite ${invite.invitedBy ? `by ${invite.invitedBy}` : ''} no longer valid`
                                : `Invited by ${invite.invitedBy} • Expires ${invite.expiresAt ? new Date(invite.expiresAt).toLocaleDateString() : 'never'}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={statusColors[invite.status]}>
                            {statusIcons[invite.status]}
                            <span className="ml-1 capitalize">{invite.status}</span>
                          </Badge>
                          {canManage && invite.status === 'pending' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleCancelInvitation(invite.id, invite.email)}
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              aria-label={`Cancel invitation for ${invite.email}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                          {canManage && invite.status === 'expired' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleResendInvitation(invite)}
                              disabled={resendInvitationMutation.isPending}
                              className="text-primary hover:text-primary hover:bg-primary/10"
                              aria-label={`Resend invitation to ${invite.email}`}
                            >
                              <RefreshCw className={`h-4 w-4 ${resendInvitationMutation.isPending ? 'animate-spin' : ''}`} />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                {/* Cancelled history toggle */}
                {(() => {
                  const cancelled = pendingInvites?.filter(i => i.status === 'cancelled') ?? [];
                  if (cancelled.length === 0) return null;
                  return (
                    <>
                      <button
                        onClick={() => setShowCancelledInvites(prev => !prev)}
                        className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-1 transition-colors"
                      >
                        {showCancelledInvites ? 'Hide cancelled' : `Show cancelled (${cancelled.length})`}
                      </button>
                      {showCancelledInvites && cancelled.map((invite) => {
                        const Icon = roleIcons[invite.role] || Calculator;
                        return (
                          <div key={invite.id} className="flex items-center justify-between p-3 border rounded-lg opacity-50">
                            <div className="flex items-center gap-3">
                              <div className="p-2 rounded-lg bg-muted">
                                <Icon className="h-4 w-4" />
                              </div>
                              <div>
                                <p className="font-medium text-sm">{invite.email}</p>
                                <p className="text-xs text-muted-foreground">Cancelled</p>
                              </div>
                            </div>
                            <Badge variant="outline">
                              <span className="capitalize">{invite.status}</span>
                            </Badge>
                          </div>
                        );
                      })}
                    </>
                  );
                })()}
              </div>
            )}
          </CardContent>
        </Card>
      )}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run typecheck 2>&1 | grep -i "CollaboratorInvitations"
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/components/CollaboratorInvitations.tsx
git commit -m "feat: show expired collaborator invites with resend button and history toggle"
```

---

### Task 8: Full verification

- [ ] **Step 1: Run all unit tests**

```bash
npm run test
```
Expected: all tests pass

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 3: Run lint**

```bash
npm run lint
```
Expected: no errors

- [ ] **Step 4: Run build**

```bash
npm run build
```
Expected: build succeeds with no errors
