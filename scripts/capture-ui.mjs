import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const chrome =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const outDir = path.resolve("captures");
mkdirSync(outDir, { recursive: true });

async function main() {
  let puppeteer;
  try {
    puppeteer = require("puppeteer-core");
  } catch {
    console.log("puppeteer-core missing");
    process.exit(2);
  }

  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    defaultViewport: { width: 424, height: 946, deviceScaleFactor: 2 },
    args: ["--hide-scrollbars", "--disable-gpu"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  await page.goto("http://127.0.0.1:5173/welcome", { waitUntil: "domcontentloaded" });

  const demo = await page.$("button::-p-text(데모로 체험하기)");
  if (demo) await demo.click();
  else {
    const buttons = await page.$$("button");
    for (const b of buttons) {
      const t = await page.evaluate((el) => el.textContent, b);
      if (t?.includes("데모로 체험하기")) {
        await b.click();
        break;
      }
    }
  }
  await sleep(800);

  if (page.url().includes("region")) {
    const seoul = await findButton(page, "서울");
    if (seoul) await seoul.click();
    await sleep(300);
  }
  if (page.url().includes("nickname")) {
    await page.waitForSelector("input");
    await page.click("input", { clickCount: 3 });
    await page.type("input", "지환");
    const start = await findButton(page, "시작하기");
    if (start) await start.click();
    await sleep(400);
  }

  await page.goto("http://127.0.0.1:5173/home", { waitUntil: "domcontentloaded" });
  await sleep(700);
  await page.screenshot({ path: path.join(outDir, "home-424.png") });

  const findRoute = await findButton(page, "루트 찾기");
  if (findRoute) {
    await findRoute.click();
    await sleep(1600);
    if (page.url().includes("/recommend") || page.url().includes("/loading")) {
      await page.waitForFunction(() => location.pathname.includes("/recommend"), { timeout: 8000 }).catch(() => undefined);
      await sleep(400);
      await page.screenshot({ path: path.join(outDir, "recommend-424.png") });
      const go = await findButton(page, "이 루트로 시작");
      if (go) await go.click();
      await sleep(700);
      await page.screenshot({ path: path.join(outDir, "run-424.png") });
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
      await page.goto("http://127.0.0.1:5173/home", { waitUntil: "domcontentloaded" });
      await sleep(400);
      await page.screenshot({ path: path.join(outDir, "home-390.png") });
      await page.setViewport({ width: 360, height: 800, deviceScaleFactor: 2 });
      await page.goto("http://127.0.0.1:5173/home", { waitUntil: "domcontentloaded" });
      await sleep(400);
      await page.screenshot({ path: path.join(outDir, "home-360.png") });
      await browser.close();
      console.log("captured-via-find", outDir);
      return;
    }
  }

  const card = await page.$(".preview-card");
  if (card) await card.click();
  await sleep(700);
  await page.screenshot({ path: path.join(outDir, "popular-424.png") });
  console.log("after-card", page.url());
  console.log(
    "body",
    await page.evaluate(() => document.body.innerText.slice(0, 400)),
  );
  console.log(
    "buttons",
    await page.evaluate(() =>
      [...document.querySelectorAll("button")].map((b) => b.textContent?.trim()),
    ),
  );
  const review = await findButton(page, "내 페이스로");
  console.log("review", Boolean(review));
  if (review) await review.click();
  await sleep(1600);
  await page.screenshot({ path: path.join(outDir, "after-review-424.png") });
  console.log("after-review", page.url());
  if (!page.url().includes("/recommend")) {
    await page.waitForFunction(() => location.pathname.includes("/recommend"), { timeout: 8000 }).catch(() => undefined);
  }
  await sleep(400);
  await page.screenshot({ path: path.join(outDir, "recommend-424.png") });

  const go = await findButton(page, "이 루트로 시작");
  console.log("start-btn", Boolean(go), page.url());
  if (go) await go.click();
  await sleep(800);
  await page.screenshot({ path: path.join(outDir, "run-424.png") });
  console.log("after-start", page.url());

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto("http://127.0.0.1:5173/home", { waitUntil: "domcontentloaded" });
  await sleep(400);
  await page.screenshot({ path: path.join(outDir, "home-390.png") });

  await page.setViewport({ width: 360, height: 800, deviceScaleFactor: 2 });
  await page.goto("http://127.0.0.1:5173/home", { waitUntil: "domcontentloaded" });
  await sleep(400);
  await page.screenshot({ path: path.join(outDir, "home-360.png") });

  await browser.close();
  spawn;
  console.log("captured", outDir);
}

async function findButton(page, text) {
  const buttons = await page.$$("button");
  for (const b of buttons) {
    const t = await page.evaluate((el) => el.textContent, b);
    if (t && t.includes(text)) return b;
  }
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
