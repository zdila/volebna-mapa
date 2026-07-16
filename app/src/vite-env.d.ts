/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Protomaps hosted-API key. When set, the app uses api.protomaps.com for the
   *  basemap instead of the local world/slovakia PMTiles. See main.ts. */
  readonly VITE_PROTOMAPS_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
