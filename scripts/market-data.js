(function (global) {
  "use strict";

  const App = global.StockLedger;
  const { Storage } = App;
  const EMPTY_STATE = Object.freeze({
    status: "empty",
    marketDate: "",
    generatedAt: "",
    prices: Object.freeze({}),
    source: "none",
    canRefresh: false,
    lastAttemptDate: "",
    lastSuccessAt: "",
    error: ""
  });

  let state = EMPTY_STATE;
  let pending = null;

  function taipeiDate() {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Taipei",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date());
    } catch (_) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function normalizePayload(value, minimumCount) {
    if (!value || typeof value !== "object" || Number(value.schemaVersion) !== 1 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(String(value.marketDate || "")) ||
        !value.prices || typeof value.prices !== "object" || Array.isArray(value.prices)) return null;

    const prices = {};
    Object.entries(value.prices).forEach(([rawCode, rawPrice]) => {
      const code = String(rawCode || "").trim().toUpperCase();
      const price = Number(rawPrice);
      if (code && code.length <= 12 && Number.isFinite(price) && price > 0) prices[code] = price;
    });
    if (Object.keys(prices).length < (minimumCount || 1)) return null;

    return {
      schemaVersion: 1,
      generatedAt: String(value.generatedAt || ""),
      marketDate: String(value.marketDate),
      marketDates: value.marketDates && typeof value.marketDates === "object" ? { ...value.marketDates } : {},
      count: Object.keys(prices).length,
      prices
    };
  }

  function newer(left, right) {
    if (!left) return right;
    if (!right) return left;
    if (right.marketDate > left.marketDate) return right;
    if (right.marketDate < left.marketDate) return left;
    return String(right.generatedAt || "") > String(left.generatedAt || "") ? right : left;
  }

  function toState(payload, cache, overrides) {
    return {
      ...EMPTY_STATE,
      status: payload ? "ready" : "empty",
      marketDate: payload ? payload.marketDate : "",
      generatedAt: payload ? payload.generatedAt : "",
      prices: payload ? payload.prices : {},
      source: payload ? "cache" : "none",
      canRefresh: global.location && global.location.protocol !== "file:",
      lastAttemptDate: cache && cache.lastAttemptDate || "",
      lastSuccessAt: cache && cache.lastSuccessAt || "",
      ...(overrides || {})
    };
  }

  async function saveCache(payload, previous, changes) {
    const cache = {
      payload: payload || null,
      lastAttemptDate: previous && previous.lastAttemptDate || "",
      lastSuccessAt: previous && previous.lastSuccessAt || "",
      ...(changes || {})
    };
    await Storage.putMarketCache(cache);
    return cache;
  }

  async function run(force) {
    let cache = null;
    try {
      cache = await Storage.getMarketCache();
    } catch (_) {
      cache = null;
    }

    const cachedPayload = normalizePayload(cache && cache.payload, 1);
    const bundledPayload = normalizePayload(global.TW_CLOSE_PRICES, 1);
    let payload = newer(cachedPayload, bundledPayload);
    const bundledWon = payload && bundledPayload && payload === bundledPayload && payload !== cachedPayload;

    if (bundledWon) {
      try {
        cache = await saveCache(payload, cache, {
          lastSuccessAt: cache && cache.lastSuccessAt || payload.generatedAt || ""
        });
      } catch (_) {
        // 行情快取失敗不影響記帳核心；記憶體內仍可使用隨附行情。
      }
    }

    state = toState(payload, cache, {
      source: bundledWon ? "bundled" : payload ? "cache" : "none"
    });

    if (!global.location || global.location.protocol === "file:") {
      state = { ...state, status: payload ? "ready" : "empty", canRefresh: false };
      return state;
    }

    const today = taipeiDate();
    if (!force && cache && cache.lastAttemptDate === today) return state;

    state = { ...state, status: "checking", canRefresh: true, error: "" };
    try {
      cache = await saveCache(payload, cache, { lastAttemptDate: today });
    } catch (_) {
      // 即使無法保存檢查日期，仍允許本次背景更新。
    }

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = global.setTimeout(() => { if (controller) controller.abort(); }, 8000);
    try {
      const response = await global.fetch("./prices.json", {
        cache: "no-store",
        signal: controller ? controller.signal : undefined
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const remote = normalizePayload(await response.json(), 500);
      if (!remote) throw new Error("行情檔格式或筆數不正確");
      payload = newer(payload, remote);
      const now = new Date().toISOString();
      cache = await saveCache(payload, cache, { lastAttemptDate: today, lastSuccessAt: now });
      state = toState(payload, cache, { source: "network", canRefresh: true });
    } catch (error) {
      state = toState(payload, cache, {
        status: payload ? "stale" : "error",
        source: payload ? state.source : "none",
        canRefresh: true,
        lastAttemptDate: today,
        error: error && error.name === "AbortError" ? "更新逾時" : "更新失敗"
      });
    } finally {
      global.clearTimeout(timeout);
    }
    return state;
  }

  function initialize(force) {
    if (pending) return pending;
    pending = run(Boolean(force)).finally(() => { pending = null; });
    return pending;
  }

  function getState() {
    return state;
  }

  function priceFor(code) {
    const value = state.prices[String(code || "").trim().toUpperCase()];
    return Number.isFinite(Number(value)) ? Number(value) : null;
  }

  App.MarketData = Object.freeze({ normalizePayload, initialize, getState, priceFor, taipeiDate });
})(typeof window !== "undefined" ? window : globalThis);
