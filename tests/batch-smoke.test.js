"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

require("../scripts/config.js");
require("../scripts/calculator.js");
require("../scripts/csv.js");

const { Calculator, Config, Csv } = globalThis.StockLedger;
const settings = { ...Config.DEFAULT_SETTINGS };

function savedRecord(index, input) {
  const base = {
    id: `SMOKE-${String(index).padStart(2, "0")}`,
    date: "2026-08-09",
    type: "buy",
    stockCode: "2330",
    stockName: "SMOKE 台積電",
    market: "上市",
    assetType: "stock",
    isLeveragedOrInverse: false,
    isDayTrade: false,
    price: 100,
    shares: 1000,
    notes: "SMOKE 隔離測試資料",
    commissionActual: null,
    taxActual: null,
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    ...input
  };
  const result = Calculator.calculateTransaction(base, settings);
  return { ...base, ...Calculator.snapshot(result, settings) };
}

test("13 筆常見與邊界交易可計算、快照、CSV 匯出再匯入", () => {
  const batch = [
    savedRecord(1, { type: "buy" }),
    savedRecord(2, { type: "sell" }),
    savedRecord(3, { type: "sell", isDayTrade: true }),
    savedRecord(4, { stockCode: "0050", stockName: "SMOKE 元大台灣50", assetType: "etf", price: 52.35, shares: 100 }),
    savedRecord(5, { type: "sell", stockCode: "0056", stockName: "SMOKE 元大高股息", assetType: "etf", price: 40.12, shares: 1000 }),
    savedRecord(6, { type: "sell", stockCode: "00679B", stockName: "SMOKE 元大美債20年", assetType: "bond_etf", price: 28.5, shares: 1000 }),
    savedRecord(7, { date: "2027-01-01", type: "sell", stockCode: "00679B", stockName: "SMOKE 元大美債20年", assetType: "bond_etf", price: 28.5, shares: 1000 }),
    savedRecord(8, { price: 1, shares: 999 }),
    savedRecord(9, { type: "dividend", price: 2.5, shares: 1000 }),
    savedRecord(10, { type: "stockDividend", price: 0.1, shares: 1000 }),
    savedRecord(11, { type: "reduction", price: 1.2, shares: 1000 }),
    savedRecord(12, { type: "split", price: 2, shares: 1000 }),
    savedRecord(13, { type: "sell", price: 0.01, shares: 1, commissionActual: 1, taxActual: 0 })
  ];

  const restored = Csv.parse(Csv.create(batch, settings));
  assert.equal(restored.records.length, 13);
  assert.deepEqual(restored.records.map((record) => record.id), batch.map((record) => record.id));
  assert.deepEqual(restored.records.map((record) => record.netAmount), batch.map((record) => record.netAmount));
  assert.equal(restored.records.find((record) => record.id === "SMOKE-06").taxEstimated, 0);
  assert.equal(restored.records.find((record) => record.id === "SMOKE-07").taxEstimated, 29);
  assert.equal(restored.records.find((record) => record.id === "SMOKE-13").netAmount, -0.99);
});

