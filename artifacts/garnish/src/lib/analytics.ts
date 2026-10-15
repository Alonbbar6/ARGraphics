type AnalyticsData = Record<string, string | number | boolean>;

declare global {
  interface Window {
    umami?: {
      track(name: string, data?: AnalyticsData): void | Promise<unknown>;
    };
  }
}

/**
 * Replit's publishing proxy injects Umami when Publishing analytics is enabled.
 * Do not add an app-owned script, website ID, or collector configuration.
 * See .local/skills/project-analytics/SKILL.md and artifacts/garnish/ANALYTICS.md.
 * Optional, fire-and-forget analytics must never affect a user action.
 */
export function trackEvent(name: string, data?: AnalyticsData): void {
  if (typeof window === 'undefined') return;
  try {
    void Promise.resolve(window.umami?.track(name, data)).catch(() => {});
  } catch {
    // Missing or broken analytics is not an application error.
  }
}
