(function (global) {
  "use strict";

  const App = global.StockLedger;
  const { Calculator, Utils } = App;
  const EPSILON = 0.000001;

  function finite(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function actualOr(recordValue, fallback) {
    const actual = Utils.optionalNumber(recordValue);
    return actual === null ? fallback : actual;
  }

  function sortRecords(records) {
    return records.map((record, index) => ({ record, index })).sort((left, right) => {
      const a = left.record;
      const b = right.record;
      return String(a.date || "").localeCompare(String(b.date || "")) ||
        String(a.createdAt || "").localeCompare(String(b.createdAt || "")) ||
        left.index - right.index;
    }).map((item) => item.record);
  }

  function securityFor(map, record) {
    const code = String(record.stockCode || "").trim().toUpperCase();
    if (!map.has(code)) {
      map.set(code, {
        stockCode: code,
        stockName: record.stockName || code,
        cycles: [],
        currentCycle: null,
        recordCount: 0,
        lastActivityDate: "",
        warnings: []
      });
    }
    const security = map.get(code);
    if (record.stockName) security.stockName = record.stockName;
    return security;
  }

  function startCycle(security, record) {
    const cycle = {
      stockCode: security.stockCode,
      stockName: security.stockName,
      cycleNumber: security.cycles.length + 1,
      startDate: record.date,
      endDate: null,
      isClosed: false,
      shares: 0,
      bookCost: 0,
      recoveryCost: 0,
      buyOutflows: 0,
      saleProceeds: 0,
      dividends: 0,
      capitalReturns: 0,
      realizedTradingPnl: 0,
      totalReturn: null,
      recordCount: 0,
      hasEstimatedRecords: false,
      warnings: []
    };
    security.cycles.push(cycle);
    security.currentCycle = cycle;
    return cycle;
  }

  function warn(security, cycle, record, message) {
    const warning = { recordId: record.id || "", date: record.date || "", message };
    security.warnings.push(warning);
    if (cycle) cycle.warnings.push(warning);
  }

  function closeCycle(security, cycle, date) {
    cycle.shares = 0;
    cycle.bookCost = 0;
    cycle.endDate = date;
    cycle.isClosed = true;
    cycle.totalReturn = -cycle.recoveryCost;
    security.currentCycle = null;
  }

  function activeCycle(security) {
    return security.currentCycle && security.currentCycle.shares > EPSILON
      ? security.currentCycle
      : null;
  }

  function applyBuy(security, record, calculation) {
    const cycle = activeCycle(security) || startCycle(security, record);
    const cost = finite(calculation.net, 0);
    cycle.shares += Number(record.shares);
    cycle.bookCost += cost;
    cycle.recoveryCost += cost;
    cycle.buyOutflows += cost;
    cycle.hasEstimatedRecords = cycle.hasEstimatedRecords || Boolean(calculation.legacy);
    cycle.recordCount++;
  }

  function applySell(security, record, calculation) {
    const cycle = activeCycle(security);
    const soldShares = Number(record.shares);
    if (!cycle) {
      warn(security, null, record, "賣出時沒有可對應的持股，這筆未納入成本計算");
      return;
    }
    if (soldShares > cycle.shares + EPSILON) {
      warn(security, cycle, record, `賣出 ${soldShares} 股超過當時持有的 ${cycle.shares} 股，這筆未納入成本計算`);
      return;
    }

    const proceeds = finite(calculation.net, 0);
    const averageBookCost = cycle.shares ? cycle.bookCost / cycle.shares : 0;
    const soldBookCost = averageBookCost * soldShares;
    cycle.bookCost -= soldBookCost;
    // 回本成本是本輪尚未收回的淨現金，因此直接扣除賣出淨收入。
    cycle.recoveryCost -= proceeds;
    cycle.saleProceeds += proceeds;
    cycle.realizedTradingPnl += proceeds - soldBookCost;
    cycle.hasEstimatedRecords = cycle.hasEstimatedRecords || Boolean(calculation.legacy);
    cycle.shares -= soldShares;
    cycle.recordCount++;

    if (Math.abs(cycle.shares) <= EPSILON) closeCycle(security, cycle, record.date);
  }

  function applyDividend(security, record, calculation) {
    // 使用除息日記錄時能正確歸入當時輪次；清倉後才入帳則歸入最近結束輪次。
    const cycle = activeCycle(security) || security.cycles[security.cycles.length - 1];
    if (!cycle) {
      warn(security, null, record, "配息找不到可對應的投資輪次");
      return;
    }
    const cash = actualOr(record.cashReceivedActual, finite(calculation.gross, 0));
    cycle.dividends += cash;
    cycle.recoveryCost -= cash;
    cycle.hasEstimatedRecords = cycle.hasEstimatedRecords || Boolean(calculation.legacy);
    cycle.recordCount++;
    if (cycle.isClosed) cycle.totalReturn = -cycle.recoveryCost;
  }

  function applyStockDividend(security, record, calculation) {
    const cycle = activeCycle(security);
    const addedShares = finite(calculation.gross, NaN);
    if (!cycle) {
      warn(security, null, record, "配股時沒有可對應的持股，這筆未納入股數計算");
      return;
    }
    if (!Number.isSafeInteger(addedShares) || addedShares <= 0) {
      warn(security, cycle, record, "配發股數不是正整數，這筆未納入股數計算");
      return;
    }
    cycle.shares += addedShares;
    cycle.recordCount++;
  }

  function applySplit(security, record) {
    const cycle = activeCycle(security);
    const affectedShares = Number(record.shares);
    const ratio = Number(record.price);
    const adjustedShares = affectedShares * ratio;
    const change = adjustedShares - affectedShares;
    if (!cycle) {
      warn(security, null, record, "分割時沒有可對應的持股，這筆未納入股數計算");
      return;
    }
    if (!Number.isSafeInteger(adjustedShares) || adjustedShares <= 0 ||
        affectedShares > cycle.shares + EPSILON || cycle.shares + change < -EPSILON) {
      warn(security, cycle, record, "分割比例或影響股數與當時持股不一致，這筆未納入股數計算");
      return;
    }
    cycle.shares += change;
    cycle.recordCount++;
    if (Math.abs(cycle.shares) <= EPSILON) closeCycle(security, cycle, record.date);
  }

  function applyReduction(security, record, calculation) {
    const cycle = activeCycle(security);
    const removedShares = finite(record.reducedShares, NaN);
    const kind = record.reductionKind === "loss" ? "loss" : "cash";
    if (!cycle) {
      warn(security, null, record, "減資時沒有可對應的持股，這筆未納入成本計算");
      return;
    }
    if (!Number.isSafeInteger(removedShares) || removedShares <= 0 || removedShares > cycle.shares + EPSILON) {
      warn(security, cycle, record, "減少股數未填或超過當時持股，這筆未納入成本計算");
      return;
    }

    if (kind === "cash") {
      const cash = actualOr(record.cashReceivedActual, finite(calculation.gross, 0));
      cycle.capitalReturns += cash;
      cycle.recoveryCost -= cash;
      // 這是個人投資追蹤用的成本調整，不代表稅務成本認定。
      cycle.bookCost = Math.max(0, cycle.bookCost - cash);
    }
    cycle.hasEstimatedRecords = cycle.hasEstimatedRecords || Boolean(calculation.legacy);
    cycle.shares -= removedShares;
    cycle.recordCount++;
    if (Math.abs(cycle.shares) <= EPSILON) closeCycle(security, cycle, record.date);
  }

  function calculate(records, settings) {
    const securities = new Map();
    sortRecords(Array.isArray(records) ? records : []).forEach((record) => {
      if (!record || !record.stockCode || !record.type || !Number.isFinite(Number(record.price)) ||
          !Number.isSafeInteger(Number(record.shares)) || Number(record.shares) <= 0) return;
      const security = securityFor(securities, record);
      security.recordCount++;
      if (String(record.date || "") > security.lastActivityDate) security.lastActivityDate = String(record.date);
      const calculation = Calculator.storedOrEstimated(record, settings);
      if (record.type === "buy") applyBuy(security, record, calculation);
      if (record.type === "sell") applySell(security, record, calculation);
      if (record.type === "dividend") applyDividend(security, record, calculation);
      if (record.type === "stockDividend") applyStockDividend(security, record, calculation);
      if (record.type === "split") applySplit(security, record);
      if (record.type === "reduction") applyReduction(security, record, calculation);
    });

    const allSecurities = [...securities.values()];
    const positions = allSecurities.flatMap((security) => {
      const cycle = activeCycle(security);
      if (!cycle) return [];
      return [{
        ...cycle,
        stockName: security.stockName,
        averageBookCost: cycle.shares ? cycle.bookCost / cycle.shares : 0,
        averageRecoveryCost: cycle.shares ? cycle.recoveryCost / cycle.shares : 0,
        recoveredCash: cycle.saleProceeds + cycle.dividends + cycle.capitalReturns,
        completedCycles: security.cycles.filter((item) => item.isClosed).length,
        securityWarnings: security.warnings.length
      }];
    }).sort((a, b) => a.stockCode.localeCompare(b.stockCode, "en"));

    const closedCycles = allSecurities.flatMap((security) => security.cycles
      .filter((cycle) => cycle.isClosed)
      .map((cycle) => ({ ...cycle, stockName: security.stockName })))
      .sort((a, b) => String(b.endDate || "").localeCompare(String(a.endDate || "")) || b.cycleNumber - a.cycleNumber);

    // 個股總覽需要保留「一檔股票包含多個投資輪次」的層級；所有內容仍由原始流水即時計算。
    const stocks = allSecurities.map((security) => {
      const current = activeCycle(security);
      const cycles = security.cycles.map((cycle) => ({ ...cycle, warnings: [...cycle.warnings] }));
      return {
        stockCode: security.stockCode,
        stockName: security.stockName,
        recordCount: security.recordCount,
        lastActivityDate: security.lastActivityDate,
        currentCycle: current ? cycles.find((cycle) => cycle.cycleNumber === current.cycleNumber) : null,
        cycles,
        completedCycles: cycles.filter((cycle) => cycle.isClosed).length,
        warnings: [...security.warnings],
        totals: {
          dividends: cycles.reduce((sum, cycle) => sum + cycle.dividends, 0),
          capitalReturns: cycles.reduce((sum, cycle) => sum + cycle.capitalReturns, 0),
          realizedTradingPnl: cycles.reduce((sum, cycle) => sum + cycle.realizedTradingPnl, 0),
          closedReturn: cycles.filter((cycle) => cycle.isClosed)
            .reduce((sum, cycle) => sum + (Number(cycle.totalReturn) || 0), 0)
        }
      };
    }).sort((a, b) => Number(Boolean(b.currentCycle)) - Number(Boolean(a.currentCycle)) ||
      a.stockCode.localeCompare(b.stockCode, "en"));

    return {
      positions,
      closedCycles,
      stocks,
      warnings: allSecurities.flatMap((security) => security.warnings),
      totals: {
        shares: positions.reduce((sum, item) => sum + item.shares, 0),
        bookCost: positions.reduce((sum, item) => sum + item.bookCost, 0),
        recoveryCost: positions.reduce((sum, item) => sum + item.recoveryCost, 0),
        realizedTradingPnl: allSecurities.reduce((sum, security) =>
          sum + security.cycles.reduce((cycleSum, cycle) => cycleSum + cycle.realizedTradingPnl, 0), 0),
        dividends: allSecurities.reduce((sum, security) =>
          sum + security.cycles.reduce((cycleSum, cycle) => cycleSum + cycle.dividends, 0), 0)
      }
    };
  }

  App.Portfolio = Object.freeze({ calculate, sortRecords });
})(typeof window !== "undefined" ? window : globalThis);
