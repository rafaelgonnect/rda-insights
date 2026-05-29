"use client";
import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

// The `dark` class on <html> is the source of truth (set pre-paint by the
// inline script in layout.tsx). We read it via useSyncExternalStore so there's
// no setState-in-effect and no hydration flash.

const THEME_EVT = "rda-theme-change";

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(THEME_EVT, cb);
  return () => window.removeEventListener(THEME_EVT, cb);
}

function isDark(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

export function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);

  function toggle() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event(THEME_EVT));
  }

  return (
    <button
      onClick={toggle}
      title={dark ? "Tema claro" : "Tema escuro"}
      className="inline-flex items-center gap-2 h-8 px-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors w-full"
    >
      {dark ? <Sun className="size-4 shrink-0" /> : <Moon className="size-4 shrink-0" />}
      {!collapsed && <span>{dark ? "Tema claro" : "Tema escuro"}</span>}
    </button>
  );
}
