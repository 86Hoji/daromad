// Полный прогон демо в /app с записью видео (резерв для защиты: docs/demo.webm). См. docs/DEMO.md -> «Перезаписать видео».
// Нужны: бэкенд с DEMO_RESET=1 на :8000, `npm --prefix miniapp run dev` на :5173, playwright-core (npm i playwright-core
// в любой временной папке) и Chromium/Edge с CDP на :9333 и фейковым микрофоном:
//   msedge --headless=new --remote-debugging-port=9333 --use-fake-ui-for-media-stream --use-fake-device-for-media-stream
//          --use-file-for-fake-audio-capture=<repo>/docs/demo_assets/kim_menga_qarz.wav --autoplay-policy=no-user-gesture-required
// Запуск: node record_demo.mjs <outDir>
import { chromium } from "playwright-core";
const [, , out = "demo"] = process.argv;
const APP = "http://localhost:5173";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } });
await ctx.grantPermissions(["microphone"], { origin: APP });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
let n = 0;
const shot = async (name) => page.screenshot({ path: `${out}/${String(++n).padStart(2, "0")}-${name}.png` });
const free = async () => (await page.locator("main").first().innerText()).match(/[−-]?\d{1,3}(?: \d{3})+(?=\s*so'm)/)?.[0];

log("reset " + (await (await page.request.post("http://localhost:8000/api/demo/reset")).text()));
// вход на сайт: /login -> «Войти в демо» (токен сессии в localStorage)
await page.goto(`${APP}/login`, { timeout: 60000 });
await page.getByRole("button", { name: /Alisher Savdo/ }).click();
await page.waitForURL(/\/app/);
await page.waitForTimeout(4500);
await shot("start"); log("start free=" + (await free()));

async function say(text) {
  await page.getByRole("button", { name: "Matn bilan yozish" }).click();
  await page.waitForTimeout(500);
  await page.keyboard.type(text, { delay: 35 });
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "To'g'ri, saqlash" }).waitFor({ timeout: 120000 });
  await page.waitForTimeout(2600);
  await shot("cards");
  await page.getByRole("button", { name: "To'g'ri, saqlash" }).click();
  await page.waitForTimeout(4000);
}

// 1. голосом (тут — текстом в том же оверлее): расход -> нехватка в четверг растёт
await say("Bugun ijaraga 200 ming to'ladim");
await shot("shortage"); log("after expense free=" + (await free()));

// 2. напоминание должнику + SMS-превью
await page.getByRole("button", { name: "Eslatish" }).first().click();
await page.waitForTimeout(1800);
await shot("sms");
await page.locator('[role="dialog"]').getByRole("button", { name: "Eslatish" }).click();
await page.waitForTimeout(2200);
log("reminder sent");

// 3. оплата по ссылке
await page.goto(`${APP}/pay/demo`);
await page.waitForTimeout(2500);
await shot("pay");
await page.getByRole("button", { name: /To'lash/ }).click();
await page.waitForTimeout(3000);
await shot("paid");
await page.goto(`${APP}/app`);
await page.waitForTimeout(4000);

// 4. долг закрыт (пока без backend/extras — владелец подтверждает голосом)
await say("Jamshid 450 ming qarzini qaytardi");
await shot("debt-closed"); log("after debt free=" + (await free()));

// 5. овердрафт на остаток
await page.getByRole("button", { name: "Shartlarni ko'rish" }).first().click();
await page.waitForTimeout(2000);
await shot("overdraft");
await page.getByRole("button", { name: "Tasdiqlayman" }).click();
await page.waitForTimeout(4500);
await shot("overdraft-done"); log("after overdraft free=" + (await free()));

// 6. голосовой вопрос (фейковый микрофон = docs/demo_assets/kim_menga_qarz.wav) -> текст + голосовой ответ
await page.getByRole("button", { name: "Ovoz yozish" }).click();
await page.waitForTimeout(5800);
await shot("recording");
await page.getByRole("button", { name: "To'xtatish va yuborish" }).click();
await page.getByRole("button", { name: /Ovozni to'xtatish|Javobni eshitish/ }).waitFor({ timeout: 120000 });
log("answer shown; playing=" + (await page.getByRole("button", { name: "Ovozni to'xtatish" }).count()));
await page.waitForTimeout(2500);
await shot("answer");
await page.waitForTimeout(9000);
const vid = page.video();
await ctx.close();
log("VIDEO " + (await vid.path()));
process.exit(0);
