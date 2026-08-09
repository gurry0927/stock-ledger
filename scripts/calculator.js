(function (global) {
  "use strict";

  const App = global.StockLedger;
  const Config = App.Config;
  const Utils = App.Utils;

  function isWithin(date, from, through) {
    return Boolean(date && date >= from && date <= through);
  }

  // ---------- 元以下處理與整／零股判斷 ----------

  function roundNtd(value, mode) {
    if (!Number.isFinite(value)) return 0;
    if (mode === "floor") return Math.floor(value);
    if (mode === "ceil") return Math.ceil(value);
    return Math.round(value);
  }

  function inferLotType(record) {
    if (record.lotType === "odd" || record.lotType === "regular") return record.lotType;
    return Number(record.shares) < 1000 ? "odd" : "regular";
  }

  // ---------- 買賣手續費 ----------
  // 每筆估算 = max(整股或零股最低費用, 成交金額 × 0.1425% × 折數)。

  function commissionFor(record, settings) {
    if (record.type !== "buy" && record.type !== "sell") {
      return { rate: 0, raw: 0, minimum: 0, estimated: 0, actual: null, charged: 0 };
    }

    const gross = Number(record.price) * Number(record.shares);
    const rate = Config.BASE_COMMISSION_RATE * (Number(settings.feeDiscount) / 10);
    const minimum = inferLotType(record) === "odd"
      ? Number(settings.oddLotMinFee)
      : Number(settings.regularMinFee);
    const raw = gross * rate;
    const estimated = gross > 0 ? Math.max(minimum, roundNtd(raw, settings.feeRounding)) : 0;
    const actual = Utils.optionalNumber(record.commissionActual);

    return { rate, raw, minimum, estimated, actual, charged: actual === null ? estimated : actual };
  }

  // ---------- 賣出證券交易稅 ----------
  // 商品分類與交易日期共同決定稅則；對帳單覆寫值永遠優先。

  function taxRuleFor(record) {
    if (record.type !== "sell") return { rate: 0, id: "not-a-sale" };

    const rules = Config.TAX_RULES;
    if (record.assetType === "stock") {
      if (record.isDayTrade && isWithin(record.date, rules.stockDayTrade.from, rules.stockDayTrade.through)) {
        return rules.stockDayTrade;
      }
      return rules.stock;
    }

    if (record.assetType === "bond_etf" && !record.isLeveragedOrInverse &&
        isWithin(record.date, rules.bondEtfExemption.from, rules.bondEtfExemption.through)) {
      return rules.bondEtfExemption;
    }

    if (record.assetType === "etf" || record.assetType === "bond_etf") return rules.etf;
    return rules.stock;
  }

  function taxFor(record, gross) {
    if (record.type !== "sell") {
      return { rate: 0, ruleId: "not-a-sale", estimated: 0, actual: null, charged: 0 };
    }
    const rule = taxRuleFor(record);
    const estimated = roundNtd(gross * rule.rate, "round");
    const actual = Utils.optionalNumber(record.taxActual);
    return { rate: rule.rate, ruleId: rule.id, estimated, actual, charged: actual === null ? estimated : actual };
  }

  // ---------- 單筆總額與不可變費用快照 ----------

  function calculateTransaction(record, settings) {
    const price = Math.max(0, Number(record.price) || 0);
    const shares = Math.max(0, Number(record.shares) || 0);
    const gross = price * shares;
    const commission = commissionFor({ ...record, price, shares }, settings);
    const tax = taxFor(record, gross);

    let net = gross;
    if (record.type === "buy") net = gross + commission.charged;
    if (record.type === "sell") net = gross - commission.charged - tax.charged;

    return {
      gross,
      net,
      lotType: inferLotType(record),
      commission,
      tax,
      calculationVersion: Config.CALCULATION_VERSION,
      ruleVersion: Config.RULE_VERSION
    };
  }

  function snapshot(calculation, settings) {
    return {
      grossAmount: calculation.gross,
      netAmount: calculation.net,
      lotType: calculation.lotType,
      commissionRate: calculation.commission.rate,
      commissionDiscount: Number(settings.feeDiscount),
      commissionMinimum: calculation.commission.minimum,
      commissionRounding: settings.feeRounding,
      commissionEstimated: calculation.commission.estimated,
      commissionActual: calculation.commission.actual,
      taxRate: calculation.tax.rate,
      taxRuleId: calculation.tax.ruleId,
      taxEstimated: calculation.tax.estimated,
      taxActual: calculation.tax.actual,
      calculationVersion: calculation.calculationVersion,
      ruleVersion: calculation.ruleVersion
    };
  }

  function isSafeCalculation(calculation) {
    return Boolean(calculation) &&
      Utils.isSafeAmount(calculation.gross) &&
      Utils.isSafeAmount(calculation.net, true) &&
      calculation.commission && Utils.isSafeAmount(calculation.commission.charged) &&
      calculation.tax && Utils.isSafeAmount(calculation.tax.charged);
  }

  function storedOrEstimated(record, settings) {
    if (Number(record.calculationVersion) >= Config.CALCULATION_VERSION && Number.isFinite(Number(record.netAmount))) {
      const commissionActual = Utils.optionalNumber(record.commissionActual);
      const taxActual = Utils.optionalNumber(record.taxActual);
      return {
        gross: Number(record.grossAmount) || 0,
        net: Number(record.netAmount) || 0,
        lotType: record.lotType || inferLotType(record),
        commission: {
          rate: Number(record.commissionRate) || 0,
          minimum: Number(record.commissionMinimum) || 0,
          estimated: Number(record.commissionEstimated) || 0,
          actual: commissionActual,
          charged: commissionActual === null ? Number(record.commissionEstimated) || 0 : commissionActual
        },
        tax: {
          rate: Number(record.taxRate) || 0,
          ruleId: record.taxRuleId || "stored",
          estimated: Number(record.taxEstimated) || 0,
          actual: taxActual,
          charged: taxActual === null ? Number(record.taxEstimated) || 0 : taxActual
        },
        calculationVersion: Number(record.calculationVersion),
        ruleVersion: record.ruleVersion || "stored",
        legacy: false
      };
    }

    return { ...calculateTransaction(record, settings), legacy: true };
  }

  App.Calculator = Object.freeze({
    roundNtd,
    inferLotType,
    taxRuleFor,
    calculateTransaction,
    isSafeCalculation,
    snapshot,
    storedOrEstimated
  });
})(typeof window !== "undefined" ? window : globalThis);
