import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';

describe('DialogContent primitive defaults', () => {
  it('applies max-h-[85vh] and overflow-y-auto safety net by default', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Test dialog</DialogTitle>
          <p>Content</p>
        </DialogContent>
      </Dialog>,
    );

    const content = screen.getByRole('dialog');
    expect(content.className).toContain('max-h-[85vh]');
    expect(content.className).toContain('overflow-y-auto');
  });

  it('lets an explicit max-h override the default', () => {
    render(
      <Dialog open>
        <DialogContent className="max-h-[60vh]">
          <DialogTitle>Test dialog</DialogTitle>
          <p>Content</p>
        </DialogContent>
      </Dialog>,
    );

    const content = screen.getByRole('dialog');
    expect(content.className).toContain('max-h-[60vh]');
    expect(content.className).not.toContain('max-h-[85vh]');
  });

  it('lets an explicit overflow rule override the default', () => {
    render(
      <Dialog open>
        <DialogContent className="overflow-hidden">
          <DialogTitle>Test dialog</DialogTitle>
          <p>Content</p>
        </DialogContent>
      </Dialog>,
    );

    const content = screen.getByRole('dialog');
    expect(content.className).toContain('overflow-hidden');
    expect(content.className).not.toContain('overflow-y-auto');
  });
});
