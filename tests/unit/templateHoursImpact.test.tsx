import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { TemplateHoursImpact } from '@/components/scheduling/ShiftPlanner/TemplateHoursImpact';
import { buildHoursChangeLedger } from '@/lib/scheduling/hoursChangeCopy';

const drifted = [
  {
    shiftId: 's1',
    employeeName: 'Ada',
    localDate: 'Mon Aug 10',
    currentStart: '11:00',
    currentEnd: '19:00',
    isPublished: false,
    hoursDelta: 0,
  },
];

function renderPanel(overrides: { movingCount: number; selectedDriftCount: number }) {
  const ledger = buildHoursChangeLedger({
    oldStart: '10:00',
    oldEnd: '16:30',
    newStart: '11:00',
    newEnd: '17:30',
    publishedCount: 0,
    pastCount: 0,
    lockedCount: 0,
    driftedCount: 1,
    hoursDelta: 0,
    ...overrides,
  });
  return render(
    <TemplateHoursImpact
      ledger={ledger}
      drifted={drifted}
      selectedDriftIds={new Set()}
      onToggleDrift={() => {}}
      publishedCount={0}
      notify={false}
      onNotifyChange={() => {}}
      isLoading={false}
      error={null}
      oldStart="10:00"
      oldEnd="16:30"
      newStart="11:00"
      newEnd="17:30"
    />
  );
}

describe('TemplateHoursImpact drift disclosure default', () => {
  it('opens the drift disclosure when nothing else would move', async () => {
    const user = userEvent.setup();
    renderPanel({ movingCount: 0, selectedDriftCount: 0 });
    // The outer panel is collapsed by design; open it.
    await user.click(screen.getByRole('button', { name: /shifts? move/i }));
    expect(screen.getByRole('checkbox', { name: /Ada/ })).toBeInTheDocument();
  });

  it('leaves the drift disclosure closed when shifts already move', async () => {
    const user = userEvent.setup();
    renderPanel({ movingCount: 2, selectedDriftCount: 0 });
    await user.click(screen.getByRole('button', { name: /shifts? move/i }));
    expect(screen.queryByRole('checkbox', { name: /Ada/ })).not.toBeInTheDocument();
  });

  it('lets a manual toggle win over the default', async () => {
    const user = userEvent.setup();
    renderPanel({ movingCount: 0, selectedDriftCount: 0 });
    await user.click(screen.getByRole('button', { name: /shifts? move/i }));
    // The outer summary line also names the pickable shifts as "hand-edited"
    // (Task 3), so anchor to the drift disclosure's own trigger, which starts
    // with the count instead of the severity label.
    await user.click(screen.getByRole('button', { name: /^\d+ hand-edited/i }));
    expect(screen.queryByRole('checkbox', { name: /Ada/ })).not.toBeInTheDocument();
  });
});
