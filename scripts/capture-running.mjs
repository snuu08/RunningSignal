import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  defaultViewport: { width: 424, height: 946, deviceScaleFactor: 2 },
  args: ["--hide-scrollbars"],
});
const page = await browser.newPage();
await page.goto("http://127.0.0.1:5173/welcome", { waitUntil: "domcontentloaded" });
const click = async (text) => {
  const buttons = await page.$$("button");
  for (const b of buttons) {
    const t = await page.evaluate((el) => el.textContent, b);
    if (t?.includes(text)) {
      await b.click();
      return true;
    }
  }
  return false;
};
await click("데모로 체험하기");
await new Promise((r) => setTimeout(r, 600));
if (page.url().includes("region")) {
  await click("서울");
  await new Promise((r) => setTimeout(r, 300));
}
if (page.url().includes("nickname")) {
  await page.waitForSelector("input");
  await page.type("input", "지환");
  await click("시작하기");
  await new Promise((r) => setTimeout(r, 400));
}
await page.goto("http://127.0.0.1:5173/home", { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 500));
const card = await page.$(".preview-card");
if (card) await card.click();
await new Promise((r) => setTimeout(r, 500));
await click("내 페이스로");
await page.waitForFunction(() => location.pathname.includes("/recommend"));
await new Promise((r) => setTimeout(r, 400));
await click("이 루트로 시작");
await page.waitForFunction(() => location.pathname.includes("/run"));
await new Promise((r) => setTimeout(r, 300));
await click("시작");
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({
  path: path.resolve("captures/run-running-424.png"),
});
await browser.close();
console.log("running captured");
