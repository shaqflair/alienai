// src/app/projects/[id]/raid/layout.tsx
import "./raid.css";

export default function RaidLayout({ children }: { children: React.ReactNode }) {
  // Force light at DOM attribute level (beats most theme systems)
  return (
    <div className="raidRouteLight" data-theme="light" data-mode="light" suppressHydrationWarning>
      {children}
    </div>
  );
}
