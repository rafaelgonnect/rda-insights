"use client";
// ─── NavLink ──────────────────────────────────────────────────────────────────
// Wrapper around next/link that starts the route progress bar when a
// navigation is pending (useLinkStatus) or when programmatic nav fires.
// Use this everywhere you want the top progress bar to react.
//
// For most cases in this app, we simply call startProgress() on click
// (which is fast and safe) and rely on the pathname-change detection in
// RouteProgress to call doneProgress().

import NextLink from "next/link";
import { useLinkStatus } from "next/link";
import { useEffect, type ComponentProps } from "react";
import { startProgress } from "@/lib/route-progress";

function PendingSensor() {
  const { pending } = useLinkStatus();
  useEffect(() => {
    if (pending) startProgress();
  }, [pending]);
  return null;
}

export function NavLink({ children, ...props }: ComponentProps<typeof NextLink>) {
  return (
    <NextLink {...props}>
      <PendingSensor />
      {children}
    </NextLink>
  );
}
