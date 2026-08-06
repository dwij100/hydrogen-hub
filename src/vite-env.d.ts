/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the external optimization solver API (no trailing slash). */
  readonly VITE_SOLVER_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
