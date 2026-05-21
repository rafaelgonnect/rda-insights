"use client";
// ─── RouteProgress ────────────────────────────────────────────────────────────
// Thin top progress bar that fires on client-side navigations.
// Strategy: listen to the pub/sub from lib/route-progress.ts AND
// detect navigation completion via usePathname (changes when the new page mounts).

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { subscribeProgress, doneProgress, getActive } from "@/lib/route-progress";

export function RouteProgress() {
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);
  const rafRef = useRef<number | null>(null);
  const pathname = usePathname();
  const prevPathnameRef = useRef(pathname);

  // When pathname changes, the new page has mounted → navigation done
  useEffect(() => {
    if (pathname !== prevPathnameRef.current) {
      prevPathnameRef.current = pathname;
      if (getActive()) {
        doneProgress();
      }
    }
  }, [pathname]);

  // Subscribe to the pub/sub
  useEffect(() => {
    const unsub = subscribeProgress((active) => {
      if (active) {
        setWidth(0);
        setVisible(true);
        // Animate to 80% quickly then stall, waiting for done
        let pct = 0;
        function tick() {
          pct = pct < 40 ? pct + 4 : pct < 70 ? pct + 1.5 : pct < 85 ? pct + 0.4 : pct;
          setWidth(pct);
          if (pct < 85) {
            rafRef.current = requestAnimationFrame(tick);
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      } else {
        // Jump to 100%, then fade out
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        setWidth(100);
        const t = setTimeout(() => {
          setVisible(false);
          setWidth(0);
        }, 300);
        return () => clearTimeout(t);
      }
    });
    return () => {
      unsub();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      aria-hidden
      className="fixed top-0 left-0 z-[9999] h-0.5 bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.6)] transition-[width] duration-200 ease-out pointer-events-none"
      style={{ width: `${width}%` }}
    />
  );
}
