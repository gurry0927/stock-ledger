import fs from "node:fs/promises";
import vm from "node:vm";

const TWSE_URL = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL";
const TPEX_URL = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

async function readJson(file, url) {
  if (file) return JSON.parse(await fs.readFile(file, "utf8"));
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} 回傳 HTTP ${response.status}`);
  return response.json();
}

function rocDate(value) {
  const text = String(value || "").replace(/\D/g, "");
  if (text.length !== 7) return "";
  const year = Number(text.slice(0, 3)) + 1911;
  return `${year}-${text.slice(3, 5)}-${text.slice(5, 7)}`;
}

const root = new URL("../", import.meta.url);
const stockSource = await fs.readFile(new URL("stocks.js", root), "utf8");
const sandbox = { window: {} };
vm.runInNewContext(stockSource, sandbox, { filename: "stocks.js" });
const allowed = new Set((sandbox.window.TW_STOCKS || []).map((item) => String(item.code).toUpperCase()));

const [twseRows, tpexRows] = await Promise.all([
  readJson(option("--twse"), TWSE_URL),
  readJson(option("--tpex"), TPEX_URL)
]);

const prices = new Map();
const dates = { twse: "", tpex: "" };
for (const row of twseRows) {
  const code = String(row.Code || "").trim().toUpperCase();
  const price = Number(String(row.ClosingPrice || "").replace(/,/g, ""));
  const date = rocDate(row.Date);
  if (date > dates.twse) dates.twse = date;
  if (allowed.has(code) && Number.isFinite(price) && price > 0) prices.set(code, price);
}
for (const row of tpexRows) {
  const code = String(row.SecuritiesCompanyCode || "").trim().toUpperCase();
  const price = Number(String(row.Close || "").replace(/,/g, "").trim());
  const date = rocDate(row.Date);
  if (date > dates.tpex) dates.tpex = date;
  if (allowed.has(code) && Number.isFinite(price) && price > 0) prices.set(code, price);
}

if (prices.size < 500 || !dates.twse || !dates.tpex) throw new Error("官方行情筆數或日期不完整，停止覆寫行情檔");
const sortedPrices = Object.fromEntries([...prices.entries()].sort(([a], [b]) => a.localeCompare(b, "en")));
const payload = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  marketDate: [dates.twse, dates.tpex].sort().at(-1),
  marketDates: dates,
  count: prices.size,
  prices: sortedPrices
};
const json = JSON.stringify(payload);
await fs.writeFile(new URL("prices.json", root), json + "\n");
await fs.writeFile(new URL("prices.js", root), `// 由 tools/update-prices.mjs 產生；勿手動編輯。\nwindow.TW_CLOSE_PRICES=${json};\n`);
console.log(`行情已更新：${payload.marketDate}，${payload.count} 檔`);
