import { ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";

// Persistent app frame: left sidebar + main content area. Rendered once in the
// root layout so it survives client-side navigation (the sidebar fetches its
// own data and never blocks page transitions).
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-hidden min-w-0">{children}</main>
    </div>
  );
}
