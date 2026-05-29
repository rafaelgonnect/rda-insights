"use client";
import { useSyncExternalStore } from "react";
import { listSessions, subscribe, type ChatSessionMeta } from "@/lib/chat-sessions";

// Cache the snapshot so useSyncExternalStore sees a stable reference between
// renders (it bails out of re-render when the snapshot is referentially equal).
// We recompute only when the store notifies a change.
let cache: ChatSessionMeta[] = [];
let dirty = true;

function getSnapshot(): ChatSessionMeta[] {
  if (dirty) {
    cache = listSessions();
    dirty = false;
  }
  return cache;
}

function subscribeWrapped(cb: () => void): () => void {
  return subscribe(() => {
    dirty = true;
    cb();
  });
}

function getServerSnapshot(): ChatSessionMeta[] {
  return [];
}

/** Live list of chat sessions, sorted most-recently-updated first. */
export function useChatSessions(): ChatSessionMeta[] {
  return useSyncExternalStore(subscribeWrapped, getSnapshot, getServerSnapshot);
}
