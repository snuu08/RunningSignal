import { afterEach, describe, expect, it, vi } from "vitest";
import { createDataGoFeedClient } from "./data-go-feed.ts";
import { handleApi, resetApiRuntimeForTests } from "./api.ts";

afterEach(() => resetApiRuntimeForTests());
const reply = (item: unknown, resultCode = "K0") => ({ response: {
  header: { resultCode }, body: { totalCount: "1", items: { item } },
} });

describe("documented public-data diagnostic services", () => {
  it.each(["raw", "encoded"])("encodes a %s key once and uses the exact RTI operation and Seoul code", async (form) => {
    const key = "test+/key==";
    const fetcher = vi.fn(async (_url: RequestInfo | URL) => Response.json(reply({
      stdgCd: "1100000000", crsrdId: "20035", totDt: "2026-10-17 09:00:00.123",
      ntPdsgSttsNm: "stop-And-Remain", ntPdsgRmndCs: "352", unexpectedSecret: key,
    })));
    const result = await createDataGoFeedClient(form === "raw" ? key : encodeURIComponent(key), fetcher)
      .read("current", "1100000000", "1");
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://apis.data.go.kr/B551982/rti/tl_drct_info");
    expect(url.searchParams.get("serviceKey")).toBe(key);
    expect(url.searchParams.get("stdgCd")).toBe("1100000000");
    expect(result).toMatchObject({ class: "ok-data", totalCount: 1,
      rows: [{ crsrdId: "20035", ntPdsgRmndCs: "352", totDt: "2026-10-17 09:00:00.123" }] });
    expect(JSON.stringify(result)).not.toContain(key);
    expect(result.rows[0]).not.toHaveProperty("unexpectedSecret");
    expect(result.rows[0]).not.toHaveProperty("itstId");
  });
  it("uses the police portal's query names without conflating its IDs or coordinates with T-DATA", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL) => Response.json(reply({
      REGION_CD: "L01", INT_NO: "30", INT_NM: "시청", X_COORD: "126775207", Y_COORD: "37506690",
    }, "00")));
    const result = await createDataGoFeedClient("test-secret", fetcher).read("police-crossroad", "L01", "1");
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.pathname).toBe("/1320000/CrossRoadInfoService/getCrossRoadInfoList");
    expect(url.searchParams.get("ServiceKey")).toBe("test-secret");
    expect(url.searchParams.get("srchCTid")).toBe("L01");
    expect(result.rows[0]).toMatchObject({ X_COORD: "126775207" });
    expect(result.rows[0]).not.toHaveProperty("lat");
  });
  it("reads a legacy XML response and preserves leading zeros, coordinate scale and entities", async () => {
    const xml = '<?xml version="1.0"?><response><header><resultCode>00</resultCode><resultMsg>OK</resultMsg></header><body><totalCount>1</totalCount><items><item><REGION_CD>L01</REGION_CD><INT_NO>00030</INT_NO><INT_NM>시청 &amp; 광장</INT_NM><X_COORD>126775207</X_COORD></item></items></body></response>';
    const feed = createDataGoFeedClient("test-secret", async () => new Response(xml));
    expect(await feed.read("police-crossroad", "L01", "1")).toMatchObject({ class: "ok-data", responseFormat: "xml",
      rows: [{ INT_NO: "00030", INT_NM: "시청 & 광장", X_COORD: "126775207" }] });
  });
  it.each([
    '<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode><errMsg>test-secret</errMsg></cmmMsgHeader></OpenAPI_ServiceResponse>',
    '<!DOCTYPE response [<!ENTITY secret SYSTEM "file:///etc/passwd">]><response><header><resultCode>00</resultCode></header></response>',
    '<response><header><resultCode>00</header></response>',
  ])("never treats an XML error or malformed payload as signal data", async (xml) => {
    const result = await createDataGoFeedClient("test-secret", async () => new Response(xml))
      .read("police-crossroad", "L01", "1");
    expect(["auth", "spec-unknown"]).toContain(result.class);
    expect(result.rows).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("test-secret");
  });
  it("accepts a numeric success code without treating missing codes as success", async () => {
    const result = await createDataGoFeedClient("test-secret", async () => Response.json({ header: { resultCode: 0 },
      body: { totalCount: 0, items: [] } })).read("current", "1100000000", "1");
    expect(result).toMatchObject({ class: "ok-empty", resultCode: "0", responseFormat: "json" });
  });
  it.each(["K3", "K03"])("treats the provider's %s as no data even if an old row is present", async (code) => {
    const result = await createDataGoFeedClient("test-secret", async () =>
      Response.json(reply({ crsrdId: "old-row", ntPdsgRmndCs: "90" }, code)))
      .read("current", "1100000000", "1");
    expect(result).toMatchObject({ class: "ok-empty", totalCount: 0, rows: [], resultCode: code });
  });
  it.each(["10", "20", "30", "31"])("classifies provider envelope %s without exposing upstream text or credentials", async (code) => {
    const fetcher = vi.fn(async () => Response.json({ OpenAPI_ServiceResponse: { cmmMsgHeader: {
      returnReasonCode: code, errMsg: "echoed-test-secret", returnAuthMsg: "echoed-test-secret",
    } } }, { status: 400 }));
    const result = await createDataGoFeedClient("test-secret", fetcher).read("map", "1100000000", "1");
    expect(result.class).toBe(code === "10" ? "spec-unknown" : "auth");
    expect(result.resultCode).toBe(code);
    expect(JSON.stringify(result)).not.toContain("test-secret");
  });
  it("coalesces repeated diagnostics and expires them after one minute", async () => {
    let clock = 1000;
    const fetcher = vi.fn(async () => Response.json(reply([])));
    const feed = createDataGoFeedClient("test-secret", fetcher, () => clock);
    await Promise.all([feed.read("current", "1100000000", "1"), feed.read("current", "1100000000", "1")]);
    clock += 59_999;
    await feed.read("current", "1100000000", "1");
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock += 1;
    await feed.read("current", "1100000000", "1");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("honors rate limits across all services, including a non-JSON 429", async () => {
    let clock = 1000;
    const fetcher = vi.fn(async () => new Response("quota", { status: 429, headers: { "Retry-After": "300" } }));
    const feed = createDataGoFeedClient("test-secret", fetcher, () => clock);
    expect(await feed.read("current", "1100000000", "1")).toMatchObject({ class: "rate-limited", retryAfterMs: 300_000 });
    clock += 10_000;
    expect((await feed.read("police-crossroad", "L01", "1")).retryAfterMs).toBe(290_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("never treats unknown success-shaped JSON as verified data", async () => {
    const feed = createDataGoFeedClient("test-secret", async () => Response.json({ data: [{ crsrdId: "1" }] }));
    expect((await feed.read("current", "1100000000", "1")).class).toBe("spec-unknown");
  });
  it("reports a provider 400 separately from local input errors and does not enable prediction", async () => {
    const env = { DATA_GO_KR_SERVICE_KEY: "test-secret" };
    const fetcher = vi.fn(async () => Response.json({ OpenAPI_ServiceResponse: { cmmMsgHeader: {
      returnReasonCode: "10", errMsg: "test-secret",
    } } }, { status: 400 }));
    const invalid = await handleApi(new Request("https://app.test/api/signals/national?stdgCd=../../bad"), env, fetcher);
    expect(invalid.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    const failed = await handleApi(new Request("https://app.test/api/signals/national"), env, fetcher);
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({ error: "공공데이터 제공기관 응답 오류 (HTTP 400 · 코드 10).",
      providerResponse: { httpStatus: 400, format: "json", fieldNames: ["OpenAPI_ServiceResponse"] } });
    const okFetcher = vi.fn(async () => Response.json(reply({ crsrdId: "20035", ntPdsgRmndCs: "352" })));
    const ok = await handleApi(new Request("https://app.test/api/signals/national"), env, okFetcher);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ capability: "diagnostic-snapshot", predictionReady: false });
  });
});
