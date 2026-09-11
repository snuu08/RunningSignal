import { describe, expect, it, vi } from "vitest";
import { ENGINE_PLAN_APPLIED_MAX_AGE_MS, appliedPlanIsFresh, engineVerifiedAtMs } from "./freshness.ts";
import { namespacedId } from "./schema.ts";
import { validateCrossing, validateObservation, validatePlan, asFinite } from "./validate.ts";
import { redactText, redactValue } from "./redact.ts";
import { etlCrossings, etlObservations, rejectSpreadsheetFilename } from "./etl.ts";
import { captureTdataIntersection, contrastInCodeUrl, tdataUrl } from "./tdata.ts";
import { toRuntimeCrossing } from "./to-engine.ts";
import { PROVIDER_CONTRACTS } from "./contracts.ts";
import { toWgs84 } from "./geo-crs.ts";
import { forecast } from "../core.ts";
import type { CrossingRecord, OperatingPlanRecord } from "./schema.ts";

const crossingRow = {
  source: "field",
  sourceCrossingId: "N-entry",
  sourceIntersectionId: "1537",
  entryLon: "126.9780",
  entryLat: "37.5665",
  exitLon: "126.9782",
  exitLat: "37.5667",
  bearingDeg: "45",
  directionLabel: "NE",
  pedestrianSignalGroupId: "tdata:1537:ntPdsg",
  crossingLengthM: "22",
  paintedWidthM: "4",
  geometryType: "crossing-endpoints",
  stage: "verified",
  synthetic: "false",
};

describe("crossing and plan schema", () => {
  it("keeps provider ids namespaced and does not merge by name", () => {
    const a = validateCrossing(crossingRow).ok!;
    const b = validateCrossing({
      ...crossingRow,
      source: "utic",
      sourceCrossingId: "N-entry",
    }).ok!;
    expect(a.internalId).toBe(namespacedId("field", "N-entry"));
    expect(b.internalId).toBe(namespacedId("utic", "N-entry"));
    expect(a.internalId).not.toBe(b.internalId);
  });
  it("stores reverse and island stages as separate records", () => {
    const fwd = validateCrossing(crossingRow).ok!;
    const rev = validateCrossing({
      ...crossingRow,
      sourceCrossingId: "N-exit",
      entryLon: crossingRow.exitLon,
      entryLat: crossingRow.exitLat,
      exitLon: crossingRow.entryLon,
      exitLat: crossingRow.entryLat,
      directionLabel: "SW",
      bearingDeg: "225",
    }).ok!;
    const stage2 = validateCrossing({
      ...crossingRow,
      sourceCrossingId: "N-entry-s2",
      hasRefugeIsland: "true",
      stageIndex: "2",
      stageCount: "2",
    }).ok!;
    expect(fwd.internalId).not.toBe(rev.internalId);
    expect(stage2.hasRefugeIsland).toBe(true);
    expect(stage2.stageIndex).toBe(2);
  });
  it("rejects missing ends, missing pedestrian key, and length/width mix-up", () => {
    expect(validateCrossing({ ...crossingRow, entryLon: "" }).reason).toBe(
      "missing_entry_exit",
    );
    expect(
      validateCrossing({ ...crossingRow, pedestrianSignalGroupId: "" }).reason,
    ).toBe("missing_pedestrian_signal_group");
    expect(
      validateCrossing({ ...crossingRow, crossingLengthM: "4", paintedWidthM: "4" })
        .reason,
    ).toBe("crossingLengthM_equals_paintedWidth_check_direction");
    expect(validateCrossing({ ...crossingRow, crossingLengthM: "0" }).reason).toBe(
      "invalid_crossingLengthM",
    );
  });
  it("accepts numeric provider ids from spatial exports", () => {
    const ok = validateCrossing({
      ...crossingRow,
      sourceCrossingId: 9001,
      sourceIntersectionId: 1537,
    }).ok;
    expect(ok?.internalId).toBe("field:9001");
    expect(ok?.sourceIntersectionId).toBe("1537");
  });
  it("requires synthetic source to be marked", () => {
    expect(
      validateCrossing({ ...crossingRow, source: "synthetic", synthetic: "false" })
        .reason,
    ).toBe("synthetic_source_unmarked");
  });
});

describe("operating plan timestamps", () => {
  const planRow = {
    source: "field",
    sourcePlanId: "TOD-1",
    version: "v1",
    sourceIntersectionId: "1537",
    pedestrianSignalGroupId: "tdata:1537:ntPdsg",
    cycleSec: "60",
    epochMs: "1800000000000",
    entryStartSec: "0",
    entryEndSec: "20",
    flashStartSec: "16",
    clearEndSec: "30",
    validFromMs: "1799999990000",
    validToMs: "1800003600000",
    uncertaintySec: "1",
    operationMode: "fixed",
    startHm: "00:00",
    endHm: "24:00",
    weekdays: "1,2,3,4,5,6,7",
    fetchedAt: "1800000000000",
    planVerifiedAt: "1790000000000",
    currentPlanConfirmedAt: "1800000000000",
    stage: "verified",
  };
  it("does not treat fetchedAt as applied confirmation", () => {
    const plan = validatePlan(planRow).ok!;
    expect(plan.fetchedAt).toBe(1800000000000);
    expect(plan.planVerifiedAt).toBe(1790000000000);
    expect(engineVerifiedAtMs(plan)).toBe(1800000000000);
    expect(engineVerifiedAtMs({ ...plan, currentPlanConfirmedAt: null })).toBeNull();
  });
  it("keeps the 60s applied-plan window", () => {
    expect(ENGINE_PLAN_APPLIED_MAX_AGE_MS).toBe(60_000);
    expect(appliedPlanIsFresh(1000, 61001)).toBe(false);
    expect(appliedPlanIsFresh(1000, 61000)).toBe(true);
    expect(validatePlan({ ...planRow, operationMode: "actuated" }).ok?.operationMode).toBe(
      "actuated",
    );
  });
});

describe("etl and observations", () => {
  it("writes exclusion reports for bad rows and does not invent plans from facilities", () => {
    const csv = `sourceCrossingId,sourceIntersectionId,lon,lat,cycleSec
a,1537,126.97,37.56,60
b,1537,200,95,`;
    const report = etlCrossings(csv, {
      source: "national-xls",
      crs: "EPSG:4326",
      geometryType: "facility-point",
      columns: {},
    });
    expect(report.exclusions.some((e) => e.reason === "location_row_must_not_invent_plan")).toBe(
      true,
    );
    expect(report.exclusions.some((e) => e.reason === "wgs84_out_of_range")).toBe(true);
    expect(
      report.records.every(
        (r) => (r as { geometryType: string }).geometryType === "facility-point",
      ),
    ).toBe(true);
  });
  it("upserts by namespaced id without merging nearest coordinates", () => {
    const csv = `source,sourceCrossingId,sourceIntersectionId,entryLon,entryLat,exitLon,exitLat,bearingDeg,directionLabel,pedestrianSignalGroupId,crossingLengthM,geometryType,stage,synthetic
field,A,1,126.9780,37.5665,126.9782,37.5667,45,NE,g,22,crossing-endpoints,normalized,false
field,A,1,126.9780,37.5665,126.9782,37.5667,45,NE,g,22,crossing-endpoints,normalized,false
field,B,1,126.9780,37.5665,126.9782,37.5667,45,NE,g,22,crossing-endpoints,normalized,false`;
    const report = etlCrossings(csv, {
      source: "field",
      crs: "EPSG:4326",
      geometryType: "crossing-endpoints",
      columns: {},
    });
    expect(report.kept).toBe(2);
    expect(report.exclusions.some((e) => e.reason === "duplicate_upsert_key")).toBe(true);
  });
  it("loads the synthetic sample as marked synthetic and not as a live crossing plan", () => {
    const csv = `source,sourceCrossingId,sourceIntersectionId,entryLon,entryLat,exitLon,exitLat,bearingDeg,directionLabel,pedestrianSignalGroupId,crossingLengthM,paintedWidthM,geometryType,hasRefugeIsland,stageIndex,stageCount,planVerifiedAt,observedAt,fetchedAt,currentPlanConfirmedAt,synthetic,stage
synthetic,SYN-N-1,SYN-ITST,126.9780,37.5665,126.9782,37.5667,45,NE,synthetic:group:ntPdsg,22,4,crossing-endpoints,false,1,1,,,,,true,raw`;
    const report = etlCrossings(csv, {
      source: "synthetic",
      crs: "EPSG:4326",
      geometryType: "crossing-endpoints",
      columns: {},
    });
    expect(report.kept).toBe(1);
    expect((report.records[0] as { synthetic: boolean }).synthetic).toBe(true);
  });
  it("rejects spreadsheet binaries until exported to csv", () => {
    expect(rejectSpreadsheetFilename("national.xls")).toBe("xls_not_parsed_export_csv");
  });
  it("rejects incomplete field observations", () => {
    expect(validateObservation({ crossingInternalId: "x" }).reason).toBe(
      "missing_observation_keys",
    );
    const csv = `crossingInternalId,sourceIntersectionId,dateSeoul,deviceClockErrorSec
field:N-entry,1537,2026-09-08,0`;
    expect(etlObservations(csv).kept).toBe(1);
    expect(
      validateObservation({
        crossingInternalId: "field:N-entry",
        sourceIntersectionId: "1537",
        dateSeoul: "2026-09-08",
        deviceClockErrorSec: "0",
        predictedWaitSec: "",
      }).ok?.predictedWaitSec,
    ).toBeNull();
  });
  it("does not convert WGS84 without a listed CRS", () => {
    expect(toWgs84(200000, 600000, "EPSG:9999").reason).toMatch(/unsupported_crs/);
    const origin = toWgs84(200000, 600000, "EPSG:5186").coord;
    expect(origin?.[0]).toBeCloseTo(127, 3);
    expect(origin?.[1]).toBeCloseTo(38, 3);
  });
});

describe("tdata capture and contracts", () => {
  it("contrasts in-code crossroad gateway against the file catalog", () => {
    const c = contrastInCodeUrl(
      "crossroad",
      "https://t-data.seoul.go.kr/apig/apiman-gateway/tapi/v2xCrossroadMapInformation/1.0",
    );
    expect(c.match).toBe(false);
    expect(c.officialKind).toBe("file");
  });
  it("keeps the UTIC guide page non-callable and the HWP plan API callable", () => {
    expect(PROVIDER_CONTRACTS.find((c) => c.id === "utic-signal-open")?.mayCall).toBe(
      false,
    );
    expect(PROVIDER_CONTRACTS.find((c) => c.id === "utic-plan")?.mayCall).toBe(true);
    expect(PROVIDER_CONTRACTS.find((c) => c.id === "utic-plan")?.listedEndpoint).toMatch(
      /tsihub\.utic\.go\.kr/,
    );
    expect(PROVIDER_CONTRACTS.find((c) => c.id === "police-plan")?.mayCall).toBe(false);
  });
  it("captures one intersection with clocks and strips keys", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const u = new URL(String(url));
      expect(u.searchParams.get("apiKey")).toBe("secret-key");
      return Response.json([
        { itstId: "1537", trsmUtcTime: 1800000000000, dataId: "SPAT-1" },
      ]);
    });
    const session = await captureTdataIntersection("1537", "secret-key", fetcher);
    expect(session.calls).toHaveLength(4);
    expect(session.calls[0].itstId).toBe("1537");
    expect(session.calls.every((c) => c.requestUrlRedacted.includes("[redacted]"))).toBe(
      true,
    );
    expect(session.calls[0].sourceTimestampMs).toBe(1800000000000);
    expect(Object.keys(session.callGapMs).length).toBe(3);
    const phaseUrl = tdataUrl("phase", new URLSearchParams({ apiKey: "secret-key", itstId: "1537" }));
    expect(redactText(phaseUrl, ["secret-key"])).not.toContain("secret-key");
    expect(redactValue({ apiKey: "secret-key" })).toEqual({ apiKey: "[redacted]" });
    expect(session.calls.find((c) => c.service === "connection")?.itstIdOnOfficialRequestTable).toBe(
      false,
    );
    expect(session.calls.find((c) => c.service === "phase")?.requestUrlRedacted).toMatch(/itstId=1537/);
    expect(session.calls.find((c) => c.service === "connection")?.requestUrlRedacted).not.toMatch(/itstId=/);
  });
});

describe("engine mapping does not enable live prediction", () => {
  it("drops synthetic and facility geometry and stale confirmation", () => {
    const crossing = validateCrossing(crossingRow).ok as CrossingRecord;
    const plan = validatePlan({
      source: "field",
      sourcePlanId: "TOD-1",
      version: "v1",
      sourceIntersectionId: "1537",
      pedestrianSignalGroupId: "tdata:1537:ntPdsg",
      cycleSec: "60",
      epochMs: "1800000000000",
      entryStartSec: "0",
      entryEndSec: "20",
      clearEndSec: "30",
      validFromMs: "1799999990000",
      validToMs: "1800003600000",
      uncertaintySec: "0",
      operationMode: "fixed",
      currentPlanConfirmedAt: "1800000000000",
      stage: "verified",
    }).ok as OperatingPlanRecord;
    expect(toRuntimeCrossing({ ...crossing, synthetic: true }, plan, 1800000000000, 10)).toBeNull();
    expect(
      toRuntimeCrossing(
        { ...crossing, geometryType: "facility-point" },
        plan,
        1800000000000,
        10,
      ),
    ).toBeNull();
    const stale = toRuntimeCrossing(crossing, plan, 1800000000000 + 120000, 10);
    expect(stale?.plan).toBeNull();
    const fresh = toRuntimeCrossing(crossing, plan, 1800000000000 + 1000, 10);
    expect(fresh?.plan?.verifiedAtMs).toBe(1800000000000);
    expect(fresh?.widthM).toBe(22);
    const actuated = toRuntimeCrossing(
      crossing,
      { ...plan, operationMode: "actuated" },
      1800000000000,
      10,
    );
    expect(actuated?.plan).toBeNull();
    expect(forecast(100, 360, 1800000000000, [actuated!], true, 1800000000000).waitSec).toBeNull();
  });
  it("refuses a plan from another intersection or pedestrian group", () => {
    const crossing = validateCrossing(crossingRow).ok as CrossingRecord;
    const plan = validatePlan({
      source: "field",
      sourcePlanId: "TOD-1",
      version: "v1",
      sourceIntersectionId: "1537",
      pedestrianSignalGroupId: "tdata:1537:ntPdsg",
      cycleSec: "60",
      epochMs: "1800000000000",
      entryStartSec: "0",
      entryEndSec: "20",
      clearEndSec: "30",
      validFromMs: "1799999990000",
      validToMs: "1800003600000",
      uncertaintySec: "0",
      operationMode: "fixed",
      currentPlanConfirmedAt: "1800000000000",
      stage: "verified",
    }).ok as OperatingPlanRecord;
    expect(
      toRuntimeCrossing(crossing, { ...plan, sourceIntersectionId: "9999" }, 1800000000000, 10)
        ?.plan,
    ).toBeNull();
    expect(
      toRuntimeCrossing(crossing, { ...plan, pedestrianSignalGroupId: "other" }, 1800000000000, 10)
        ?.plan,
    ).toBeNull();
    expect(
      toRuntimeCrossing(crossing, { ...plan, source: "utic" }, 1800000000000, 10)?.plan,
    ).toBeNull();
  });
});

describe("numeric empty vs zero", () => {
  it("does not treat blank strings as 0", () => {
    expect(asFinite("", 0, 3)).toBeNull();
    expect(asFinite("  ", 0, 3)).toBeNull();
    expect(asFinite(null, 0, 3)).toBeNull();
    expect(asFinite("0", 0, 3)).toBe(0);
    expect(validatePlan({
      source: "field",
      sourcePlanId: "TOD-1",
      version: "v1",
      sourceIntersectionId: "1537",
      pedestrianSignalGroupId: "g",
      cycleSec: "60",
      epochMs: "1800000000000",
      entryStartSec: "0",
      entryEndSec: "20",
      clearEndSec: "30",
      validFromMs: "1",
      validToMs: "2",
      uncertaintySec: "",
      operationMode: "fixed",
    }).reason).toBe("invalid_plan_numbers");
  });
});
