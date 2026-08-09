"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

require("../scripts/config.js");
require("../scripts/calculator.js");

const { Calculator, Config, Utils } = globalThis.StockLedger;
const settings = { ...Config.DEFAULT_SETTINGS };

function trade(overrides) {
  return {
    date: "2026-08-08",
    type: "sell",
    assetType: "stock",
    isLeveragedOrInverse: false,
    isDayTrade: false,
    price: 100,
    shares: 1000,
    commissionActual: null,
    taxActual: null,
    ...overrides
  };
}

test("整股買進只收手續費", () => {
  const result = Calculator.calculateTransaction(trade({ type: "buy" }), settings);
  assert.equal(result.gross, 100000);
  assert.equal(result.commission.charged, 86);
  assert.equal(result.tax.charged, 0);
  assert.equal(result.net, 100086);
});

test("股票一般賣出收手續費與 0.3% 證交稅", () => {
  const result = Calculator.calculateTransaction(trade(), settings);
  assert.equal(result.commission.charged, 86);
  assert.equal(result.tax.charged, 300);
  assert.equal(result.net, 99614);
});

test("適用期間內的現股當沖稅率為 0.15%", () => {
  const result = Calculator.calculateTransaction(trade({ isDayTrade: true }), settings);
  assert.equal(result.tax.ruleId, "stock-day-trade-0.15pct");
  assert.equal(result.tax.charged, 150);
  assert.equal(result.net, 99764);
});

test("現股當沖優惠期限後回到股票一般稅率", () => {
  const result = Calculator.calculateTransaction(trade({ date: "2028-01-01", isDayTrade: true }), settings);
  assert.equal(result.tax.ruleId, "stock-sell-0.3pct");
  assert.equal(result.tax.charged, 300);
});

test("一般 ETF 賣出稅率為 0.1%", () => {
  const result = Calculator.calculateTransaction(trade({ assetType: "etf" }), settings);
  assert.equal(result.tax.charged, 100);
});

test("合格債券 ETF 在 2026 年免稅，期限後回到 ETF 稅率", () => {
  const exempt = Calculator.calculateTransaction(trade({ assetType: "bond_etf" }), settings);
  const expired = Calculator.calculateTransaction(trade({ date: "2027-01-01", assetType: "bond_etf" }), settings);
  assert.equal(exempt.tax.ruleId, "bond-etf-exempt");
  assert.equal(exempt.tax.charged, 0);
  assert.equal(expired.tax.charged, 100);
});

test("槓桿或反向債券 ETF 不套用免稅", () => {
  const result = Calculator.calculateTransaction(trade({ assetType: "bond_etf", isLeveragedOrInverse: true }), settings);
  assert.equal(result.tax.charged, 100);
});

test("零股與整股各自套用每筆最低手續費", () => {
  const odd = Calculator.calculateTransaction(trade({ type: "buy", price: 1, shares: 999 }), settings);
  const regular = Calculator.calculateTransaction(trade({ type: "buy", price: 1, shares: 1000 }), settings);
  assert.equal(odd.lotType, "odd");
  assert.equal(odd.commission.charged, 1);
  assert.equal(regular.lotType, "regular");
  assert.equal(regular.commission.charged, 20);
});

test("實際對帳單費用可覆寫估算", () => {
  const result = Calculator.calculateTransaction(trade({ commissionActual: 5, taxActual: 7 }), settings);
  assert.equal(result.commission.charged, 5);
  assert.equal(result.tax.charged, 7);
  assert.equal(result.net, 99988);
});

test("非買賣類型不收手續費與證交稅", () => {
  const result = Calculator.calculateTransaction(trade({ type: "dividend", price: 2.5, shares: 1000, taxActual: 99 }), settings);
  assert.equal(result.gross, 2500);
  assert.equal(result.commission.charged, 0);
  assert.equal(result.tax.charged, 0);
  assert.equal(result.tax.actual, null);
  assert.equal(result.net, 2500);
});

test("已保存的費用快照不受新設定影響", () => {
  const original = Calculator.calculateTransaction(trade(), settings);
  const record = { ...trade(), ...Calculator.snapshot(original, settings) };
  const stored = Calculator.storedOrEstimated(record, { ...settings, feeDiscount: 10, regularMinFee: 500 });
  assert.equal(stored.net, 99614);
  assert.equal(stored.legacy, false);
});

test("費用合計溢位時會被安全檢查拒絕", () => {
  const result = Calculator.calculateTransaction(trade({
    price: 1,
    shares: 1,
    commissionActual: Number.MAX_VALUE,
    taxActual: Number.MAX_VALUE
  }), settings);
  assert.equal(result.net, -Infinity);
  assert.equal(Calculator.isSafeCalculation(result), false);
});

test("本地日期不會在台灣凌晨退回 UTC 前一天", () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = "Asia/Taipei";
  try {
    const taipeiMorning = new Date("2026-08-08T23:30:00.000Z");
    assert.equal(Utils.localDateString(taipeiMorning), "2026-08-09");
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});
