"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

require("../scripts/config.js");
require("../scripts/csv.js");

const { Csv } = globalThis.StockLedger;

function csv(headers, rows) {
  const cell = (value) => `"${String(value == null ? "" : value).replace(/"/g, '""')}"`;
  return [headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
}

const oldHeaders = [
  "row_type", "id", "date", "type", "stock_code", "stock_name", "price", "shares", "notes",
  "created_at", "fee_discount", "regular_min_fee", "odd_lot_min_fee"
];

test("可匯入舊版 CSV，且 0 折設定不會被改成預設值", () => {
  const text = csv(oldHeaders, [
    ["settings", "", "", "", "", "", "", "", "", "", 0, 20, 1],
    ["record", "old-1", "2026-08-08", "buy", "2330", "台積電", 100, 1000, "舊資料", "2026-08-08T00:00:00Z", "", "", ""]
  ]);
  const result = Csv.parse(text);
  assert.equal(result.settings.feeDiscount, 0);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].calculationVersion, undefined);
  assert.equal(result.records[0].assetType, undefined);
});

test("備註中的逗號、引號與換行可往返", () => {
  const settings = { feeDiscount: 6, regularMinFee: 20, oddLotMinFee: 1, feeRounding: "round" };
  const records = [{
    id: "roundtrip-1", date: "2026-08-08", type: "buy", stockCode: "0050", stockName: "元大台灣50",
    market: "上市ETF", assetType: "etf", isLeveragedOrInverse: false, lotType: "odd", isDayTrade: false,
    price: 50, shares: 10, notes: "逗號, \"引號\"\n第二行", createdAt: "2026-08-08T00:00:00Z",
    grossAmount: 500, commissionRate: 0.000855, commissionDiscount: 6, commissionMinimum: 1,
    commissionRounding: "round", commissionEstimated: 1, commissionActual: null, taxRate: 0,
    taxRuleId: "not-a-sale", taxEstimated: 0, taxActual: null, netAmount: 501, calculationVersion: 2,
    ruleVersion: "TW-2026-08"
  }];
  const result = Csv.parse(Csv.create(records, settings));
  assert.equal(result.records[0].notes, records[0].notes);
  assert.equal(result.records[0].netAmount, 501);
});

test("極小額賣出可能為負收入，快照仍可安全往返", () => {
  const settings = { feeDiscount: 6, regularMinFee: 20, oddLotMinFee: 1, feeRounding: "round" };
  const record = {
    id: "tiny-sale", date: "2026-08-08", type: "sell", stockCode: "2330", stockName: "台積電",
    market: "上市", assetType: "stock", isLeveragedOrInverse: false, lotType: "odd", isDayTrade: false,
    price: 0.01, shares: 1, notes: "", createdAt: "2026-08-08T00:00:00Z", grossAmount: 0.01,
    commissionRate: 0.000855, commissionDiscount: 6, commissionMinimum: 1, commissionRounding: "round",
    commissionEstimated: 1, commissionActual: null, taxRate: 0.003, taxRuleId: "stock-sell-0.3pct",
    taxEstimated: 0, taxActual: null, netAmount: -0.99, calculationVersion: 2, ruleVersion: "TW-2026-08"
  };
  const result = Csv.parse(Csv.create([record], settings));
  assert.equal(result.records[0].netAmount, -0.99);
});

test("實收配息與減資欄位可在 CSV v4 往返", () => {
  const settings = { feeDiscount: 6, regularMinFee: 20, oddLotMinFee: 1, feeRounding: "round" };
  const record = {
    id: "reduction-v3", date: "2026-08-09", type: "reduction", stockCode: "2330", stockName: "台積電",
    market: "上市", assetType: "stock", isLeveragedOrInverse: false, lotType: "regular", isDayTrade: false,
    price: 1, shares: 1000, cashReceivedActual: 980, reductionKind: "cash", reducedShares: 100,
    notes: "", createdAt: "2026-08-09T00:00:00Z", grossAmount: 1000, commissionRate: 0,
    commissionDiscount: 6, commissionMinimum: 0, commissionRounding: "round", commissionEstimated: 0,
    commissionActual: null, taxRate: 0, taxRuleId: "not-a-sale", taxEstimated: 0, taxActual: null,
    netAmount: 1000, calculationVersion: 2, ruleVersion: "TW-2026-08"
  };
  const result = Csv.parse(Csv.create([record], settings));
  assert.equal(result.records[0].cashReceivedActual, 980);
  assert.equal(result.records[0].reductionKind, "cash");
  assert.equal(result.records[0].reducedShares, 100);
});

test("公式外觀文字會安全匯出並可逐字還原", () => {
  const settings = { feeDiscount: 6, regularMinFee: 20, oddLotMinFee: 1, feeRounding: "round" };
  const record = {
    id: "+backup-id", date: "2026-08-09", type: "buy", stockCode: "=0050", stockName: "@測試名稱",
    market: "-自訂", assetType: "etf", isLeveragedOrInverse: false, lotType: "odd", isDayTrade: false,
    price: 50, shares: 10, notes: "'=原始單引號也要保留", createdAt: "2026-08-09T00:00:00Z",
    grossAmount: 500, commissionRate: 0.000855, commissionDiscount: 6, commissionMinimum: 1,
    commissionRounding: "round", commissionEstimated: 1, commissionActual: null, taxRate: 0,
    taxRuleId: "not-a-sale", taxEstimated: 0, taxActual: null, netAmount: 501, calculationVersion: 2,
    ruleVersion: "TW-2026-08"
  };
  const exported = Csv.create([record], settings);
  assert.match(exported, /"'=0050"/);
  assert.match(exported, /"''=原始單引號也要保留"/);
  const restored = Csv.parse(exported).records[0];
  assert.equal(restored.id, record.id);
  assert.equal(restored.stockCode, record.stockCode);
  assert.equal(restored.stockName, record.stockName);
  assert.equal(restored.market, record.market);
  assert.equal(restored.notes, record.notes);
});

test("小數股數會讓整份 CSV 失敗", () => {
  const text = csv(oldHeaders, [
    ["record", "bad-1", "2026-08-08", "buy", "2330", "台積電", 100, 1.5, "", "", "", "", ""]
  ]);
  assert.throws(() => Csv.parse(text), /尚未匯入任何資料/);
});

test("不存在的日期會讓整份 CSV 失敗", () => {
  const text = csv(oldHeaders, [
    ["record", "bad-date", "2026-02-30", "buy", "2330", "台積電", 100, 1, "", "", "", "", ""]
  ]);
  assert.throws(() => Csv.parse(text), /尚未匯入任何資料/);
});

test("重複 ID、無限值與負費用皆拒絕", () => {
  const headers = [...oldHeaders, "commission_actual"];
  const duplicate = csv(headers, [
    ["record", "same", "2026-08-08", "buy", "2330", "台積電", 100, 1, "", "", "", "", "", ""],
    ["record", "same", "2026-08-09", "buy", "2330", "台積電", 100, 1, "", "", "", "", "", ""]
  ]);
  const infinity = csv(headers, [["record", "inf", "2026-08-08", "buy", "2330", "台積電", "Infinity", 1, "", "", "", "", "", ""]]);
  const negative = csv(headers, [["record", "neg", "2026-08-08", "buy", "2330", "台積電", 100, 1, "", "", "", "", "", -1]]);
  assert.throws(() => Csv.parse(duplicate), /ID 重複/);
  assert.throws(() => Csv.parse(infinity), /資料不合法/);
  assert.throws(() => Csv.parse(negative), /資料不合法/);
});
