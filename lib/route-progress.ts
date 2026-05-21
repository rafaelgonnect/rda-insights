// ─── Route Progress Pub/Sub ───────────────────────────────────────────────────
// Tiny module-level singleton. No external deps.
// Usage: import { startProgress, doneProgress, subscribeProgress } from "@/lib/route-progress"

type Listener = (active: boolean) => void;
const listeners = new Set<Listener>();

let _active = false;
let _doneTimer: ReturnType<typeof setTimeout> | null = null;

export function startProgress() {
  if (_doneTimer) {
    clearTimeout(_doneTimer);
    _doneTimer = null;
  }
  _active = true;
  listeners.forEach((l) => l(true));
}

export function doneProgress() {
  _active = false;
  listeners.forEach((l) => l(false));
}

export function getActive() {
  return _active;
}

export function subscribeProgress(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
