// src/app/projects/[id]/change/layout.tsx
import ChangeManagementBoard from "@/components/change/ChangeManagementBoard";

export default function ChangeLayout({ children }: { children: React.ReactNode }) {
  return (
    <ChangeManagementBoard>
      {children}
    </ChangeManagementBoard>
  );
}