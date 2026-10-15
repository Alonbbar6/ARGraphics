import { expect, it } from "vitest";
import { isReloadCancellation, selectedEngines } from "./browser-smoke/engines";

it("keeps Chromium as default and preserves explicitly selected engine order", () => {
  expect(selectedEngines(undefined)).toEqual(["chromium"]);
  expect(selectedEngines("webkit, firefox,chromium")).toEqual(["webkit", "firefox", "chromium"]);
  expect(selectedEngines("firefox")).toEqual(["firefox"]);
});

it.each(["", "all", "safari", "chromium,", "chromium,chromium", "firefox,unknown"])(
  "rejects invalid engine selection %j rather than silently omitting coverage", (value) => {
    expect(() => selectedEngines(value)).toThrow("BROWSER_SMOKE_BROWSERS");
  },
);

it.each(["net::ERR_ABORTED", "NS_BINDING_ABORTED", "Load request cancelled"])(
  "allows GET or successful PUT body cancellation %s, never failed uploads or preflights", (error) => {
    expect(isReloadCancellation("GET", error)).toBe(true);
    expect(isReloadCancellation("PUT", error)).toBe(false);
    expect(isReloadCancellation("PUT", error, 200)).toBe(true);
    expect(isReloadCancellation("PUT", error, 403)).toBe(false);
    expect(isReloadCancellation("OPTIONS", error)).toBe(false);
  },
);

it.each(["net::ERR_FAILED", "NS_ERROR_FAILURE", "Blocked by CORS", undefined, null])(
  "does not suppress a real network failure %j", (error) => {
    expect(isReloadCancellation("GET", error)).toBe(false);
    expect(isReloadCancellation("PUT", error, 200)).toBe(false);
  },
);
