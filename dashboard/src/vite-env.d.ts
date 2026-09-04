/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_WS_URL: string;
  // "true" turns the dashboard into a read-only public demo: every write is
  // intercepted client-side and shown as a "run it locally" dialog instead of
  // hitting the backend. Pairs with DEMO_READ_ONLY=true on the backend.
  readonly VITE_DEMO_MODE?: string;
  // Repo link shown in that dialog. Falls back to the backend-provided one.
  readonly VITE_REPO_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
