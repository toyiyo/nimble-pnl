import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { Employee, SchedulePlanTemplate } from '@/types/scheduling';

const hook = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
}));

vi.mock('@/hooks/useSchedulePlanTemplates', () => ({
  MAX_SCHEDULE_PLAN_TEMPLATES: 20,
  useSchedulePlanTemplates: () => hook.state,
}));

vi.mock('@/hooks/useEmployees', () => ({
  useEmployees: () => ({
    employees: [
      { id: 'alice', name: 'Alice Moreno', position: 'Server', is_active: true } as Employee,
    ],
    loading: false,
    error: null,
  }),
}));

import { WeekTemplatesTab } from '@/components/scheduling/WeekTemplates/WeekTemplatesTab';

const tmpl = (id: string, name: string, updated_at = '2026-10-01T10:00:00.123456+00:00'): SchedulePlanTemplate => ({
  id,
  restaurant_id: 'r1',
  name,
  shifts: [
    {
      day_offset: 0,
      start_time: '09:00:00',
      end_time: '17:00:00',
      break_duration: 30,
      position: 'Server',
      employee_id: 'alice',
      employee_name: 'Alice Moreno',
      notes: null,
    },
  ],
  shift_count: 1,
  created_at: updated_at,
  updated_at,
});

const mutation = (impl?: (...args: unknown[]) => unknown) => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn(impl ?? (() => Promise.resolve({}))),
  isPending: false,
});

function setHook(templates: SchedulePlanTemplate[], overrides: Record<string, unknown> = {}) {
  hook.state = {
    templates,
    isLoading: false,
    error: null,
    // The RPCs return the full row.
    createTemplate: mutation((v) => {
      const { name, shifts } = v as Pick<SchedulePlanTemplate, 'name' | 'shifts'>;
      return Promise.resolve({ ...tmpl('new-1', name, '2026-10-06T10:00:00.5+00:00'), shifts, shift_count: shifts.length });
    }),
    updateTemplate: mutation((v) => {
      const { id, name, shifts } = v as Pick<SchedulePlanTemplate, 'id' | 'name' | 'shifts'>;
      return Promise.resolve({ ...tmpl(id, name, '2026-10-06T11:00:00.654321+00:00'), shifts, shift_count: shifts.length });
    }),
    applyTemplate: mutation(),
    deleteTemplate: mutation(),
    ...overrides,
  };
}

function renderTab(onDirtyChange = vi.fn()) {
  const qc = new QueryClient();
  const utils = render(
    <QueryClientProvider client={qc}>
      <WeekTemplatesTab restaurantId="r1" timezone="UTC" onDirtyChange={onDirtyChange} onViewWeek={vi.fn()} />
    </QueryClientProvider>,
  );
  return { ...utils, qc, onDirtyChange };
}

describe('WeekTemplatesTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the empty state when there are no templates', () => {
    setHook([]);
    renderTab();
    expect(screen.getByText('Create your first week template')).toBeInTheDocument();
  });

  it('opens the first template in the editor', () => {
    setHook([tmpl('t1', 'Lunch'), tmpl('t2', 'Dinner')]);
    renderTab();
    expect(screen.getByLabelText('Template name')).toHaveValue('Lunch');
    expect(screen.getByRole('button', { name: /Lunch/, current: true })).toBeInTheDocument();
  });

  it('reports dirty state and asks before it switches templates', () => {
    setHook([tmpl('t1', 'Lunch'), tmpl('t2', 'Dinner')]);
    const { onDirtyChange } = renderTab();

    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Lunch v2' } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByRole('button', { name: /Dinner/ }));
    expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Template name')).toHaveValue('Lunch v2');

    fireEvent.click(screen.getByRole('button', { name: /Dinner/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByLabelText('Template name')).toHaveValue('Dinner');
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('saves an existing template with the raw updated_at, then is clean', async () => {
    setHook([tmpl('t1', 'Lunch')]);
    const { onDirtyChange } = renderTab();

    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Lunch v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const update = (hook.state.updateTemplate as ReturnType<typeof mutation>).mutateAsync;
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0]).toMatchObject({
      id: 't1',
      name: 'Lunch v2',
      expectedUpdatedAt: '2026-10-01T10:00:00.123456+00:00',
    });
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it('does not revert the draft when the list still holds the older copy after a save', async () => {
    setHook([tmpl('t1', 'Lunch')]);
    renderTab();
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Lunch v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument());
    // The list still says "Lunch" with the old updated_at; the editor keeps the saved name.
    expect(screen.getByLabelText('Template name')).toHaveValue('Lunch v2');
  });

  it('keeps edits made while a save runs', async () => {
    let resolveSave: (v: unknown) => void = () => {};
    setHook([tmpl('t1', 'Lunch')], {
      updateTemplate: mutation((v) => new Promise((resolve) => {
        const { id, name, shifts } = v as Pick<SchedulePlanTemplate, 'id' | 'name' | 'shifts'>;
        resolveSave = () => resolve({ ...tmpl(id, name, '2026-10-06T11:00:00+00:00'), shifts });
      })),
    });
    renderTab();
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Lunch v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Lunch v3' } });
    resolveSave(undefined);
    await waitFor(() => expect(screen.getByLabelText('Template name')).toHaveValue('Lunch v3'));
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('does not put a save result on another draft the user opened during the save', async () => {
    let resolveSave: () => void = () => {};
    setHook([tmpl('t1', 'Lunch'), tmpl('t2', 'Dinner')], {
      updateTemplate: mutation((v) => new Promise((resolve) => {
        const { id, name, shifts } = v as Pick<SchedulePlanTemplate, 'id' | 'name' | 'shifts'>;
        resolveSave = () => resolve({ ...tmpl(id, name, '2026-10-06T11:00:00+00:00'), shifts });
      })),
    });
    const { onDirtyChange } = renderTab();
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Lunch v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: /Dinner/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByLabelText('Template name')).toHaveValue('Dinner');

    resolveSave();
    await waitFor(() => expect(screen.getByRole('button', { name: /Dinner/, current: true })).toBeInTheDocument());
    expect(screen.getByLabelText('Template name')).toHaveValue('Dinner');
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('ignores a second Save click while the first save runs', async () => {
    setHook([tmpl('t1', 'Lunch')], {
      updateTemplate: mutation(() => new Promise(() => {})),
    });
    renderTab();
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Lunch v2' } });
    const save = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(save);
    fireEvent.click(save);
    const update = (hook.state.updateTemplate as ReturnType<typeof mutation>).mutateAsync;
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  });

  it('creates a new template from a blank draft', async () => {
    setHook([]);
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'New template' }));
    expect(screen.getByText('Not saved yet')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add employee' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Alice Moreno to template' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add shift for Alice Moreno on Monday' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add shift' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const create = (hook.state.createTemplate as ReturnType<typeof mutation>).mutateAsync;
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({
      name: 'Untitled template',
      shifts: [expect.objectContaining({ day_offset: 0, employee_id: 'alice', employee_name: 'Alice Moreno' })],
    });
  });

  it('shows the changed-elsewhere notice when the server copy is newer and the draft is dirty', () => {
    setHook([tmpl('t1', 'Lunch')]);
    const { rerender, qc } = renderTab();
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Mine' } });

    setHook([tmpl('t1', 'Theirs', '2026-10-02T10:00:00+00:00')]);
    rerender(
      <QueryClientProvider client={qc}>
        <WeekTemplatesTab restaurantId="r1" timezone="UTC" onDirtyChange={vi.fn()} onViewWeek={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/This template changed in another session/)).toBeInTheDocument();
    expect(screen.getByLabelText('Template name')).toHaveValue('Mine');
  });

  it('loads a newer server copy when the draft is clean', () => {
    setHook([tmpl('t1', 'Lunch')]);
    const { rerender, qc } = renderTab();

    setHook([tmpl('t1', 'Theirs', '2026-10-02T10:00:00+00:00')]);
    rerender(
      <QueryClientProvider client={qc}>
        <WeekTemplatesTab restaurantId="r1" timezone="UTC" onDirtyChange={vi.fn()} onViewWeek={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText('Template name')).toHaveValue('Theirs');
  });
});
