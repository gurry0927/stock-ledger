"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

require("../scripts/config.js");
require("../scripts/records-view.js");

const { RecordsView } = globalThis.StockLedger;

test("個股與流水畫面會跳脫外部文字", () => {
  const recordHtml = RecordsView.recordList([{
    id: `x\" onclick=\"alert(1)`, stockName: "<img src=x>", stockCode: "2330", date: "2026-08-09",
    typeLabel: "買進", amountLabel: "<支出>", mainAmount: "$1", details: "成交", legacy: false, notes: "<script>alert(1)</script>"
  }], "", "");
  const stockHtml = RecordsView.stockList([{
    stockCode: `2330\" autofocus`, stockName: "<b>台積電</b>", active: true, lead: "1,000", leadSuffix: "股",
    metrics: [], marketMetrics: [], foot: "", warning: ""
  }], "", "");
  assert.doesNotMatch(recordHtml, /<img|<script/);
  assert.match(recordHtml, /&lt;img/);
  assert.match(recordHtml, /&lt;支出&gt;/);
  assert.doesNotMatch(stockHtml, /<b>|autofocus>/);
  assert.match(stockHtml, /&lt;b&gt;/);
  assert.match(stockHtml, /overview-metrics/);

  const cycleHtml = RecordsView.cycleList([{
    number: "1", active: true, period: "2026-01-01 ～ 持有中",
    metrics: [{ label: "目前股數", value: "1,000 股" }],
    marketMetrics: [{ label: "參考收盤", value: "$100.00" }],
    help: "回本成本說明", foot: "1 筆納入計算", warning: ""
  }]);
  assert.match(cycleHtml, /參考收盤/);
  assert.match(cycleHtml, /market-strip/);
  assert.match(cycleHtml, /回本成本說明/);
});
