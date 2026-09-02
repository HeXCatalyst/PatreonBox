import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { debounce } from "./debounce";

// debounce powers the post-list search input: without it every keystroke fires
// a full getPosts() query (and the ~20MB/keystroke payload the perf audit
// flagged as P0-2). These tests pin the trailing-edge contract that makes that
// safe — no call until input settles, latest args win, cancel is reliable.

describe("debounce", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not call the function synchronously", () => {
    const fn = vi.fn();
    const d = debounce(fn, 200);
    d();
    expect(fn).not.toHaveBeenCalled();
  });

  it("calls the function once after the delay elapses", () => {
    const fn = vi.fn();
    const d = debounce(fn, 200);
    d();
    vi.advanceTimersByTime(199);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("resets the wait on each call so only the trailing edge fires", () => {
    const fn = vi.fn();
    const d = debounce(fn, 200);
    d(); // t=0
    vi.advanceTimersByTime(150);
    d(); // t=150 — restarts the clock
    vi.advanceTimersByTime(150); // t=300: 150ms since last call, not yet 200
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50); // t=350: 200ms since last call
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("forwards the latest arguments, not the first", () => {
    const fn = vi.fn();
    const d = debounce(fn, 200);
    d("a");
    d("b");
    d("c");
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("c");
  });

  it("cancel() prevents a pending call from ever firing", () => {
    const fn = vi.fn();
    const d = debounce(fn, 200);
    d();
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it("can be called again after cancel()", () => {
    const fn = vi.fn();
    const d = debounce(fn, 200);
    d();
    d.cancel();
    d("after");
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("after");
  });
});
