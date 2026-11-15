import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { LiveRefresh } from "./live-refresh";

describe("LiveRefresh — keeps an open page current during a live week", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refresh.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("re-requests the page's server data on the interval while visible", () => {
    const { unmount } = render(<LiveRefresh intervalMs={1000} />);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(refresh).toHaveBeenCalledTimes(3);
    unmount();
    vi.advanceTimersByTime(3000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("does nothing while the tab is hidden", () => {
    const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    render(<LiveRefresh intervalMs={1000} />);
    vi.advanceTimersByTime(5000);
    expect(refresh).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
