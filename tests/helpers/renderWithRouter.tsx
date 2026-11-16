import { BrowserRouter } from 'react-router-dom';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';

type Options = Omit<RenderOptions, 'wrapper'> & { url?: string };

/**
 * Render with a BrowserRouter. Use it for components that read URL params.
 * The URL setter reads window.location, so the router must share it.
 * Each call sets the URL first (default '/'), so tests do not leak URL state.
 */
export function renderWithRouter(ui: ReactElement, { url = '/', ...options }: Options = {}) {
  window.history.replaceState({}, '', url);
  return render(ui, { ...options, wrapper: BrowserRouter });
}
