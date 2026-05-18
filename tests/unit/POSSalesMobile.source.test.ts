import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SOURCE = readFileSync(
  resolve(__dirname, '../../src/pages/POSSales.tsx'),
  'utf8',
);

describe('POSSales — mobile responsive tokens stay in source', () => {
  it('header actions container is flex-wrap', () => {
    expect(SOURCE).toContain('flex flex-wrap items-center gap-2');
  });

  it('outer page wrapper + header row use sm: not md:', () => {
    expect(SOURCE).toContain('space-y-8 sm:space-y-10');
    expect(SOURCE).toContain('flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between');
    expect(SOURCE).not.toMatch(/space-y-8 md:space-y-10/);
    expect(SOURCE).not.toMatch(/flex flex-col gap-4 md:flex-row/);
  });

  it('h1 title size scales at sm: not md:', () => {
    expect(SOURCE).toContain('text-[2rem] sm:text-[2.5rem]');
    expect(SOURCE).not.toMatch(/text-\[2rem\] md:text-\[2\.5rem\]/);
  });

  it('Add Sale uses order-last sm:order-none for wrap behavior', () => {
    expect(SOURCE).toContain('order-last sm:order-none');
  });

  it('Sync/Rules/Import buttons have aria-label', () => {
    expect(SOURCE).toContain('aria-label="Sync sales"');
    expect(SOURCE).toContain('aria-label="Category rules"');
    expect(SOURCE).toContain('aria-label="Import sales"');
  });

  it('Clear filters button has aria-label', () => {
    expect(SOURCE).toContain('aria-label="Clear filters"');
  });

  it('AI Categorize button has two-span label swap', () => {
    expect(SOURCE).toContain('AI Categorize Sales');
    expect(SOURCE).toContain('>AI Categorize<');
  });

  it('date input wrappers flex on mobile, fixed at sm+', () => {
    expect(SOURCE).toContain('flex flex-1 sm:flex-none items-center gap-2');
    expect(SOURCE).toContain('relative flex-1 sm:flex-none');
  });

  it('date inputs are full-width on mobile, fixed 150px at sm+', () => {
    expect(SOURCE).toContain('h-9 w-full sm:w-[150px]');
  });

  it('filter row 1 uses sm: breakpoint (not md:)', () => {
    expect(SOURCE).toContain('flex flex-col sm:flex-row gap-3');
  });

  it('filter row 2 dividers use sm: not md:', () => {
    expect(SOURCE).not.toMatch(/h-5 w-px bg-border\/60 hidden md:block/);
    expect(SOURCE).toContain('h-5 w-px bg-border/60 hidden sm:block');
  });

  it('sort cluster full-width on mobile', () => {
    expect(SOURCE).toContain('w-full sm:w-auto sm:ml-auto');
  });

  it('virtualized list height uses dvh progressive enhancement', () => {
    expect(SOURCE).toContain('h-[calc(100vh-180px)]');
    expect(SOURCE).toContain('[height:calc(100dvh-180px)]');
    expect(SOURCE).toContain('min-h-[400px]');
    expect(SOURCE).toContain('sm:h-[600px]');
  });

  it('virtualizer keys use sale.id (not index)', () => {
    expect(SOURCE).not.toMatch(/key=\{virtualRow\.index\}/);
    const saleIdKeyMatches = SOURCE.match(/key=\{sale\.id\}/g) || [];
    expect(saleIdKeyMatches.length).toBeGreaterThanOrEqual(2);
  });

  it('grouped-view Check impact is mobile-visible and has type=button', () => {
    expect(SOURCE).toContain('opacity-100 sm:opacity-0 sm:group-hover:opacity-100');
    expect(SOURCE).toMatch(/type="button"[\s\S]*?onClick=\{\(\) => handleSimulateDeduction/);
  });

  it('AI Categorization card header stacks on mobile', () => {
    expect(SOURCE).toContain('flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between');
  });

  it('restaurant pill flex-wraps inside the heading', () => {
    expect(SOURCE).toContain('inline-flex flex-wrap items-center gap-1.5 px-2 sm:px-2.5');
  });
});
