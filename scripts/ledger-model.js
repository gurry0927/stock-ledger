(function (global) {
  "use strict";

  const App = global.StockLedger;
  const { Portfolio } = App;

  function normalizeCode(value) {
    return String(value || "").trim().toUpperCase();
  }

  function blankStock(code, records) {
    const latest = records[0] || {};
    return {
      stockCode: code,
      stockName: latest.stockName || code,
      recordCount: records.length,
      lastActivityDate: latest.date || "",
      currentCycle: null,
      cycles: [],
      completedCycles: 0,
      warnings: [{ message: "這檔股票只有格式異常的記錄，請到全部流水帳檢查" }],
      totals: { dividends: 0, capitalReturns: 0, realizedTradingPnl: 0, closedReturn: 0 },
      unavailable: true
    };
  }

  function build(records, portfolioResult) {
    const newestFirst = Portfolio.sortRecords(Array.isArray(records) ? records : []).reverse();
    const recordsByCode = new Map();
    newestFirst.forEach((record) => {
      const code = normalizeCode(record && record.stockCode);
      if (!code) return;
      if (!recordsByCode.has(code)) recordsByCode.set(code, []);
      recordsByCode.get(code).push(record);
    });

    const stocksByCode = new Map();
    const calculatedStocks = portfolioResult && Array.isArray(portfolioResult.stocks)
      ? portfolioResult.stocks
      : [];
    calculatedStocks.forEach((stock) => {
      const code = normalizeCode(stock.stockCode);
      const stockRecords = recordsByCode.get(code) || [];
      stocksByCode.set(code, { ...stock, recordCount: stockRecords.length || stock.recordCount || 0 });
    });
    recordsByCode.forEach((stockRecords, code) => {
      if (!stocksByCode.has(code)) stocksByCode.set(code, blankStock(code, stockRecords));
    });

    const stocks = [...stocksByCode.values()].sort((a, b) =>
      Number(Boolean(b.currentCycle)) - Number(Boolean(a.currentCycle)) ||
      String(b.lastActivityDate || "").localeCompare(String(a.lastActivityDate || "")) ||
      a.stockCode.localeCompare(b.stockCode, "en"));

    return { stocks, stocksByCode, recordsByCode };
  }

  function stockFor(index, code) {
    return index && index.stocksByCode.get(normalizeCode(code)) || null;
  }

  function recordsFor(index, code) {
    return index && index.recordsByCode.get(normalizeCode(code)) || [];
  }

  function filterStocks(stocks, query) {
    const needle = String(query || "").trim().toLocaleLowerCase("zh-Hant-TW");
    if (!needle) return Array.isArray(stocks) ? stocks : [];
    return (Array.isArray(stocks) ? stocks : []).filter((stock) =>
      String(stock.stockCode || "").toLocaleLowerCase("zh-Hant-TW").includes(needle) ||
      String(stock.stockName || "").toLocaleLowerCase("zh-Hant-TW").includes(needle));
  }

  function filterRecords(records, query, type, month) {
    const needle = String(query || "").trim().toLocaleLowerCase("zh-Hant-TW");
    const selectedMonth = /^\d{4}-\d{2}$/.test(String(month || "")) ? String(month) : "";
    return (Array.isArray(records) ? records : []).filter((record) => {
      const matchesType = !type || record.type === type;
      const matchesMonth = !selectedMonth || String(record.date || "").slice(0, 7) === selectedMonth;
      const matchesQuery = !needle || String(record.stockCode || "").toLocaleLowerCase("zh-Hant-TW").includes(needle) ||
        String(record.stockName || "").toLocaleLowerCase("zh-Hant-TW").includes(needle);
      return matchesType && matchesMonth && matchesQuery;
    });
  }

  App.LedgerModel = Object.freeze({ build, stockFor, recordsFor, filterStocks, filterRecords, normalizeCode });
})(typeof window !== "undefined" ? window : globalThis);
