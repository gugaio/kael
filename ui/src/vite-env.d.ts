/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_EMAIL_DUPLICATE_ALERT_THRESHOLD?: string;
  readonly VITE_EMAIL_INFLIGHT_ALERT_THRESHOLD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
