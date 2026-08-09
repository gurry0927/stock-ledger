"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

let savedCache = null;
globalThis.StockLedger = {
  Storage: {
    async getMarketCache() { return savedCache; },
    async putMarketCache(value) { savedCache = value; }
  }
};
globalThis.location = { protocol: "file:" };
globalThis.TW_CLOSE_PRICES = {
  schemaVersion: 1,
  generatedAt: "2026-08-08T01:00:00.000Z",
  marketDate: "2026-08-07",
  prices: { "0050": 100, "2330": 2000 }
};

require("../scripts/market-data.js");
const { MarketData } = globalThis.StockLedger;

test("行情格式會過濾無效價格並拒絕不完整資料", () => {
  const valid = MarketData.normalizePayload({
    schemaVersion: 1,
    marketDate: "2026-08-07",
    prices: { "0050": "100.5", bad: 0, nan: "--" }
  }, 1);
  assert.deepEqual(valid.prices, { "0050": 100.5 });
  assert.equal(MarketData.normalizePayload({ schemaVersion: 1, marketDate: "08/07", prices: { "0050": 100 } }, 1), null);
  assert.equal(MarketData.normalizePayload({ schemaVersion: 1, marketDate: "2026-08-07", prices: { "0050": 100 } }, 2), null);
});

test("file 模式只用內建快照；HTTPS 每日只檢查一次且失敗沿用快取", async () => {
  let fetchCount = 0;
  const remotePrices = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [String(1000 + index), index + 1]));
  remotePrices["0050"] = 101;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return {
      ok: true,
      async json() {
        return {
          schemaVersion: 1,
          generatedAt: "2026-08-09T01:00:00.000Z",
          marketDate: "2026-08-08",
          prices: remotePrices
        };
      }
    };
  };

  const local = await MarketData.initialize(false);
  assert.equal(local.source, "bundled");
  assert.equal(local.canRefresh, false);
  assert.equal(MarketData.priceFor("2330"), 2000);
  assert.equal(fetchCount, 0);

  globalThis.location.protocol = "https:";
  const refreshed = await MarketData.initialize(false);
  assert.equal(refreshed.source, "network");
  assert.equal(refreshed.marketDate, "2026-08-08");
  assert.equal(MarketData.priceFor("0050"), 101);
  assert.equal(fetchCount, 1);

  await MarketData.initialize(false);
  assert.equal(fetchCount, 1, "同一台北日期不應再次自動抓取");

  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("offline");
  };
  const stale = await MarketData.initialize(true);
  assert.equal(stale.status, "stale");
  assert.equal(stale.marketDate, "2026-08-08");
  assert.equal(MarketData.priceFor("0050"), 101);
  assert.equal(fetchCount, 2);
});
