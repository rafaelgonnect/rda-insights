import { describe, it, expect, beforeEach, vi } from "vitest";

// We re-import each test using isolateModules so the module-level state is fresh
async function importFresh() {
  // Use dynamic import with a cache-busting trick via vi.resetModules
  vi.resetModules();
  return import("@/lib/route-progress");
}

describe("route-progress pub/sub", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("starts inactive", async () => {
    const { getActive } = await importFresh();
    expect(getActive()).toBe(false);
  });

  it("startProgress notifies subscribers with true", async () => {
    const { startProgress, subscribeProgress } = await importFresh();
    const received: boolean[] = [];
    subscribeProgress((v) => received.push(v));
    startProgress();
    expect(received).toEqual([true]);
  });

  it("doneProgress notifies subscribers with false", async () => {
    const { startProgress, doneProgress, subscribeProgress } = await importFresh();
    const received: boolean[] = [];
    subscribeProgress((v) => received.push(v));
    startProgress();
    doneProgress();
    expect(received).toEqual([true, false]);
  });

  it("unsubscribe stops further notifications", async () => {
    const { startProgress, subscribeProgress } = await importFresh();
    const received: boolean[] = [];
    const unsub = subscribeProgress((v) => received.push(v));
    unsub();
    startProgress();
    expect(received).toHaveLength(0);
  });

  it("getActive returns true after start, false after done", async () => {
    const { startProgress, doneProgress, getActive } = await importFresh();
    startProgress();
    expect(getActive()).toBe(true);
    doneProgress();
    expect(getActive()).toBe(false);
  });
});
