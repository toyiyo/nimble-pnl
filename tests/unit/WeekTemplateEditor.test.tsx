import { describe, it, expect, vi } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';

import { WeekTemplateEditor } from '@/components/scheduling/WeekTemplates/WeekTemplateEditor';
import { addShifts, emptyDraft } from '@/lib/weekTemplateDraft';

import type { Employee, TemplateDraft } from '@/types/scheduling';

const emp = (id: string, name: string, position: string): Employee =>
  ({ id, restaurant_id: 'r', name, position, status: 'active', is_active: true, created_at: '', updated_at: '' }) as Employee;

const EMPLOYEES = [emp('alice', 'Alice Moreno', 'Server'), emp('bob', 'Ben Ortiz', 'Cook')];

type EditorProps = React.ComponentProps<typeof WeekTemplateEditor>;

function Harness({ initial, overrides = {} }: { initial: TemplateDraft; overrides?: Partial<EditorProps> }) {
  const [draft, setDraft] = useState(initial);
  return (
    <WeekTemplateEditor
      draft={draft}
      onDraftChange={setDraft}
      employees={EMPLOYEES}
      employeesLoading={false}
      employeesError={false}
      onRetryEmployees={vi.fn()}
      isDirty
      isSaving={false}
      changedElsewhere={false}
      onSave={vi.fn()}
      onDiscard={vi.fn()}
      onApply={vi.fn()}
      onDuplicate={vi.fn()}
      onDelete={vi.fn()}
      {...overrides}
    />
  );
}

describe('WeekTemplateEditor', () => {
  it('adds an employee row, then adds a shift on two days through the dialog', () => {
    render(<Harness initial={emptyDraft()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add employee' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Alice Moreno to template' }));
    const row = screen.getByRole('row', { name: /Alice Moreno/ });
    expect(row).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add shift for Alice Moreno on Monday' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tuesday' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add shift' }));

    expect(screen.getAllByRole('button', { name: /^Edit shift: Alice Moreno/ })).toHaveLength(2);
    expect(within(screen.getByRole('row', { name: /Alice Moreno/ })).getByText('15h')).toBeInTheDocument();
  });

  it('returns focus to the add button when the shift dialog closes with Escape (QA bug WT-QA-1)', async () => {
    const draft = addShifts(emptyDraft(), 'alice', 'Alice Moreno', {
      start_time: '09:00', end_time: '17:00', break_duration: 0, position: 'Server', notes: null,
    }, [0]);
    render(<Harness initial={draft} />);
    const add = screen.getByRole('button', { name: 'Add shift for Alice Moreno on Tuesday' });
    add.focus();
    fireEvent.click(add);
    const dialog = screen.getByRole('dialog', { name: 'Add shift' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(add).toHaveFocus());
  });

  it('edits a shift from its chip', () => {
    const draft = addShifts(emptyDraft(), 'alice', 'Alice Moreno', {
      start_time: '09:00', end_time: '17:00', break_duration: 0, position: 'Server', notes: null,
    }, [0]);
    render(<Harness initial={draft} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit shift: Alice Moreno, Monday, 9a to 5p' }));
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '18:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save shift' }));

    expect(screen.getByRole('button', { name: 'Edit shift: Alice Moreno, Monday, 9a to 6p' })).toBeInTheDocument();
  });

  it('asks before it removes a row that has shifts', () => {
    const draft = addShifts(emptyDraft(), 'alice', 'Alice Moreno', {
      start_time: '09:00', end_time: '17:00', break_duration: 0, position: 'Server', notes: null,
    }, [0]);
    render(<Harness initial={draft} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Alice Moreno from template' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByRole('row', { name: /Alice Moreno/ })).not.toBeInTheDocument();
  });

  it('marks an employee who is not in the active list as inactive', () => {
    const draft = addShifts(emptyDraft(), 'gone', 'Ellis Grant', {
      start_time: '09:00', end_time: '17:00', break_duration: 0, position: 'Dish', notes: null,
    }, [5]);
    render(<Harness initial={draft} />);
    const row = screen.getByRole('row', { name: /Ellis Grant/ });
    expect(within(row).getByText('Inactive')).toBeInTheDocument();
  });

  it('disables Save with zero shifts and shows a hint', () => {
    render(<Harness initial={emptyDraft()} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByText('Add at least one shift')).toBeInTheDocument();
  });

  it('disables Apply while there are unsaved changes', () => {
    const draft = { ...addShifts(emptyDraft(), 'alice', 'Alice Moreno', {
      start_time: '09:00', end_time: '17:00', break_duration: 0, position: 'Server', notes: null,
    }, [0]), id: 't-1', updatedAt: 'x' };
    render(<Harness initial={draft} />);
    expect(screen.getByRole('button', { name: 'Apply to week' })).toBeDisabled();
    expect(screen.getByText('Save changes before you apply')).toBeInTheDocument();
  });

  it('calls onSave with the trimmed name', () => {
    const onSave = vi.fn();
    const draft = addShifts(emptyDraft(), 'alice', 'Alice Moreno', {
      start_time: '09:00', end_time: '17:00', break_duration: 0, position: 'Server', notes: null,
    }, [0]);
    render(<Harness initial={draft} overrides={{ onSave }} />);
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: '  Lunch  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalled();
  });

  it('shows the changed-elsewhere notice', () => {
    render(<Harness initial={emptyDraft()} overrides={{ changedElsewhere: true }} />);
    expect(screen.getByText(/This template changed in another session/)).toBeInTheDocument();
  });

  it('keeps the HOURS column clear of right-edge overlays', () => {
    const draft = addShifts(emptyDraft(), 'alice', 'Alice Moreno', {
      start_time: '09:00', end_time: '17:00', break_duration: 0, position: 'Server', notes: null,
    }, [0]);
    render(<Harness initial={draft} />);

    expect(screen.getByRole('columnheader', { name: 'Hours' })).toHaveClass('pr-12');
    expect(within(screen.getByRole('row', { name: /Alice Moreno/ })).getByText('8h')).toHaveClass('pr-12');
    expect(within(screen.getByRole('row', { name: 'Total' })).getByText('8h')).toHaveClass('pr-12');
  });
});
