"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

require("../scripts/config.js");
require("../scripts/calculator.js");
require("../scripts/demo-data.js");
require("../scripts/portfolio.js");

const { Config, DemoData, Portfolio } = globalThis.StockLedger;
const settings = { ...Config.DEFAULT_SETTINGS };

test("示範資料 ID 唯一、計算安全並包含第二輪與特殊事件", () => {
  const records = DemoData.create(settings);
  assert.equal(records.length, DemoData.count);
  assert.equal(new Set(records.map((record) => record.id)).size, records.length);
  assert.ok(records.every(DemoData.isDemo));
  assert.ok(records.every((record) => Number.isFinite(record.netAmount)));
  assert.ok(records.some((record) => record.type === "stockDividend"));
  assert.ok(records.some((record) => record.type === "split"));
  assert.ok(records.some((record) => record.type === "reduction"));

  const portfolio = Portfolio.calculate(records, settings);
  const technology = portfolio.stocks.find((stock) => stock.stockCode === "DEMO2330");
  assert.equal(technology.cycles.length, 2);
  assert.equal(technology.completedCycles, 1);
  assert.equal(technology.currentCycle.cycleNumber, 2);
});

test("備份用篩選只排除保留前綴的示範資料", () => {
  const demo = DemoData.create(settings)[0];
  const real = { id: "real-record" };
  assert.deepEqual(DemoData.withoutDemo([demo, real]), [real]);
  assert.equal(DemoData.isDemo({ id: `${DemoData.ID_PREFIX}imported` }), true);
  assert.equal(DemoData.isDemo(real), false);
});

test("首次播種只發生在無狀態的空帳本，刪除後不會重生", () => {
  assert.equal(DemoData.autoSeedAction([], null), "seed");
  assert.equal(DemoData.autoSeedAction([{ id: "real" }], null), "skip");
  assert.equal(DemoData.autoSeedAction([], { status: "removed" }), "none");
  assert.equal(DemoData.autoSeedAction([], { status: "loaded" }), "none");
});
