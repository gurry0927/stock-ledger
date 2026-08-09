"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

require("../scripts/config.js");
require("../scripts/stock-lookup.js");

const { StockLookup } = globalThis.StockLedger;

test("歷史代號依最近出現順序去重並可排除示範資料", () => {
  const records = [
    { id: "new", stockCode: "2881", stockName: "富邦金", market: "上市" },
    { id: "old", stockCode: "2881", stockName: "舊名稱" },
    { id: "demo", stockCode: "DEMO", stockName: "示範" }
  ];
  const result = StockLookup.history(records, (record) => record.id === "demo");
  assert.deepEqual(result.map((stock) => stock.code), ["2881"]);
  assert.equal(result[0].name, "富邦金");
});

test("名稱關鍵字採包含搜尋，完全相符與開頭相符優先", () => {
  const directory = [
    { code: "00692", name: "富邦公司治理" },
    { code: "2881", name: "富邦金" },
    { code: "02000001", name: "臺灣富邦特選" },
    { code: "2330", name: "台積電" }
  ];
  assert.deepEqual(
    StockLookup.search(directory, "富邦", 20).map((stock) => stock.code),
    ["00692", "2881", "02000001"]
  );
  assert.deepEqual(StockLookup.search(directory, "2881", 20).map((stock) => stock.code), ["2881"]);
});
