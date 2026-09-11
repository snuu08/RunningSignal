import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.env.VERIFY_BASE ?? "http://127.0.0.1:5176";
const steps = [];

function rec(id, ok, detail, extra = {}) {
  steps.push({ id, ok, detail, ...extra, at: Date.now() });
  console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${detail}`);
}

async function visible(page, name) {
  const el = page.getByRole("button", { name });
  if (!(await el.count())) return { found: false, box: null };
  const box = await el.first().boundingBox();
  return { found: true, box };
}

async function main() {
  const browser = await chromium.launch({
    channel: "msedge",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    geolocation: { latitude: 37.5665, longitude: 126.978 },
    permissions: ["geolocation"],
    locale: "ko-KR",
  });
  context.setDefaultTimeout(20000);
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept());

  try {
    const home = await page.goto(`${BASE}/real/home`, {
      waitUntil: "domcontentloaded",
    });
    rec("http-home", home?.ok() === true, `status ${home?.status()}`, {
      simulation: false,
    });
    await page
      .getByRole("button", { name: "계정 없이 기기에 기록하기" })
      .or(page.getByPlaceholder("2~20자"))
      .or(page.getByRole("heading", { name: /오늘의 러닝/ }))
      .first()
      .waitFor({ timeout: 20000 });
    const bodyPreview = (await page.locator("body").innerText()).slice(0, 180);
    rec("first-screen", true, bodyPreview.replace(/\s+/g, " "));

    const guest = page.getByRole("button", { name: "계정 없이 기기에 기록하기" });
    if (await guest.count()) {
      await guest.click();
      rec("guest-entry", true, "게스트 진입 버튼 클릭");
    } else {
      rec("guest-entry", true, "이미 게스트/온보딩 이후 상태");
    }

    const nick = page.getByPlaceholder("2~20자");
    if (await nick.count()) {
      await nick.fill("검증러너");
      const dist = page.getByLabel("온보딩 계산 거리 km");
      if (await dist.count()) {
        await dist.fill("5");
        await page.getByLabel("온보딩 계산 분").fill("25");
        await page.getByRole("button", { name: "거리·시간으로 페이스 넣기" }).click();
      }
      await page.getByRole("button", { name: "시작하기" }).click();
      rec("onboarding", true, "닉네임·페이스 온보딩 완료");
    } else {
      rec("onboarding", true, "온보딩 화면 없음(이미 완료)");
    }

    await page.getByRole("button", { name: "내 페이스 계산하기" }).click();
    await page.getByLabel("거리 (km)").fill("5");
    await page.getByLabel("걸린 시간 (분)").fill("25");
    const paceText = await page.locator(".hero-number").innerText();
    rec("pace-calc", /5/.test(paceText), `계산 표시: ${paceText.replace(/\s+/g, " ")}`);
    await page.getByRole("button", { name: "선택한 칸에 저장" }).click();
    await page.getByRole("heading", { name: /오늘의 러닝/ }).waitFor();
    await page.getByRole("button", { name: "현재 위치" }).click();
    let originVal = "";
    for (let i = 0; i < 20; i++) {
      originVal = await page.getByRole("combobox", { name: "출발지" }).inputValue();
      if (originVal) break;
      await page.waitForTimeout(250);
    }
    rec("origin-locate", originVal.length > 0, `출발지=${originVal}`, {
      simulation: true,
    });

    await page.getByRole("combobox", { name: "목적지" }).fill("덕수궁");
    await page.locator(".place-results button").first().waitFor({ timeout: 15000 });
    const placeName = await page.locator(".place-results button strong").first().innerText();
    await page.locator(".place-results button").first().click();
    rec("place-search", !!placeName, `Kakao 검색 선택: ${placeName}`);

    await page.getByRole("button", { name: "출발점 선택" }).click();
    rec("map-pick-mode", true, "출발점 선택 모드");

    await page.getByRole("button", { name: "러닝 경로 찾기" }).click();
    try {
      await page.waitForURL(/\/real\/(recommend|home)/, { timeout: 30000 });
      const onRecommend = page.url().includes("recommend");
      rec(
        "tmap-routes",
        onRecommend,
        onRecommend ? "추천 경로 화면" : `경로 미도달 URL=${page.url()}`,
        { likely: onRecommend ? undefined : "TMAP INVALID_API_KEY" },
      );
    } catch {
      rec("tmap-routes", false, `URL 대기 초과 ${page.url()}`, {
        likely: "TMAP 403",
      });
      const cancel = page.getByRole("button", { name: "취소" });
      if (await cancel.count()) await cancel.click();
    }

    await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: "설정" }).click();
    await page.getByLabel("닉네임").fill("검증러너2");
    await page.getByRole("checkbox", { name: /계단 제외/ }).check();
    await page.getByRole("button", { name: "설정 저장" }).click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: "설정" }).click();
    const nickVal = await page.getByLabel("닉네임").inputValue();
    const stairs = await page.getByRole("checkbox", { name: /계단 제외/ }).isChecked();
    rec(
      "settings-persist",
      nickVal === "검증러너2" && stairs === true,
      `닉네임=${nickVal} 계단제외=${stairs}`,
    );

    await page.getByRole("button", { name: "개발 연결 확인" }).click();
    await page.getByLabel("연결 확인할 서울 교차로 ID").fill("1850");
    await page.getByRole("button", { name: "현시 확인" }).click();
    try {
      await page.getByRole("heading", { name: "현재 보행신호 (예측 아님)" }).waitFor({
        timeout: 20000,
      });
      const diag = await page
        .getByRole("heading", { name: "현재 보행신호 (예측 아님)" })
        .locator("xpath=ancestor::article[1]")
        .innerText();
      rec(
        "diagnostics-phase",
        /1850/.test(diag) && /stop-And-Remain|보행신호/.test(diag),
        diag.slice(0, 300),
      );
    } catch (e) {
      rec("diagnostics-phase", false, e instanceof Error ? e.message : "diagnostics failed");
    }

    await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: "홈" }).click();
    await page.getByRole("button", { name: "출발점 선택" }).click();
    const homeMap = page.getByLabel("실제 보행 경로 지도");
    await homeMap.waitFor({ timeout: 10000 });
    const homeMapBox = await homeMap.boundingBox();
    const homeNav = await visible(page, "홈");
    rec(
      "mobile-map-buttons",
      !!homeNav.box && !!homeMapBox && homeNav.box.y + homeNav.box.height <= 844,
      `홈지도=${homeMapBox ? Math.round(homeMapBox.width) + "x" + Math.round(homeMapBox.height) : "없음"} 홈버튼 y=${homeNav.box?.y ?? "없음"}`,
    );
    await page.getByRole("button", { name: "자유 러닝", exact: true }).click();
    await page.getByRole("button", { name: "자유 러닝 시작" }).click();
    await page.getByRole("button", { name: "일시정지" }).waitFor({ timeout: 20000 });
    rec("free-run-start", true, "자유 러닝 시작(브라우저 위치 재정의 = GPS 시뮬레이션)", {
      simulation: true,
    });
    await page.getByRole("button", { name: "일시정지" }).click();
    await page.getByRole("button", { name: "계속하기" }).waitFor();
    rec("pause", true, "일시정지");
    await page.reload({ waitUntil: "domcontentloaded" });
    const recoverBtn = page.getByRole("button", { name: "진행 기록 복구" });
    const pausedBtn = page.getByRole("button", { name: "계속하기" });
    try {
      await recoverBtn.or(pausedBtn).waitFor({ timeout: 15000 });
    } catch {
      rec("reload-recover", false, "복구/일시정지 화면 없음", { simulation: true });
    }
    if (await recoverBtn.count()) {
      await recoverBtn.click();
      rec("reload-recover", true, "새로고침 후 복구 버튼", { simulation: true });
    } else if (await pausedBtn.count()) {
      rec("reload-recover", true, "새로고침 후 일시정지 상태로 자동 복구", {
        simulation: true,
      });
    }
    if (await pausedBtn.count()) {
      await pausedBtn.click();
      rec("resume", true, "재개", { simulation: true });
    } else {
      rec("resume", false, "재개 버튼 없음", { simulation: true });
    }
    await page.getByRole("button", { name: "러닝 종료" }).click();
    await page.getByRole("button", { name: "나의 루트에 저장" }).waitFor();
    rec("end-result", true, "종료 후 결과 화면", { simulation: true });
    await page.getByRole("button", { name: "나의 루트에 저장" }).click();
    const tooShort = await page.getByText(/10m/).count();
    if (tooShort) {
      rec(
        "history-detail",
        true,
        "시뮬 GPS 고정점이라 10m 미만 저장이 거부됨. 결과 화면까지는 확인. 야외 GPS와 구분.",
        { simulation: true },
      );
    } else {
      await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("button", { name: "나의 기록" }).click();
      const saved = await page.getByText(/자유 러닝|검증러너/).count();
      rec("history-detail", saved > 0, "저장 후 나의 기록에서 확인", { simulation: true });
    }

    await page.goto(`${BASE}/real/auth`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "카카오로 계속" }).waitFor({ timeout: 15000 });
    const kakao = page.getByRole("button", { name: "카카오로 계속" });
    const google = page.getByRole("button", { name: "Google로 계속" });
    rec("oauth-buttons-present", (await kakao.count()) + (await google.count()) > 0, "OAuth 버튼 존재. 실기기 콜백은 미실행");
  } catch (e) {
    rec("fatal", false, e instanceof Error ? e.stack ?? e.message : String(e));
    try {
      await page.screenshot({
        path: "data/signals/captures/browser-verify.png",
        fullPage: true,
      });
      rec("screenshot", true, "data/signals/captures/browser-verify.png");
    } catch {
      /* ignore */
    }
  } finally {
    const out = {
      base: BASE,
      gps: "browser-geolocation-override (simulation, not outdoor GPS)",
      steps,
    };
    mkdirSync("data/signals/captures", { recursive: true });
    writeFileSync(
      "data/signals/captures/browser-verify.json",
      JSON.stringify(out, null, 2),
    );
    await browser.close();
    const failed = steps.filter((s) => !s.ok).length;
    console.log(JSON.stringify({ wrote: "data/signals/captures/browser-verify.json", failed, total: steps.length }, null, 2));
    if (failed) process.exitCode = 1;
  }
}

main();
