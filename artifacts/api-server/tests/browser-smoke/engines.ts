export const browserEngines = ["chromium", "firefox", "webkit"] as const;
export type SmokeEngine = typeof browserEngines[number];

/** Chromium stays the default; multi-engine coverage is explicitly requested. */
export function selectedEngines(value: string | undefined): SmokeEngine[] {
  if (value === undefined) return ["chromium"];
  const names = value.split(",").map((name) => name.trim());
  if (names.some((name) => !browserEngines.includes(name as SmokeEngine))
    || new Set(names).size !== names.length) {
    throw new Error("BROWSER_SMOKE_BROWSERS must be a nonempty, comma-separated selection of chromium, firefox, webkit without duplicates.");
  }
  return names as SmokeEngine[];
}

/** PUT response bodies can be cancelled after success; stored bytes are checked separately. */
export function isReloadCancellation(
  method: string, error: string | null | undefined, responseStatus?: number,
): boolean {
  return (method === "GET" || (method === "PUT" && responseStatus === 200)) && [
    "net::ERR_ABORTED", "NS_BINDING_ABORTED", "Load request cancelled",
  ].includes(error ?? "");
}
