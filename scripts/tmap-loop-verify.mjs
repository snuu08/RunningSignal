import { chromium } from "playwright-core";

const BASE = process.env.VERIFY_BASE ?? "https://snuu08-runningsignal.netlify.app";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  geolocation: { latitude: 37.5665, longitude: 126.978 },
  permissions: ["geolocation"],
  locale: "ko-KR",
});
const page = await context.newPage();
const result = { base: BASE, ok: false, detail: "" };

try {
  await page.goto(`${BASE}/real/home`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "계정 없이 기기에 기록하기" })
    .or(page.getByPlaceholder("2~20자"))
    .or(page.getByRole("heading", { name: /오늘의 러닝/ }))
    .first()
    .waitFor({ timeout: 20000 });
  const guest = page.getByRole("button", { name: "계정 없이 기기에 기록하기" });
  if (await guest.count()) await guest.click();
  const nick = page.getByPlaceholder("2~20자");
  if (await nick.count()) {
    await nick.fill("왕복검증");
    const dist = page.getByLabel("온보딩 계산 거리 km");
    if (await dist.count()) {
      await dist.fill("5");
      await page.getByLabel("온보딩 계산 분").fill("25");
      await page.getByRole("button", { name: "거리·시간으로 페이스 넣기" }).click();
    }
    await page.getByRole("button", { name: "시작하기" }).click();
  }
  await page.getByRole("heading", { name: /오늘의 러닝/ }).waitFor();
  await page.getByRole("button", { name: "현재 위치" }).click();
  for (let i = 0; i < 24; i++) {
    if (await page.getByRole("combobox", { name: "출발지" }).inputValue()) break;
    await page.waitForTimeout(250);
  }
  await page.getByRole("combobox", { name: "목적지" }).fill("덕수궁");
  await page.locator(".place-results button").first().waitFor({ timeout: 15000 });
  await page.locator(".place-results button").first().click();
  await page.getByRole("checkbox", { name: "출발지로 돌아오기" }).check();
  await page.getByRole("button", { name: "러닝 경로 찾기" }).click();
  await page.waitForURL(/\/real\/recommend/, { timeout: 40000 });
  await page.getByRole("heading", { name: /오늘의 경로가 준비됐어요/ }).waitFor();
  const recText = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  const loopName = /→ 출발지/.test(recText);
  const stairs = /계단 제외|보행 km/.test(recText);
  result.ok = loopName && stairs;
  result.detail = recText.slice(0, 280);
  result.loopName = loopName;
  result.predictionOff = /신호 대기는 포함하지 않습니다/.test(recText);
} catch (e) {
  result.detail = e instanceof Error ? e.message : String(e);
} finally {
  await browser.close();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
