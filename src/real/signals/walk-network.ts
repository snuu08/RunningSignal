/**
 * 도보네트워크 링크/노드 유형코드 (PDSR_LINK.LINK_CODE, PDSR_NODE.NODE_CODE).
 * Bits are allowed travel modes, not stairs/overpass/alley.
 */
export const LINK_PEDESTRIAN = 0b1000;
export const LINK_VEHICLE = 0b0100;
export const LINK_BICYCLE = 0b0010;
export const LINK_PM = 0b0001;

export type WalkLinkModes = {
  code: string;
  bits: number;
  pedestrian: boolean;
  vehicle: boolean;
  bicycle: boolean;
  pm: boolean;
};

export const NODE_CODE: Record<number, string> = {
  0: "일반노드",
  1: "지하철 출입구",
  2: "버스 정류장",
  3: "지하보도 출입구",
};

export function parseLinkCode(value: unknown): WalkLinkModes | null {
  const raw = String(value ?? "").trim();
  if (!/^[01]{4}$/.test(raw)) return null;
  const bits = Number.parseInt(raw, 2);
  if (raw === "0000")
    return {
      code: raw,
      bits,
      pedestrian: false,
      vehicle: false,
      bicycle: false,
      pm: false,
    };
  return {
    code: raw,
    bits,
    pedestrian: (bits & LINK_PEDESTRIAN) !== 0,
    vehicle: (bits & LINK_VEHICLE) !== 0,
    bicycle: (bits & LINK_BICYCLE) !== 0,
    pm: (bits & LINK_PM) !== 0,
  };
}

export function linkAllowsPedestrian(value: unknown): boolean {
  return parseLinkCode(value)?.pedestrian === true;
}

export function parseNodeCode(value: unknown): { code: number; label: string } | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || !Object.hasOwn(NODE_CODE, n)) return null;
  return { code: n, label: NODE_CODE[n] };
}
