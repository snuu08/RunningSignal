import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FALLBACK_BASEMAP,
  mapTilerStyleUrl,
  resolveBasemapStyle,
} from "./basemap.ts";

afterEach(() => vi.unstubAllGlobals());

describe("resolveBasemapStyle", () => {
  it("uses the public dark style when no MapTiler key is set", async () => {
    await expect(resolveBasemapStyle(undefined)).resolves.toBe(FALLBACK_BASEMAP);
  });

  it("keeps MapTiler when the style request succeeds", async () => {
    const key = "test-key";
    const request = vi.fn(async () => new Response("{}", { status: 200 }));
    await expect(resolveBasemapStyle(key, request)).resolves.toBe(
      mapTilerStyleUrl(key),
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it("falls back when MapTiler rejects the current origin", async () => {
    const request = vi.fn(
      async () => new Response("Key usage restricted", { status: 403 }),
    );
    await expect(resolveBasemapStyle("test-key", request)).resolves.toBe(
      FALLBACK_BASEMAP,
    );
  });
});
