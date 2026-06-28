import { describe, it, expect } from 'vitest';
import { groupCoveringByArea } from '@/components/scheduling/ShiftPlanner/CoverageDetail';
import type { CoveringEmployee } from '@/types/scheduling';

const e = (over: Partial<CoveringEmployee>): CoveringEmployee => ({
  employeeId: 'x', employeeName: 'x', startMin: 0, endMin: 60, homeArea: null, workArea: null, ...over,
});

describe('groupCoveringByArea', () => {
  it('splits home-area vs covering-from when slotArea is set', () => {
    const list = [
      e({ employeeId: 'a', homeArea: 'Cold Stone' }),
      e({ employeeId: 'b', homeArea: "Wetzel's" }),
      e({ employeeId: 'c', homeArea: null }),
    ];
    const { onArea, coveringFrom } = groupCoveringByArea(list, 'Cold Stone');
    expect(onArea.map((x) => x.employeeId)).toEqual(['a', 'c']); // null homeArea counts as on-area
    expect([...coveringFrom.keys()]).toEqual(["Wetzel's"]);
    expect(coveringFrom.get("Wetzel's")?.map((x) => x.employeeId)).toEqual(['b']);
  });

  it('returns all under onArea with empty coveringFrom when slotArea is null', () => {
    const list = [e({ employeeId: 'a', homeArea: 'Cold Stone' })];
    const { onArea, coveringFrom } = groupCoveringByArea(list, null);
    expect(onArea).toHaveLength(1);
    expect(coveringFrom.size).toBe(0);
  });
});
