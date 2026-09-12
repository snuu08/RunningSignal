export const FALLBACK_BASEMAP = "https://tiles.openfreemap.org/styles/dark";

export function mapTilerStyleUrl(
  key: string,
  style = import.meta.env.VITE_MAPTILER_STYLE || "dataviz-dark",
) {
  return `https://api.maptiler.com/maps/${encodeURIComponent(style)}/style.json?key=${encodeURIComponent(key)}`;
}

export async function resolveBasemapStyle(
  key: string | undefined,
  request: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  if (!key) return FALLBACK_BASEMAP;
  const url = mapTilerStyleUrl(key);
  try {
    const response = await request(url, { signal });
    if (response.ok) return url;
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  return FALLBACK_BASEMAP;
}
