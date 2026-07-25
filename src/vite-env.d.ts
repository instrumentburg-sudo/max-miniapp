/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** База Convex HTTP Actions для ручек клиентского кабинета (/api/max/*) */
  readonly VITE_CONVEX_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
