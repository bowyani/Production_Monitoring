// Shared flags + helpers for the two non-production builds:
//   VITE_DEMO_MODE  - real backend, writes disabled (see backend DEMO_READ_ONLY)
//   VITE_MOCK       - no backend at all; lib/mock/* fakes every response and a
//                     synthetic live feed. Implies DEMO_MODE.
// Kept out of lib/api.ts so lib/mock/* can import these without a cycle.

export const MOCK = import.meta.env.VITE_MOCK === "true";
export const DEMO_MODE = MOCK || import.meta.env.VITE_DEMO_MODE === "true";

export const REPO_URL =
  import.meta.env.VITE_REPO_URL ?? "https://github.com/your-username/production-monitoring";

// Where the "run it yourself" instructions send people. On the static mock
// that's the main branch, which carries the full stack.
export const MAIN_BRANCH_URL = import.meta.env.VITE_MAIN_BRANCH_URL ?? REPO_URL;

export class DemoLockedError extends Error {
  constructor() {
    super("This is a demo — run it locally to change data.");
    this.name = "DemoLockedError";
  }
}

// Broadcast so <DemoLockModal> can pop up regardless of which component fired
// the request. Callers still get a rejected promise they can ignore.
export function notifyDemoLocked() {
  window.dispatchEvent(new CustomEvent("demo-locked"));
}

export function isDemoLocked(status: number, body: unknown): boolean {
  return status === 403 && !!body && (body as { error?: string }).error === "READ_ONLY_DEMO";
}
