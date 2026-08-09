// Placeholder — overwritten by `scripts/embed-assets.mjs` as part of `pnpm build`,
// which embeds the Vite-built web/ app (web-dist/) so `adminUI()` can serve it
// without any filesystem access at runtime (works in Node, Workers, Bun alike).
// Committed as an empty map so `tsc --noEmit` and a fresh clone don't need a
// build to have already run just to typecheck.
export interface EmbeddedAsset {
  contentType: string
  /** Base64-encoded file contents. */
  base64: string
}

export const assets: Record<string, EmbeddedAsset> = {}
