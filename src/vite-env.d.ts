/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOVMAP_TOKEN?: string;
  // Add other env variables here as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

