"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

require("../scripts/config.js");
require("../scripts/calculator.js");
require("../scripts/portfolio.js");
require("../scripts/ledger-model.js");

const { Calculator, Config, Portfolio, LedgerModel } = globalThis.StockLedger;
const settings = { ...Config.DEFAULT_SETTINGS };

function saved(id, date, type, code, name, price, shares) {
  const record = {
    id, date, type, stockCode: code, stockName: name, assetType: code === "0050" ? "etf" : "stock",
    isLeveragedOrInverse: false, isDayTrade: false, price, shares, commissionActual: null, taxActual: null,
    createdAt: `${date}T00:00:00.000Z`
  };
  return { ...record, ...Calculator.snapshot(Calculator.calculateTransaction(record, settings), settings) };
}

test("個股索引保留多輪資料並讓個股流水由新到舊排列", () => {
  const records = [
    saved("a1", "2026-01-01", "buy", "2330", "台積電", 100, 1000),
    saved("a2", "2026-02-01", "sell", "2330", "台積電", 110, 1000),
    saved("a3", "2026-03-01", "buy", "2330", "台積電", 80, 500),
    saved("b1", "2026-01-15", "buy", "0050", "元大台灣50", 50, 10),
    saved("b2", "2026-02-15", "sell", "0050", "元大台灣50", 55, 10)
  ];
  const portfolio = Portfolio.calculate(records, settings);
  const index = LedgerModel.build(records, portfolio);

  assert.deepEqual(index.stocks.map((stock) => stock.stockCode), ["2330", "0050"]);
  assert.equal(LedgerModel.stockFor(index, "2330").cycles.length, 2);
  assert.equal(LedgerModel.stockFor(index, "2330").currentCycle.cycleNumber, 2);
  assert.equal(LedgerModel.stockFor(index, "0050").currentCycle, null);
  assert.deepEqual(LedgerModel.recordsFor(index, "2330").map((record) => record.id), ["a3", "a2", "a1"]);
});

test("搜尋與類型篩選不會改動原始索引", () => {
  const records = [
    saved("a1", "2026-01-01", "buy", "2330", "台積電", 100, 1000),
    saved("b1", "2026-01-15", "sell", "0050", "元大台灣50", 50, 10)
  ];
  const index = LedgerModel.build(records, Portfolio.calculate(records, settings));
  assert.deepEqual(LedgerModel.filterStocks(index.stocks, "台積").map((stock) => stock.stockCode), ["2330"]);
  assert.deepEqual(LedgerModel.filterRecords(records, "", "sell").map((record) => record.id), ["b1"]);
  assert.equal(index.stocks.length, 2);
  assert.equal(records.length, 2);
});

test("只有異常流水的代號仍會留在個股索引等待檢查", () => {
  const broken = [{ id: "bad", date: "", type: "buy", stockCode: "BAD", stockName: "異常資料" }];
  const index = LedgerModel.build(broken, { stocks: [] });
  const stock = LedgerModel.stockFor(index, "bad");
  assert.equal(stock.unavailable, true);
  assert.equal(stock.recordCount, 1);
  assert.match(stock.warnings[0].message, /格式異常/);
});
