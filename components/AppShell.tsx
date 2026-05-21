import { ReactNode } from "react";
import Link from "next/link";
import { NavLink } from "@/components/NavLink";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col h-screen">
      <header className="border-b px-4 py-3 flex items-center justify-between">
        <NavLink href="/" className="font-semibold">
          RDA Insights
        </NavLink>
        <div className="flex items-center gap-4">
          <Link
            href="/settings"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ⚙ Configurações
          </Link>
          <span className="text-sm text-muted-foreground">AI · Apache Superset</span>
        </div>
      </header>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
