(function (global) {
  "use strict";

  const App = global.StockLedger;
  const { Calculator } = App;
  const ID_PREFIX = "__stock-ledger-demo__";

  const DEFINITIONS = Object.freeze([
    // 示範科技：第一輪清倉後再次買進，讓個股頁可直接看到第 1、2 輪。
    { key: "tech-01", date: "2025-01-10", type: "buy", code: "DEMO2330", name: "示範科技", assetType: "stock", price: 600, shares: 1000, notes: "示範：第一輪買進 1,000 股" },
    { key: "tech-02", date: "2025-03-20", type: "dividend", code: "DEMO2330", name: "示範科技", assetType: "stock", price: 3, shares: 1000, cashReceivedActual: 2850, notes: "示範：第一輪實收配息" },
    { key: "tech-03", date: "2025-07-15", type: "sell", code: "DEMO2330", name: "示範科技", assetType: "stock", price: 650, shares: 1000, notes: "示範：全部賣出，第一輪結束" },
    { key: "tech-04", date: "2026-02-05", type: "buy", code: "DEMO2330", name: "示範科技", assetType: "stock", price: 700, shares: 500, notes: "示範：清倉後再次買進，建立第二輪" },
    { key: "tech-05", date: "2026-06-18", type: "dividend", code: "DEMO2330", name: "示範科技", assetType: "stock", price: 2, shares: 500, cashReceivedActual: 960, notes: "示範：第二輪配息會降低回本成本" },

    // 示範 ETF：多次買進，呈現移動平均成本。
    { key: "etf-01", date: "2025-09-01", type: "buy", code: "DEMO0050", name: "示範 ETF", assetType: "etf", price: 180, shares: 100, notes: "示範：ETF 零股買進" },
    { key: "etf-02", date: "2025-12-01", type: "buy", code: "DEMO0050", name: "示範 ETF", assetType: "etf", price: 195, shares: 50, notes: "示範：再次買進後重新計算平均成本" },
    { key: "etf-03", date: "2026-01-18", type: "dividend", code: "DEMO0050", name: "示範 ETF", assetType: "etf", price: 1.2, shares: 150, cashReceivedActual: 180, notes: "示範：ETF 配息" },

    // 示範高股息：部分賣出後仍有持股。
    { key: "income-01", date: "2025-08-08", type: "buy", code: "DEMO0056", name: "示範高股息", assetType: "etf", price: 35, shares: 1000, notes: "示範：整股買進" },
    { key: "income-02", date: "2026-03-12", type: "sell", code: "DEMO0056", name: "示範高股息", assetType: "etf", price: 38, shares: 400, notes: "示範：部分賣出，剩餘 600 股" },
    { key: "income-03", date: "2026-05-20", type: "dividend", code: "DEMO0056", name: "示範高股息", assetType: "etf", price: 1.8, shares: 600, cashReceivedActual: 1080, notes: "示範：部分賣出後的配息" },

    // 示範金融：虧損清倉，呈現已清倉區與負報酬。
    { key: "finance-01", date: "2025-04-10", type: "buy", code: "DEMO2881", name: "示範金融", assetType: "stock", price: 70, shares: 1000, notes: "示範：買進後續將虧損清倉" },
    { key: "finance-02", date: "2025-10-10", type: "sell", code: "DEMO2881", name: "示範金融", assetType: "stock", price: 65, shares: 1000, notes: "示範：全部賣出並結束輪次" },

    // 操作示範：涵蓋配股、分割與現金減資。
    { key: "event-01", date: "2025-02-01", type: "buy", code: "DEMOEVENT", name: "操作示範公司", assetType: "stock", price: 50, shares: 1000, notes: "示範：特殊事件前的初始持股" },
    { key: "event-02", date: "2025-05-01", type: "stockDividend", code: "DEMOEVENT", name: "操作示範公司", assetType: "stock", price: 0.1, shares: 1000, notes: "示範：每股配 0.1 股，共增加 100 股" },
    { key: "event-03", date: "2025-08-01", type: "split", code: "DEMOEVENT", name: "操作示範公司", assetType: "stock", price: 2, shares: 1100, notes: "示範：1 拆 2，股數變為 2,200 股" },
    { key: "event-04", date: "2026-04-01", type: "reduction", code: "DEMOEVENT", name: "操作示範公司", assetType: "stock", price: 0.5, shares: 2200, reductionKind: "cash", reducedShares: 200, cashReceivedActual: 1100, notes: "示範：現金減資，減少 200 股並收回現金" }
  ]);

  function create(settings) {
    return DEFINITIONS.map((definition, index) => {
      const record = {
        id: `${ID_PREFIX}${definition.key}`,
        date: definition.date,
        type: definition.type,
        stockCode: definition.code,
        stockName: definition.name,
        market: "示範資料",
        assetType: definition.assetType,
        isLeveragedOrInverse: false,
        isDayTrade: false,
        price: definition.price,
        shares: definition.shares,
        cashReceivedActual: definition.cashReceivedActual == null ? null : definition.cashReceivedActual,
        reductionKind: definition.reductionKind || null,
        reducedShares: definition.reducedShares == null ? null : definition.reducedShares,
        notes: definition.notes,
        commissionActual: null,
        taxActual: null,
        isDemo: true,
        createdAt: `${definition.date}T04:${String(index).padStart(2, "0")}:00.000Z`,
        updatedAt: `${definition.date}T04:${String(index).padStart(2, "0")}:00.000Z`
      };
      const calculation = Calculator.calculateTransaction(record, settings);
      return { ...record, ...Calculator.snapshot(calculation, settings) };
    });
  }

  function isDemo(record) {
    return Boolean(record && String(record.id || "").startsWith(ID_PREFIX));
  }

  function withoutDemo(records) {
    return (Array.isArray(records) ? records : []).filter((record) => !isDemo(record));
  }

  function autoSeedAction(records, state) {
    if (state) return "none";
    return Array.isArray(records) && records.length ? "skip" : "seed";
  }

  App.DemoData = Object.freeze({ ID_PREFIX, create, isDemo, withoutDemo, autoSeedAction, count: DEFINITIONS.length });
})(typeof window !== "undefined" ? window : globalThis);
