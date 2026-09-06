import type { RegionCapability, RegionId } from "../../domain/models.ts";

export const REGIONS: RegionCapability[] = [
  {
    id: "seoul",
    label: "서울",
    demoAvailable: true,
    realCapability: "unsupported",
    demoLabel: "데모 체험",
  },
  {
    id: "incheon",
    label: "인천",
    demoAvailable: true,
    realCapability: "unsupported",
    demoLabel: "데모 체험",
  },
  {
    id: "daegu",
    label: "대구",
    demoAvailable: true,
    realCapability: "unsupported",
    demoLabel: "데모 체험",
  },
  {
    id: "seongnam",
    label: "성남",
    demoAvailable: true,
    realCapability: "unsupported",
    demoLabel: "데모 체험",
  },
];

export function regionLabel(id: RegionId): string {
  return REGIONS.find((r) => r.id === id)?.label ?? id;
}
