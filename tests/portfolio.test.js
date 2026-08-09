"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

require("../scripts/config.js");
require("../scripts/calculator.js");
require("../scripts/portfolio.js");

const { Calculator, Config, Portfolio } = globalThis.StockLedger;
const settings = { ...Config.DEFAULT_SETTINGS };

function record(id, date, type, price, shares, extra) {
  const value = {
    id,
    date,
    type,
    stockCode: "2330",
    stockName: "台積電",
    assetType: "stock",
    isLeveragedOrInverse: false,
    isDayTrade: false,
    price,
    shares,
    commissionActual: null,
    taxActual: null,
    createdAt: `${date}T00:00:${String(id).replace(/\D/g, "").padStart(2, "0")}Z`,
    ...extra
  };
  const calculation = Calculator.calculateTransaction(value, settings);
  return { ...value, ...Calculator.snapshot(calculation, settings) };
}

test("部分獲利與虧損賣出分別計算，清倉後結束第一輪", () => {
  const result = Portfolio.calculate([
    record("1", "2026-01-10", "buy", 100, 1000),
    record("2", "2026-02-10", "dividend", 5, 1000),
    record("3", "2026-03-10", "sell", 120, 400),
    record("4", "2026-04-10", "sell", 90, 600)
  ], settings);

  assert.equal(result.positions.length, 0);
  assert.equal(result.closedCycles.length, 1);
  const cycle = result.closedCycles[0];
  assert.equal(cycle.cycleNumber, 1);
  assert.equal(cycle.dividends, 5000);
  assert.ok(Math.abs(cycle.realizedTradingPnl - 1521) < 0.000001);
  assert.equal(cycle.totalReturn, 6521);
});

test("部分賣出後帳面平均成本不變，回本成本會納入賣出收入與配息", () => {
  const result = Portfolio.calculate([
    record("1", "2026-01-10", "buy", 100, 1000),
    record("2", "2026-02-10", "dividend", 5, 1000, { cashReceivedActual: 4800 }),
    record("3", "2026-03-10", "sell", 120, 400)
  ], settings);

  const position = result.positions[0];
  assert.equal(position.shares, 600);
  assert.ok(Math.abs(position.averageBookCost - 100.086) < 0.000001);
  assert.ok(Math.abs(position.recoveryCost - 47471) < 0.000001);
  assert.ok(Math.abs(position.averageRecoveryCost - 79.11833333333334) < 0.000001);
  assert.ok(position.realizedTradingPnl > 0);
});

test("清倉後再次買進會建立第二輪，上一輪損益不帶入新成本", () => {
  const result = Portfolio.calculate([
    record("1", "2026-01-01", "buy", 100, 1000),
    record("2", "2026-02-01", "sell", 110, 1000),
    record("3", "2026-03-01", "buy", 80, 500)
  ], settings);

  assert.equal(result.closedCycles.length, 1);
  assert.equal(result.positions.length, 1);
  assert.equal(result.positions[0].cycleNumber, 2);
  assert.equal(result.positions[0].shares, 500);
  assert.equal(result.positions[0].recoveryCost, result.positions[0].buyOutflows);
  assert.equal(result.positions[0].completedCycles, 1);
  assert.equal(result.stocks.length, 1);
  assert.equal(result.stocks[0].cycles.length, 2);
  assert.equal(result.stocks[0].currentCycle.cycleNumber, 2);
  assert.equal(result.stocks[0].completedCycles, 1);
  assert.equal(result.stocks[0].recordCount, 3);
});

test("清倉後才記錄的配息仍歸入最近結束輪次", () => {
  const result = Portfolio.calculate([
    record("1", "2026-01-01", "buy", 100, 1000),
    record("2", "2026-02-01", "sell", 100, 1000),
    record("3", "2026-03-01", "dividend", 2, 1000)
  ], settings);
  assert.equal(result.closedCycles[0].dividends, 2000);
  assert.equal(result.closedCycles[0].totalReturn, 1528);
});

test("配股與分割只改股數，不改總成本", () => {
  const result = Portfolio.calculate([
    record("1", "2026-01-01", "buy", 100, 1000),
    record("2", "2026-02-01", "stockDividend", 0.1, 1000),
    record("3", "2026-03-01", "split", 2, 1100)
  ], settings);
  const position = result.positions[0];
  assert.equal(position.shares, 2200);
  assert.equal(position.bookCost, 100086);
  assert.ok(Math.abs(position.averageBookCost - 45.49363636363636) < 0.000001);
});

test("現金減資降低股數與回本成本，虧損減資只降低股數", () => {
  const result = Portfolio.calculate([
    record("1", "2026-01-01", "buy", 100, 1000),
    record("2", "2026-02-01", "reduction", 1, 1000, {
      reductionKind: "cash", reducedShares: 100, cashReceivedActual: 1200
    }),
    record("3", "2026-03-01", "reduction", 0, 900, {
      reductionKind: "loss", reducedShares: 100
    })
  ], settings);
  const position = result.positions[0];
  assert.equal(position.shares, 800);
  assert.equal(position.recoveryCost, 98886);
  assert.equal(position.bookCost, 98886);
  assert.equal(position.capitalReturns, 1200);
});

test("賣出超過持股只產生警告，不讓持股變成負數", () => {
  const result = Portfolio.calculate([
    record("1", "2026-01-01", "buy", 100, 100),
    record("2", "2026-02-01", "sell", 100, 101)
  ], settings);
  assert.equal(result.positions[0].shares, 100);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0].message, /超過當時持有/);
});
