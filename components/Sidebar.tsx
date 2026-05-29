"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Plus,
  MessageSquare,
  LayoutDashboard,
  Settings,
  Trash2,
  Pencil,
  Check,
  X,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useChatSessions } from "@/lib/use-chat-sessions";
import { deleteSession, renameSession } from "@/lib/chat-sessions";

type Dashboard = { id: number; dashboard_title: string };

const COLLAPSE_KEY = "sidebar:collapsed";
const COLLAPSE_EVT = "rda-sidebar-collapse";

function subscribeCollapse(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(COLLAPSE_EVT, cb);
  return () => window.removeEventListener(COLLAPSE_EVT, cb);
}

function getCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

export function Sidebar() {
  const pathname = usePathname();
  const sessions = useChatSessions();
  const collapsed = useSyncExternalStore(subscribeCollapse, getCollapsed, () => false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);

  // Fetch dashboards client-side so the shell never blocks on Superset latency.
  useEffect(() => {
    let alive = true;
    fetch("/api/dashboards")
      .then((r) => (r.ok ? r.json() : []))
      .then((d: Dashboard[]) => {
        if (alive) setDashboards(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  function toggleCollapsed() {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "0" : "1");
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event(COLLAPSE_EVT));
  }

  function startRename(id: string, current: string) {
    setEditingId(id);
    setEditTitle(current);
  }

  function commitRename() {
    if (editingId && editTitle.trim()) renameSession(editingId, editTitle.trim());
    setEditingId(null);
  }

  function handleDelete(id: string) {
    if (window.confirm("Excluir esta conversa?")) deleteSession(id);
  }

  // Collapsed: thin rail with just the reopen + new-chat buttons.
  if (collapsed) {
    return (
      <aside className="w-12 border-r flex flex-col items-center py-3 gap-2 shrink-0 bg-sidebar text-sidebar-foreground">
        <button
          onClick={toggleCollapsed}
          title="Expandir"
          className="size-9 inline-flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
        >
          <PanelLeft className="size-4" />
        </button>
        <NavLink
          href="/"
          title="Novo chat"
          className="size-9 inline-flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
        >
          <Plus className="size-4" />
        </NavLink>
        <div className="mt-auto">
          <ThemeToggle collapsed />
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-64 border-r flex flex-col h-full shrink-0 bg-sidebar text-sidebar-foreground">
      {/* Brand + collapse */}
      <div className="px-3 py-3 flex items-center justify-between shrink-0">
        <NavLink href="/" className="font-semibold text-sm">
          RDA Insights
        </NavLink>
        <button
          onClick={toggleCollapsed}
          title="Recolher"
          className="size-7 inline-flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
        >
          <PanelLeftClose className="size-4" />
        </button>
      </div>

      {/* New chat */}
      <div className="px-3 pb-2 shrink-0">
        <NavLink
          href="/"
          className="flex items-center gap-2 h-9 px-3 rounded-md border bg-background hover:bg-accent text-sm font-medium transition-colors"
        >
          <Plus className="size-4" /> Novo chat
        </NavLink>
      </div>

      {/* Scrollable lists */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 flex flex-col gap-4">
        {/* Chats */}
        <div>
          <p className="px-2 mb-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Chats
          </p>
          {sessions.length === 0 ? (
            <p className="px-2 text-xs text-muted-foreground/70">Nenhuma conversa ainda.</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {sessions.map((s) => {
                const active = pathname === `/c/${s.id}`;
                const isEditing = editingId === s.id;
                return (
                  <li key={s.id} className="group relative">
                    {isEditing ? (
                      <div className="flex items-center gap-1 px-2 py-1">
                        <input
                          autoFocus
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename();
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="flex-1 min-w-0 h-7 rounded border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        <button onClick={commitRename} title="Salvar" className="text-green-600 hover:text-green-700">
                          <Check className="size-3.5" />
                        </button>
                        <button onClick={() => setEditingId(null)} title="Cancelar" className="text-muted-foreground hover:text-foreground">
                          <X className="size-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div
                        className={[
                          "flex items-center rounded-md text-sm transition-colors",
                          active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                        ].join(" ")}
                      >
                        <NavLink
                          href={`/c/${s.id}`}
                          className="flex items-center gap-2 flex-1 min-w-0 px-2 py-1.5"
                          title={s.title}
                        >
                          <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{s.title}</span>
                        </NavLink>
                        <div className="hidden group-hover:flex items-center gap-0.5 pr-1.5">
                          <button
                            onClick={() => startRename(s.id, s.title)}
                            title="Renomear"
                            className="size-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-background"
                          >
                            <Pencil className="size-3" />
                          </button>
                          <button
                            onClick={() => handleDelete(s.id)}
                            title="Excluir"
                            className="size-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-background"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Dashboards */}
        <div>
          <p className="px-2 mb-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Painéis
          </p>
          <ul className="flex flex-col gap-0.5">
            {dashboards.map((d) => {
              const active = pathname === `/d/${d.id}`;
              return (
                <li key={d.id}>
                  <NavLink
                    href={`/d/${d.id}`}
                    title={d.dashboard_title}
                    className={[
                      "flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
                      active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                    ].join(" ")}
                  >
                    <LayoutDashboard className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{d.dashboard_title}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t p-2 shrink-0 flex flex-col gap-0.5">
        <ThemeToggle />
        <Link
          href="/settings"
          className="inline-flex items-center gap-2 h-8 px-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <Settings className="size-4 shrink-0" /> Configurações
        </Link>
      </div>
    </aside>
  );
}
