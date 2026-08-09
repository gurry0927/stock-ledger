(function (global) {
  "use strict";

  const App = global.StockLedger;

  function normalize(value) {
    return String(value || "").trim().toLocaleLowerCase("zh-Hant-TW");
  }

  function history(records, isExcluded) {
    const seen = new Set();
    const result = [];
    (Array.isArray(records) ? records : []).forEach((record) => {
      if (!record || (isExcluded && isExcluded(record))) return;
      const code = String(record.stockCode || "").trim().toUpperCase();
      if (!code || seen.has(code)) return;
      seen.add(code);
      result.push({
        code,
        name: String(record.stockName || code),
        market: String(record.market || "自訂"),
        assetType: record.assetType || "stock",
        isLeveragedOrInverse: Boolean(record.isLeveragedOrInverse)
      });
    });
    return result;
  }

  function search(directory, query, limit) {
    const needle = normalize(query);
    if (!needle) return [];
    const maximum = Number.isSafeInteger(limit) && limit > 0 ? limit : 20;
    return (Array.isArray(directory) ? directory : [])
      .map((stock) => {
        const code = normalize(stock && stock.code);
        const name = normalize(stock && stock.name);
        if (!code.includes(needle) && !name.includes(needle)) return null;
        const rank = code === needle || name === needle ? 0
          : code.startsWith(needle) || name.startsWith(needle) ? 1
            : 2;
        return { stock, rank };
      })
      .filter(Boolean)
      .sort((a, b) => a.rank - b.rank || String(a.stock.code).localeCompare(String(b.stock.code), "en"))
      .slice(0, maximum)
      .map((item) => item.stock);
  }

  App.StockLookup = Object.freeze({ history, search });
})(typeof window !== "undefined" ? window : globalThis);
