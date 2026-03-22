// src/components/employee/MobileLayout.tsx
import { ReactNode } from 'react';
import { MobileTabBar } from './MobileTabBar';

interface MobileLayoutProps {
  children: ReactNode;
}

export function MobileLayout({ children }: MobileLayoutProps) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 px-4 py-4 pb-20 max-w-full overflow-x-hidden" role="main">
        {children}
      </main>
      <MobileTabBar />
    </div>
  );
}
