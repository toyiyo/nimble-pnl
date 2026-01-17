import React from 'react';
import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { GroupedUnitSelector } from '@/components/GroupedUnitSelector';

describe('GroupedUnitSelector', () => {
  beforeAll(() => {
    // JSDOM may not implement scrollIntoView used by Radix; mock it to avoid errors
    (HTMLElement.prototype as any).scrollIntoView = () => {};
  });

  it('shows conversion badges when productSizeUnit is provided and units are compatible', async () => {
    render(
      <GroupedUnitSelector
        value=""
        onValueChange={() => {}}
        placeholder="Select unit"
        productName="Vodka"
        productSizeUnit="ml"
      />
    );

    // Open the select by clicking the trigger
    fireEvent.click(screen.getByText(/Select unit/i));

    // The conversion badge text should appear for compatible units
    const badges = await screen.findAllByText(/conversion/);
    expect(badges.length).toBeGreaterThan(0);
  });
});
