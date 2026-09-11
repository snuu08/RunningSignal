import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.env.VERIFY_BASE ?? "http://127.0.0.1:5176";
const steps = [];

function rec(id, ok, detail, extra = {}) {
  steps.push({ id, ok, detail, ...extra, at: Date.now() });
  console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${detail}`);
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
  context.setDefaultTimeout(25000);
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept());

  const routesCalls = [];
  page.on("response", async (res) => {
    if (!res.url().includes("/api/routes")) return;
    let error = null;
    let routeCount = null;
    let predictionReady = null;
    try {
      const body = await res.json();
      error = typeof body.error === "string" ? body.error : null;
      routeCount = Array.isArray(body.routes) ? body.routes.length : 0;
      predictionReady = body.predictionReady ?? null;
    } catch {
      error = "non-json";
    }
    routesCalls.push({
      status: res.status(),
      error,
      routeCount,
      predictionReady,
    });
  });

  try {
    await page.goto(`${BASE}/real/home`, { waitUntil: "domcontentloaded" });
    await page
      .getByRole("button", { name: "계정 없이 기기에 기록하기" })
      .or(page.getByPlaceholder("2~20자"))
      .or(page.getByRole("heading", { name: /오늘 어디로/ }))
      .first()
      .waitFor({ timeout: 20000 });

    const guest = page.getByRole("button", { name: "계정 없이 기기에 기록하기" });
    if (await guest.count()) {
      await guest.click();
      rec("guest-entry", true, "게스트 진입");
    } else {
      rec("guest-entry", true, "이미 게스트/온보딩 이후");
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
      rec("onboarding", true, "온보딩 완료");
    } else {
      rec("onboarding", true, "온보딩 생략");
    }

    await page.getByRole("heading", { name: /오늘 어디로/ }).waitFor();
    await page.getByRole("button", { name: "현재 위치" }).click();
    let originVal = "";
    for (let i = 0; i < 24; i++) {
      originVal = await page.getByRole("textbox", { name: "출발지" }).inputValue();
      if (originVal) break;
      await page.waitForTimeout(250);
    }
    rec("origin-locate", originVal.length > 0, `출발지=${originVal}`, {
      simulation: true,
    });

    await page.getByRole("textbox", { name: "목적지" }).fill("덕수궁");
    await page.locator(".place-results button").first().waitFor({ timeout: 15000 });
    const placeName = await page.locator(".place-results button strong").first().innerText();
    await page.locator(".place-results button").first().click();
    rec("place-search", !!placeName, `목적지=${placeName}`);

    await page.getByRole("button", { name: "루트 찾기" }).click();
    await page.waitForURL(/\/real\/recommend/, { timeout: 40000 });
    await page.getByRole("heading", { name: /이 루트로/ }).waitFor({ timeout: 15000 });
    rec(
      "tmap-routes",
      true,
      `추천 화면 routeCalls=${JSON.stringify(routesCalls)}`,
    );

    const recText = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    rec(
      "recommend-copy",
      /이 루트로/.test(recText) && /보행 km/.test(recText),
      recText.slice(0, 280),
    );
    rec(
      "prediction-off",
      /신호 대기는 포함하지 않습니다/.test(recText) &&
        !/대기 포함 예상/.test(recText) &&
        !/확인된 대기/.test(recText),
      /신호 대기는 포함하지 않습니다/.test(recText)
        ? "대기 예측 UI 꺼짐"
        : "예측 문구 확인 실패",
    );

    await page.getByRole("button", { name: "예, 이 루트로 갈게요" }).click();
    await page.waitForURL(/\/real\/ready/, { timeout: 15000 });
    rec("ready", page.url().includes("ready"), `URL=${page.url()}`);

    await page.getByRole("button", { name: "러닝 시작" }).click();
    await page.waitForURL(/\/real\/run/, { timeout: 20000 });
    await page.getByRole("button", { name: "일시정지" }).waitFor({ timeout: 20000 });
    const runText = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    rec(
      "routed-run",
      /내 페이스로 달리는 중/.test(runText) && /남은 경로 km/.test(runText),
      runText.slice(0, 240),
      { simulation: true },
    );
    rec(
      "run-prediction-off",
      !/확인된 대기/.test(runText) && !/대기 포함/.test(runText),
      "러닝 화면에도 대기 예측 없음",
    );

    await page.getByRole("button", { name: "러닝 종료" }).click();
    await page.getByRole("button", { name: "나의 루트에 저장" }).waitFor();
    rec("end-result", page.url().includes("result"), `URL=${page.url()}`, {
      simulation: true,
    });
  } catch (e) {
    rec("fatal", false, e instanceof Error ? e.stack ?? e.message : String(e));
    try {
      mkdirSync("data/signals/captures", { recursive: true });
      await page.screenshot({
        path: "data/signals/captures/tmap-flow-verify.png",
        fullPage: true,
      });
      rec("screenshot", true, "data/signals/captures/tmap-flow-verify.png");
    } catch {
      /* ignore */
    }
  } finally {
    mkdirSync("data/signals/captures", { recursive: true });
    writeFileSync(
      "data/signals/captures/tmap-flow-verify.json",
      JSON.stringify({ base: BASE, routesCalls, steps }, null, 2),
    );
    await browser.close();
    const failed = steps.filter((s) => !s.ok).length;
    console.log(
      JSON.stringify(
        {
          wrote: "data/signals/captures/tmap-flow-verify.json",
          failed,
          total: steps.length,
          routesCalls,
        },
        null,
        2,
      ),
    );
    if (failed) process.exitCode = 1;
  }
}

main();
