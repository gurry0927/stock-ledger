(function (global) {
  "use strict";

  const App = global.StockLedger = global.StockLedger || {};

  App.Config = Object.freeze({
    DB_NAME: "tw-stock-ledger",
    DB_VERSION: 2,
    STORE_RECORDS: "records",
    STORE_SETTINGS: "settings",
    CALCULATION_VERSION: 2,
    RULE_VERSION: "TW-2026-08",

    // 台股手續費常用基準費率為成交金額的 0.1425%。
    // 券商可自訂費率、折讓與每筆最低費用，實際以對帳單為準。
    BASE_COMMISSION_RATE: 0.001425,

    DEFAULT_SETTINGS: Object.freeze({
      feeDiscount: 6,
      regularMinFee: 20,
      oddLotMinFee: 1,
      feeRounding: "round"
    }),

    TYPE_LABELS: Object.freeze({
      buy: "買進",
      sell: "賣出",
      dividend: "配息",
      stockDividend: "配股",
      reduction: "減資",
      split: "分割"
    }),

    FIELD_LABELS: Object.freeze({
      buy: ["成交股價", "股數", "實際支出"],
      sell: ["成交股價", "股數", "實際收入"],
      dividend: ["每股現金股利", "配息股數", "現金股利"],
      stockDividend: ["每股配股", "計算股數", "配發股數"],
      reduction: ["每股金額／比例", "影響股數", "記錄值"],
      split: ["分割比例", "影響股數", "記錄值"]
    }),

    ASSET_LABELS: Object.freeze({
      stock: "股票／KY 股",
      etf: "一般 ETF",
      bond_etf: "債券 ETF"
    }),

    // 證交稅規則來源：財政部「證券交易稅條例」，查核日 2026-08-08。
    // 買進不課證交稅；以下稅率僅用於賣出。
    TAX_RULES: Object.freeze({
      stock: Object.freeze({ rate: 0.003, id: "stock-sell-0.3pct" }),
      stockDayTrade: Object.freeze({
        rate: 0.0015,
        id: "stock-day-trade-0.15pct",
        from: "2017-04-28",
        through: "2027-12-31"
      }),
      etf: Object.freeze({ rate: 0.001, id: "etf-sell-0.1pct" }),
      bondEtfExemption: Object.freeze({
        rate: 0,
        id: "bond-etf-exempt",
        from: "2017-01-01",
        through: "2026-12-31"
      })
    })
  });

  App.Utils = Object.freeze({
    number(value, fallback) {
      if (value === "" || value === null || value === undefined) return fallback;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    },

    optionalNumber(value) {
      if (value === "" || value === null || value === undefined) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    },

    isSafeAmount(value, allowNegative) {
      const parsed = Number(value);
      return Number.isFinite(parsed) && Math.abs(parsed) <= Number.MAX_SAFE_INTEGER &&
        (allowNegative || parsed >= 0);
    },

    localDateString(value) {
      const date = value instanceof Date ? value : new Date(value);
      if (!Number.isFinite(date.getTime())) return "";
      const pad = (part) => String(part).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    },

    boolean(value) {
      return value === true || value === "true" || value === "1" || value === 1;
    },

    uid() {
      return global.crypto && global.crypto.randomUUID
        ? global.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    },

    escapeHtml(value) {
      return String(value == null ? "" : value).replace(/[&<>'"]/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
      })[char]);
    }
  });
})(typeof window !== "undefined" ? window : globalThis);
