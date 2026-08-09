(function (global) {
  "use strict";

  const App = global.StockLedger;
  const Utils = App.Utils;
  const Config = App.Config;

  const HEADERS = [
    "row_type", "schema_version", "id", "date", "type", "stock_code", "stock_name", "market",
    "asset_type", "is_leveraged_or_inverse", "lot_type", "is_day_trade", "price", "shares",
    "cash_received_actual", "reduction_kind", "reduced_shares", "notes",
    "created_at", "updated_at", "gross_amount", "commission_rate", "commission_discount",
    "commission_minimum", "commission_rounding", "commission_estimated", "commission_actual", "tax_rate",
    "tax_rule_id", "tax_estimated", "tax_actual", "net_amount", "calculation_version", "rule_version",
    "fee_discount", "regular_min_fee", "odd_lot_min_fee", "fee_rounding"
  ];

  const SCHEMA_VERSION = 4;
  const FORMULA_LIKE = /^[\t\r\n']*[=+\-@]/;

  function spreadsheetSafe(value) {
    const text = String(value == null ? "" : value);
    // 試算表可能把有引號包覆的危險前綴仍視為公式；加一層單引號並由 v4 匯入器還原。
    return typeof value === "string" && FORMULA_LIKE.test(text) ? `'${text}` : text;
  }

  function restoreSpreadsheetText(value, schemaVersion) {
    const text = String(value == null ? "" : value);
    return Number(schemaVersion) >= SCHEMA_VERSION && text.startsWith("'") && FORMULA_LIKE.test(text.slice(1))
      ? text.slice(1)
      : text;
  }

  function cell(value) {
    return `"${spreadsheetSafe(value).replace(/"/g, '""')}"`;
  }

  function create(records, settings) {
    // schema v4 延續費用與事件快照，並加入可逆的試算表公式防護。
    const rows = [HEADERS.map(cell).join(",")];
    const settingsRow = {
      row_type: "settings",
      schema_version: SCHEMA_VERSION,
      fee_discount: settings.feeDiscount,
      regular_min_fee: settings.regularMinFee,
      odd_lot_min_fee: settings.oddLotMinFee,
      fee_rounding: settings.feeRounding
    };
    rows.push(HEADERS.map((header) => cell(settingsRow[header])).join(","));

    records.forEach((record) => {
      const row = {
        row_type: "record",
        schema_version: SCHEMA_VERSION,
        id: record.id,
        date: record.date,
        type: record.type,
        stock_code: record.stockCode,
        stock_name: record.stockName,
        market: record.market,
        asset_type: record.assetType,
        is_leveraged_or_inverse: record.isLeveragedOrInverse,
        lot_type: record.lotType,
        is_day_trade: record.isDayTrade,
        price: record.price,
        shares: record.shares,
        cash_received_actual: record.cashReceivedActual,
        reduction_kind: record.reductionKind,
        reduced_shares: record.reducedShares,
        notes: record.notes,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
        gross_amount: record.grossAmount,
        commission_rate: record.commissionRate,
        commission_discount: record.commissionDiscount,
        commission_minimum: record.commissionMinimum,
        commission_rounding: record.commissionRounding,
        commission_estimated: record.commissionEstimated,
        commission_actual: record.commissionActual,
        tax_rate: record.taxRate,
        tax_rule_id: record.taxRuleId,
        tax_estimated: record.taxEstimated,
        tax_actual: record.taxActual,
        net_amount: record.netAmount,
        calculation_version: record.calculationVersion,
        rule_version: record.ruleVersion
      };
      rows.push(HEADERS.map((header) => cell(row[header])).join(","));
    });

    return "\ufeff" + rows.join("\r\n");
  }

  function parseRows(text) {
    const rows = [];
    let row = [];
    let value = "";
    let quoted = false;
    const source = text.replace(/^\ufeff/, "");

    for (let index = 0; index < source.length; index++) {
      const char = source[index];
      if (quoted) {
        if (char === '"' && source[index + 1] === '"') {
          value += '"';
          index++;
        } else if (char === '"') {
          quoted = false;
        } else {
          value += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ",") {
        row.push(value);
        value = "";
      } else if (char === "\n") {
        row.push(value.replace(/\r$/, ""));
        rows.push(row);
        row = [];
        value = "";
      } else {
        value += char;
      }
    }
    if (quoted) throw new Error("CSV 引號沒有正確結束");
    if (value.length || row.length) {
      row.push(value);
      rows.push(row);
    }
    return rows;
  }

  function parse(text) {
    // 先完成所有解析與驗證，呼叫端確認後才會交給 IndexedDB 寫入。
    const rows = parseRows(text);
    if (rows.length < 2) throw new Error("檔案沒有可匯入的資料");
    const headers = rows[0];
    const at = (row, name) => {
      const index = headers.indexOf(name);
      return index < 0 ? "" : row[index];
    };
    if (!headers.includes("row_type") || !headers.includes("id")) {
      throw new Error("不是本帳本匯出的 CSV 格式");
    }

    let settings = null;
    const records = [];
    const ids = new Set();
    const finite = (value, fallback) => {
      if (value === "" || value === null || value === undefined) return fallback;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : NaN;
    };
    const optionalCost = (value) => value === "" ? null : finite(value, NaN);
    const realDate = (value) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const [year, month, day] = value.split("-").map(Number);
      const parsed = new Date(Date.UTC(year, month - 1, day));
      return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
    };
    rows.slice(1).forEach((row, rowIndex) => {
      const schemaVersion = finite(at(row, "schema_version"), 0);
      const valueAt = (name) => restoreSpreadsheetText(at(row, name), schemaVersion);
      const rowType = valueAt("row_type");
      if (!rowType) return;
      if (rowType === "settings") {
        if (settings) throw new Error(`CSV 第 ${rowIndex + 2} 列有重複設定，尚未匯入任何資料`);
        const next = {
          feeDiscount: finite(valueAt("fee_discount"), Config.DEFAULT_SETTINGS.feeDiscount),
          regularMinFee: finite(valueAt("regular_min_fee"), Config.DEFAULT_SETTINGS.regularMinFee),
          oddLotMinFee: finite(valueAt("odd_lot_min_fee"), Config.DEFAULT_SETTINGS.oddLotMinFee),
          feeRounding: valueAt("fee_rounding") || Config.DEFAULT_SETTINGS.feeRounding
        };
        if (!Number.isFinite(next.feeDiscount) || next.feeDiscount < 0 || next.feeDiscount > 10 ||
            !Number.isSafeInteger(next.regularMinFee) || next.regularMinFee < 0 ||
            !Number.isSafeInteger(next.oddLotMinFee) || next.oddLotMinFee < 0 ||
            !["round", "floor", "ceil"].includes(next.feeRounding)) {
          throw new Error(`CSV 第 ${rowIndex + 2} 列設定不合法，尚未匯入任何資料`);
        }
        settings = next;
        return;
      }
      if (rowType !== "record") throw new Error(`CSV 第 ${rowIndex + 2} 列類型無法辨識，尚未匯入任何資料`);

      const price = Utils.number(valueAt("price"), NaN);
      const shares = Utils.number(valueAt("shares"), NaN);
      const type = valueAt("type");
      const date = valueAt("date");
      const code = valueAt("stock_code");
      const name = valueAt("stock_name");
      const id = valueAt("id") || Utils.uid();
      // 舊版 CSV 沒有商品分類；保留 undefined，讓 app 依離線清單補上 ETF/KY 分類。
      const assetType = valueAt("asset_type") || undefined;
      const leveragedValue = valueAt("is_leveraged_or_inverse");
      const commissionActual = optionalCost(valueAt("commission_actual"));
      const taxActual = optionalCost(valueAt("tax_actual"));
      const cashReceivedActual = optionalCost(valueAt("cash_received_actual"));
      const reductionKind = valueAt("reduction_kind") || null;
      const reducedShares = valueAt("reduced_shares") === "" ? null : finite(valueAt("reduced_shares"), NaN);
      if (!realDate(date) || !Config.TYPE_LABELS[type] || !code || !name || code.length > 12 || name.length > 40 ||
          (assetType !== undefined && !Config.ASSET_LABELS[assetType]) || !Number.isFinite(price) || price < 0 ||
          ((type === "buy" || type === "sell") && price <= 0) ||
          !Number.isSafeInteger(shares) || shares <= 0 ||
          (commissionActual !== null && !Utils.isSafeAmount(commissionActual)) ||
          (taxActual !== null && !Utils.isSafeAmount(taxActual)) ||
          (cashReceivedActual !== null && !Utils.isSafeAmount(cashReceivedActual)) ||
          (reductionKind !== null && !["cash", "loss"].includes(reductionKind)) ||
          (reducedShares !== null && (!Number.isSafeInteger(reducedShares) || reducedShares <= 0)) ||
          !Utils.isSafeAmount(price * shares)) {
        throw new Error(`CSV 第 ${rowIndex + 2} 列資料不合法，尚未匯入任何資料`);
      }
      if (ids.has(id)) throw new Error(`CSV 第 ${rowIndex + 2} 列 ID 重複，尚未匯入任何資料`);
      ids.add(id);

      const record = {
        id,
        date,
        type,
        stockCode: code,
        stockName: name,
        market: valueAt("market") || "",
        assetType,
        isLeveragedOrInverse: leveragedValue === "" ? undefined : Utils.boolean(leveragedValue),
        lotType: valueAt("lot_type") || (shares < 1000 ? "odd" : "regular"),
        isDayTrade: Utils.boolean(valueAt("is_day_trade")),
        price,
        shares,
        cashReceivedActual,
        reductionKind,
        reducedShares,
        notes: valueAt("notes") || "",
        createdAt: valueAt("created_at") || new Date().toISOString(),
        updatedAt: valueAt("updated_at") || "",
        grossAmount: finite(valueAt("gross_amount"), undefined),
        commissionRate: finite(valueAt("commission_rate"), undefined),
        commissionDiscount: finite(valueAt("commission_discount"), undefined),
        commissionMinimum: finite(valueAt("commission_minimum"), undefined),
        commissionRounding: valueAt("commission_rounding") || undefined,
        commissionEstimated: finite(valueAt("commission_estimated"), undefined),
        commissionActual,
        taxRate: finite(valueAt("tax_rate"), undefined),
        taxRuleId: valueAt("tax_rule_id") || undefined,
        taxEstimated: finite(valueAt("tax_estimated"), undefined),
        taxActual,
        netAmount: finite(valueAt("net_amount"), undefined),
        calculationVersion: finite(valueAt("calculation_version"), undefined),
        ruleVersion: valueAt("rule_version") || undefined
      };

      if (record.calculationVersion !== undefined) {
        const nonnegativeSnapshotNumbers = [
          record.grossAmount, record.commissionRate, record.commissionDiscount,
          record.commissionMinimum, record.commissionEstimated, record.taxRate, record.taxEstimated
        ];
        const grossMatches = Math.abs(record.grossAmount - price * shares) <= 0.000001;
        const commissionCharged = commissionActual === null ? record.commissionEstimated : commissionActual;
        const taxCharged = taxActual === null ? record.taxEstimated : taxActual;
        let expectedNet = record.grossAmount;
        if (type === "buy") expectedNet += commissionCharged;
        if (type === "sell") expectedNet -= commissionCharged + taxCharged;
        const netMatches = Math.abs(record.netAmount - expectedNet) <= 0.000001;

        if (!Number.isSafeInteger(record.calculationVersion) || record.calculationVersion < 2 ||
            !record.assetType || record.isLeveragedOrInverse === undefined ||
            !Utils.isSafeAmount(record.netAmount, true) ||
            nonnegativeSnapshotNumbers.some((value) => !Utils.isSafeAmount(value)) ||
            !Number.isSafeInteger(record.commissionMinimum) ||
            !["odd", "regular"].includes(record.lotType) ||
            !["round", "floor", "ceil"].includes(record.commissionRounding) ||
            !record.taxRuleId || !record.ruleVersion || !grossMatches || !netMatches) {
          throw new Error(`CSV 第 ${rowIndex + 2} 列費用快照不完整或不一致，尚未匯入任何資料`);
        }
      }

      records.push(record);
    });

    return { records, settings };
  }

  App.Csv = Object.freeze({ create, parse, parseRows });
})(typeof window !== "undefined" ? window : globalThis);
