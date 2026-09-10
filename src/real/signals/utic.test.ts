import { describe, expect, it } from "vitest";
import { toRuntimeCrossing } from "./to-engine.ts";
import { linkAllowsPedestrian, parseLinkCode, parseNodeCode } from "./walk-network.ts";
import { reserveOperationMode, UTIC_REGION } from "./utic-codes.ts";
import {
  cycleFromCrop,
  parseCropRow,
  parseCrossInfoCoord,
  parseHolidayRow,
  parseReserveRow,
  parseSigMapRow,
  parseWeekdayRow,
  selectUticPlan,
  uticQuery,
  uticUrl,
  UTIC_OPS,
} from "./utic.ts";
import { PROVIDER_CONTRACTS } from "./contracts.ts";

const cropSample = {
  REGION_CD: "L02",
  INT_NO: "5033",
  INT_NM: "시청입구삼거리",
  INT_PLAN_NO: "1",
  INT_PLAN_IDX_NO: "1",
  OPER_PLAN_HH: "6",
  OPER_PLAN_MI: "0",
  INT_OPER_CYCLE_VAL: "180",
  INT_OPER_OFFSET_VAL: "10",
  A_RING_1_PHASE_VAL: "77",
  A_RING_2_PHASE_VAL: "25",
  A_RING_3_PHASE_VAL: "38",
  A_RING_4_PHASE_VAL: "40",
  A_RING_5_PHASE_VAL: "0",
  A_RING_6_PHASE_VAL: "0",
  A_RING_7_PHASE_VAL: "0",
  A_RING_8_PHASE_VAL: "0",
  B_RING_1_PHASE_VAL: "77",
  B_RING_2_PHASE_VAL: "25",
  B_RING_3_PHASE_VAL: "38",
  B_RING_4_PHASE_VAL: "40",
  B_RING_5_PHASE_VAL: "0",
  B_RING_6_PHASE_VAL: "0",
  B_RING_7_PHASE_VAL: "0",
  B_RING_8_PHASE_VAL: "0",
};

describe("walk network codebook", () => {
  it("reads pedestrian bit 1000 from the PDSR_LINK table", () => {
    expect(parseLinkCode("1000")).toEqual({
      code: "1000",
      bits: 8,
      pedestrian: true,
      vehicle: false,
      bicycle: false,
      pm: false,
    });
    expect(linkAllowsPedestrian("1011")).toBe(true);
    expect(linkAllowsPedestrian("0111")).toBe(false);
    expect(linkAllowsPedestrian("0000")).toBe(false);
    expect(parseLinkCode("8")).toBeNull();
    expect(parseNodeCode(3)?.label).toBe("지하보도 출입구");
  });
});

describe("UTIC HWP mapping", () => {
  it("lists Seoul as L01 and keeps flash/actuated off FixedPlan", () => {
    expect(UTIC_REGION.L01).toBe("서울특별시");
    expect(reserveOperationMode(2).operationMode).toBe("special");
    expect(reserveOperationMode(5).operationMode).toBe("actuated");
    expect(reserveOperationMode(1).operationMode).toBe("unknown");
  });

  it("reads cycle seconds from the documented CROP sample without inventing epoch", () => {
    const rings = cycleFromCrop(cropSample);
    expect(rings.cycleSec).toBe(180);
    expect(rings.reasons).toEqual([]);
    const crop = parseCropRow(cropSample)!;
    expect(crop.startHm).toBe("06:00");
    expect(crop.offsetVal).toBe(10);
    expect(crop.engineReady).toBe(false);
    expect(crop.blockedReasons).toEqual(
      expect.arrayContaining([
        "epoch_not_in_spec",
        "pedestrian_phase_unmapped",
        "current_plan_unconfirmed",
      ]),
    );
  });

  it("selects weekday then latest OPER_PLAN clock and overlays reservation mode", () => {
    const thursdayEvening = Date.parse("2026-09-10T12:00:00+09:00");
    const crop = parseCropRow(cropSample)!;
    const selected = selectUticPlan(
      {
        weekday: [
          parseWeekdayRow({
            REGION_CD: "L02",
            INT_NO: "5033",
            PLAN_DY: "4",
            INT_PLAN_NO: "1",
          })!,
        ],
        holiday: [],
        reserve: [
          parseReserveRow({
            REGION_CD: "L02",
            INT_NO: "5033",
            RESRV_STRT_HH: "0",
            RESRV_STRT_MI: "0",
            RESRV_END_HH: "23",
            RESRV_END_MI: "59",
            RESRV_CONTRL_CD: "5",
          })!,
        ],
        crop: [crop],
      },
      "L02",
      "5033",
      thursdayEvening,
    );
    expect(selected.source).toBe("weekday");
    expect(selected.planNo).toBe("1");
    expect(selected.crop?.cycleSec).toBe(180);
    expect(selected.operationMode).toBe("actuated");
    expect(selected.engineReady).toBe(false);
    expect(
      toRuntimeCrossing(
        {
          stage: "verified",
          synthetic: false,
          source: "utic",
          sourceCrossingId: "5033-N",
          sourceIntersectionId: "5033",
          internalId: "utic:5033-N",
          entryCoord: [126.978, 37.5665],
          exitCoord: [126.9782, 37.5667],
          travel: { bearingDeg: 0, label: "N" },
          pedestrianSignalGroupId: "utic:5033:PED1",
          crossingLengthM: 22,
          paintedWidthM: null,
          geometryType: "crossing-endpoints",
          hasRefugeIsland: false,
          stageIndex: 1,
          stageCount: 1,
          evidence: [],
          planVerifiedAt: null,
          observedAt: null,
          fetchedAt: thursdayEvening,
          currentPlanConfirmedAt: null,
        },
        null,
        thursdayEvening,
        10,
      )?.plan,
    ).toBeNull();
  });

  it("prefers holiday INT_PLAN_NO on a matching calendar day", () => {
    const selected = selectUticPlan(
      {
        weekday: [
          parseWeekdayRow({
            REGION_CD: "L01",
            INT_NO: "1",
            PLAN_DY: "4",
            INT_PLAN_NO: "2",
          })!,
        ],
        holiday: [
          parseHolidayRow({
            REGION_CD: "L01",
            INT_NO: "1",
            HOLYDD_PLAN_MM: "9",
            HOLYDD_PLAN_DD: "10",
            INT_PLAN_NO: "9",
          })!,
        ],
        reserve: [],
        crop: [
          parseCropRow({
            ...cropSample,
            REGION_CD: "L01",
            INT_NO: "1",
            INT_PLAN_NO: "9",
          })!,
        ],
      },
      "L01",
      "1",
      Date.parse("2026-09-10T12:00:00+09:00"),
    );
    expect(selected.source).toBe("holiday");
    expect(selected.planNo).toBe("9");
  });

  it("keeps intersection XY that is not WGS84 out of the engine", () => {
    expect(parseCrossInfoCoord({ X: 126.978, Y: 37.566 }).coord).toEqual([
      126.978, 37.566,
    ]);
    expect(parseCrossInfoCoord({ X: 200000, Y: 450000 }).reason).toBe(
      "crs_not_in_crossinfo_spec",
    );
    expect(parseSigMapRow({ REGION_CD: "L02", INT_NO: "5033", PED1: "0" })?.ped[0]).toBe(
      0,
    );
  });

  it("builds documented query URLs and refuses unknown regions and file ops on the JSON proxy contract", () => {
    const q = uticQuery("getPlanCROPInfo", {
      serviceKey: "secret",
      srchCTId: "l01",
      srchCRNm: "시청",
    });
    expect(q.get("srchCTId")).toBe("L01");
    expect(uticUrl("getPlanCROPInfo", q)).toContain(
      "/PlanCrossRoadInfoService/getPlanCROPInfo",
    );
    expect(() => uticQuery("getPlanCROPInfo", { serviceKey: "x", srchCTId: "ZZZ" })).toThrow(
      /unknown_utic_region/,
    );
    expect(UTIC_OPS.crossInfo.kind).toBe("file");
    expect(PROVIDER_CONTRACTS.find((c) => c.id === "utic-plan")?.mayCall).toBe(true);
    expect(PROVIDER_CONTRACTS.find((c) => c.id === "utic-cross-info")?.mayCall).toBe(
      false,
    );
    expect(PROVIDER_CONTRACTS.find((c) => c.id === "utic-signal-open")?.mayCall).toBe(
      false,
    );
  });
});
