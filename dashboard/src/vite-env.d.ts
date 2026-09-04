/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_WS_URL: string;
  // "true" turns the dashboard into a read-only public demo: every write is
  // intercepted client-side and shown as a "run it locally" dialog instead of
  // hitting the backend. Pairs with DEMO_READ_ONLY=true on the backend.
  readonly VITE_DEMO_MODE?: string;
  // "true" is the fully static build: no backend at all, lib/mock/* fakes every
  // response and a synthetic live feed. Implies VITE_DEMO_MODE.
  readonly VITE_MOCK?: string;
  // Repo link shown in the "run it locally" dialog.
  readonly VITE_REPO_URL?: string;
  // Branch/URL the dialog points people at for the full stack. Defaults to
  // VITE_REPO_URL (the repo's default branch).
  readonly VITE_MAIN_BRANCH_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
