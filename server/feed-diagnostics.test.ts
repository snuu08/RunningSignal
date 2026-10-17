import { afterEach, describe, expect, it, vi } from "vitest";
import { createDataGoFeedClient } from "./data-go-feed.ts";
import { fetchTdataService } from "../src/real/signals/tdata.ts";
import { handleApi, resetApiRuntimeForTests } from "./api.ts";

afterEach(() => resetApiRuntimeForTests());
describe("safe upstream diagnostics", () => {
  it("distinguishes timeout failures without reflecting exception text or names", async () => {
    const secret = "private-test-key";
    const result = await fetchTdataService("current", secret, async () => {
      throw new DOMException(secret, "TimeoutError");
    }, { itstId: "20386" });
    expect(result).toMatchObject({ class: "connect", error: "TimeoutError" });
    expect(result.lagMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(result)).not.toContain(secret);
    const unknown = await fetchTdataService("current", secret, async () => {
      const error = new Error(secret); error.name = secret; throw error;
    }, { itstId: "20386" });
    expect(unknown.error).toBe("Error");
    expect(JSON.stringify(unknown)).not.toContain(secret);
  });
  it("returns the upstream failure stage and status through the Seoul API", async () => {
    const failed = await handleApi(new Request(
      "https://app.test/api/signals/seoul?service=current&itstId=20386"),
      { SEOUL_TDATA_CURRENT_API_KEY: "private-test-key" },
      async () => { throw new DOMException("private-test-key", "TimeoutError"); });
    expect(failed.status).toBe(502);
    const body = await failed.json();
    expect(body).toMatchObject({ providerResponse: { provider: "tdata",
      service: "current", httpStatus: null, errorType: "TimeoutError", resultClass: "connect" } });
    expect(JSON.stringify(body)).not.toContain("private-test-key");
  });
  it("requests the police API's documented XML default and preserves identifier strings", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("type")).toBe("xml");
      expect(url.searchParams.get("srchCTid")).toBe("L01");
      return new Response("<response><header><resultCode>00</resultCode></header><body>" +
        "<totalCount>1</totalCount><items><item><INT_NO>00030</INT_NO><REGION_CD>L01</REGION_CD>" +
        "</item></items></body></response>", { headers: { "Content-Type": "application/xml" } });
    });
    const result = await createDataGoFeedClient("private-test-key", fetcher)
      .read("police-crossroad", "L01", "1");
    expect(result).toMatchObject({ class: "ok-data", responseFormat: "xml",
      rootType: "object", rows: [{ INT_NO: "00030" }] });
  });
  it("reports a bare array without silently accepting it as verified data or reflecting its rows", async () => {
    const response = await handleApi(new Request(
      "https://app.test/api/signals/national?service=police-crossroad"),
      { DATA_GO_KR_SERVICE_KEY: "private-test-key" },
      async () => Response.json([{ INT_NO: "30", unexpectedSecret: "private-test-key" }]));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toMatchObject({ providerResponse: { httpStatus: 200,
      format: "json", rootType: "array", arrayLength: 1 } });
    expect(JSON.stringify(body)).not.toContain("private-test-key");
    expect(body).not.toHaveProperty("rows");
  });
  it.each([
    ["TimeoutError", "timeout"], ["AbortError", "aborted"],
    ["TypeError", "network-or-redirect"], ["secret-error-name", "unknown"],
  ])("classifies transport error %s without exposing provider details", async (name, expected) => {
    const result = await createDataGoFeedClient("private-test-key", async () => {
      const error = new Error("private-test-key"); error.name = name; throw error;
    }).read("current", "1100000000", "1");
    expect(result).toMatchObject({ class: "connect", transportError: expected });
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(result)).not.toContain("private-test-key");
    expect(JSON.stringify(result)).not.toContain("secret-error-name");
  });
});
