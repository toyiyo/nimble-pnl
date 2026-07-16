import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SOURCE = readFileSync(
  resolve(__dirname, '../../src/pages/POSSales.tsx'),
  'utf8',
);

describe('POSSales — sourceFilter wiring', () => {
  it('tracks sourceFilter state and passes it into both sales queries', () => {
    expect(SOURCE).toMatch(/const \[sourceFilter, setSourceFilter\] = useState<POSSystemType \| 'all'>\('all'\);/);
    expect(SOURCE).toMatch(/useUnifiedSales\(selectedRestaurant\?\.restaurant_id \|\| null,\s*\{[\s\S]*sourceFilter[\s\S]*\}\)/);
    expect(SOURCE).toMatch(/useUnifiedSalesTotals\(\s*selectedRestaurant\?\.restaurant_id \|\| null,\s*\{[\s\S]*sourceFilter[\s\S]*\}\s*\)/);
  });

  it('resets sourceFilter when filters are cleared', () => {
    expect(SOURCE).toContain("setSourceFilter('all');");
  });

  it('renders an accessible Source filter control', () => {
    expect(SOURCE).toContain('Filter sales by source');
    expect(SOURCE).toContain('All Sources');
    expect(SOURCE).toContain('Manual Upload');
  });
});
