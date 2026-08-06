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

const twoDrifted = [
  ...drifted,
  {
    shiftId: 's2',
    employeeName: 'Grace',
    localDate: 'Tue Aug 11',
    currentStart: '11:00',
    currentEnd: '19:00',
    isPublished: false,
    hoursDelta: 0,
  },
];

function renderPanel(
  overrides: { movingCount: number; selectedDriftCount: number; driftedCount?: number },
  options: { drifted?: typeof drifted; selectedDriftIds?: Set<string>; onToggleDrift?: (id: string) => void } = {}
) {
  const { driftedCount = 1, ...ledgerOverrides } = overrides;
  const ledger = buildHoursChangeLedger({
    oldStart: '10:00',
    oldEnd: '16:30',
    newStart: '11:00',
    newEnd: '17:30',
    publishedCount: 0,
    pastCount: 0,
    lockedCount: 0,
    driftedCount,
    hoursDelta: 0,
    ...ledgerOverrides,
  });
  return render(
    <TemplateHoursImpact
      ledger={ledger}
      drifted={options.drifted ?? drifted}
      selectedDriftIds={options.selectedDriftIds ?? new Set()}
      onToggleDrift={options.onToggleDrift ?? (() => {})}
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

  it('keeps the remaining checkboxes visible after picking the first of several drifted shifts', async () => {
    const user = userEvent.setup();
    const selectedDriftIds = new Set<string>();
    const onToggleDrift = (id: string) => selectedDriftIds.add(id);
    const { rerender } = renderPanel(
      { movingCount: 0, selectedDriftCount: 0, driftedCount: 2 },
      { drifted: twoDrifted, selectedDriftIds }
    );
    await user.click(screen.getByRole('button', { name: /shifts? move/i }));
    // Both drifted shifts are reachable via the default-open disclosure.
    expect(screen.getByRole('checkbox', { name: /Ada/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Grace/ })).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /Ada/ }));

    // Ticking Ada bumps `totalAffected` from 0 to 1 on the next render -- the
    // regression this test guards against collapsed the disclosure right here,
    // hiding Grace's still-unpicked checkbox.
    rerender(
      <TemplateHoursImpact
        ledger={buildHoursChangeLedger({
          oldStart: '10:00',
          oldEnd: '16:30',
          newStart: '11:00',
          newEnd: '17:30',
          publishedCount: 0,
          pastCount: 0,
          lockedCount: 0,
          driftedCount: 2,
          hoursDelta: 0,
          movingCount: 0,
          selectedDriftCount: 1,
        })}
        drifted={twoDrifted}
        selectedDriftIds={selectedDriftIds}
        onToggleDrift={onToggleDrift}
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

    expect(screen.getByRole('checkbox', { name: /Grace/ })).toBeInTheDocument();
  });
});
