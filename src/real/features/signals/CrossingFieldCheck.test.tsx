import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CrossingFieldCheck } from "./CrossingFieldCheck.tsx";
import { crossingCandidates } from "../../signals/crossing-field.ts";

const fetcher = vi.fn<typeof fetch>();
beforeEach(() => { fetcher.mockReset(); vi.stubGlobal("fetch", fetcher); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("physical crossing diagnostic screen", () => {
  it("shows sourced candidates without making a provider call or assuming ID correspondence", async () => {
    render(<CrossingFieldCheck itstId="20386" owner="synthetic-candidate-screen" />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("공식");
    expect(screen.getByText(/T-GIS 관리번호와 T-DATA 교차로 번호의 동일성은 미확인/)).toBeTruthy();
    expect(screen.getByText("위치 출처").getAttribute("href")).toContain("OA-23081");
    await waitFor(() => expect(screen.getByLabelText("실제 횡단보도").hasAttribute("disabled")).toBe(false));
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects a response with no fresh paired pedestrian sample", async () => {
    fetcher.mockResolvedValue(Response.json({ resultClass: "ok-data", observation: { fresh: false } }));
    render(<CrossingFieldCheck itstId="20386" owner="synthetic-stale-response" />);
    const selected = crossingCandidates("20386")!.crossings.find((c) => c.hasSignal)!;
    await waitFor(() => expect(screen.getByLabelText("실제 횡단보도").hasAttribute("disabled")).toBe(false));
    fireEvent.change(screen.getByLabelText("실제 횡단보도"), { target: { value: selected.managementId } });
    fireEvent.click(screen.getByRole("button", { name: "직접 본 상태와 API 함께 기록" }));
    await screen.findByText("선택한 보행 필드의 최신 응답이 없어 저장하지 않았습니다.");
    expect(screen.getByRole("status").textContent).toContain("관측 0/60");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).not.toContain("coord");
  });
  it("does not expose an inferred candidate for an unsupported intersection", () => {
    render(<CrossingFieldCheck itstId="1183" owner="guest" />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/공식 도형을 확보한 시범 교차로/)).toBeTruthy();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
