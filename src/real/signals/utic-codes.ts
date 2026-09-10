import type { OperationMode } from "./schema.ts";

/** 데이터코드정의서 (개방신호데이터) REGION_CD / REGION_ID. L01 is Seoul in the codebook. */
export const UTIC_REGION: Record<string, string> = {
  L01: "서울특별시",
  L02: "인천시",
  L03: "부천시",
  L04: "광명시",
  L05: "안양시",
  L06: "과천시",
  L07: "안산시",
  L08: "용인시",
  L09: "성남시",
  L10: "고양시",
  L11: "시흥시",
  L12: "파주시",
  L13: "양주시",
  L14: "의정부시",
  L15: "김포시",
  L16: "의왕시",
  L17: "군포시",
  L18: "남양주시",
  L19: "수원시",
  L20: "경기도광주시",
  L21: "구리시",
  L22: "하남시",
  L23: "부산시",
  L24: "양산시",
  L25: "창원시",
  L26: "김해시",
  L28: "거제시",
  L29: "대구시",
  L30: "대전시",
  L31: "광주광역시",
  L37: "포항시",
};

/** PLAN_DY: 1=월요일 … 7=일요일. Same numbering as engine weekdays. */
export const UTIC_WEEKDAY: Record<number, string> = {
  1: "월요일",
  2: "화요일",
  3: "수요일",
  4: "목요일",
  5: "금요일",
  6: "토요일",
  7: "일요일",
};

/**
 * RESRV_CONTRL_CD from sig_code.hwp.
 * Flash / dark / actuated / push-button are not FixedPlan.
 * Unlisted codes stay unknown — do not invent a mode.
 */
export const UTIC_RESERVE_MODE: Record<number, { label: string; operationMode: OperationMode }> =
  {
    1: { label: "조광 제어", operationMode: "unknown" },
    2: { label: "점멸 제어", operationMode: "special" },
    3: { label: "소등 제어", operationMode: "special" },
    4: { label: "시차 제어", operationMode: "unknown" },
    5: { label: "감응 제어", operationMode: "actuated" },
    6: { label: "보행 작동 신호기 활성", operationMode: "actuated" },
    7: { label: "음향 발생", operationMode: "unknown" },
    8: { label: "감응+푸시버트 활성", operationMode: "actuated" },
    9: { label: "시차+감응+푸시버트 활성", operationMode: "actuated" },
    10: { label: "PPC제어", operationMode: "unknown" },
    11: { label: "단독 앞막힘 제어", operationMode: "special" },
  };

export function isUticRegion(code: string): boolean {
  return Object.hasOwn(UTIC_REGION, code.trim().toUpperCase());
}

export function reserveOperationMode(code: unknown): {
  code: number | null;
  label: string | null;
  operationMode: OperationMode;
} {
  const n = typeof code === "number" ? code : Number(code);
  if (!Number.isInteger(n) || !Object.hasOwn(UTIC_RESERVE_MODE, n))
    return { code: Number.isInteger(n) ? n : null, label: null, operationMode: "unknown" };
  const hit = UTIC_RESERVE_MODE[n];
  return { code: n, label: hit.label, operationMode: hit.operationMode };
}
