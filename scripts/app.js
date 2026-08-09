(function (global) {
  "use strict";

  const App = global.StockLedger;
  const { Config, Utils, Calculator, DemoData, Portfolio, LedgerModel, Storage, MarketData, Csv, RecordsView } = App;
  const $ = (selector) => document.querySelector(selector);

  let records = [];
  let settings = { ...Config.DEFAULT_SETTINGS };
  let editingId = null;
  let stockByCode = new Map();
  let stockByName = new Map();
  let marketState = MarketData.getState();
  let portfolioState = null;
  let ledgerIndex = null;
  let recordsMode = "stocks";
  let selectedStockCode = null;
  let stockDetailMode = "cycles";
  let toastTimer;
  let draftTimer;
  let draftSaveWarningShown = false;

  function normalizeSettings(value) {
    const source = value || {};
    const rounding = ["round", "floor", "ceil"].includes(source.feeRounding)
      ? source.feeRounding
      : Config.DEFAULT_SETTINGS.feeRounding;
    return {
      feeDiscount: Utils.number(source.feeDiscount, Config.DEFAULT_SETTINGS.feeDiscount),
      regularMinFee: Utils.number(source.regularMinFee, Config.DEFAULT_SETTINGS.regularMinFee),
      oddLotMinFee: Utils.number(source.oddLotMinFee, Config.DEFAULT_SETTINGS.oddLotMinFee),
      feeRounding: rounding
    };
  }

  function money(value, decimals) {
    const number = Number(value) || 0;
    return new Intl.NumberFormat("zh-TW", {
      style: "currency",
      currency: "TWD",
      maximumFractionDigits: decimals == null ? (Math.abs(number) < 100 ? 2 : 0) : decimals
    }).format(number);
  }

  function number(value, maximumFractionDigits) {
    return new Intl.NumberFormat("zh-TW", {
      maximumFractionDigits: maximumFractionDigits == null ? 4 : maximumFractionDigits
    }).format(Number(value) || 0);
  }

  function inputNumber(selector) {
    return Number($(selector).value) || 0;
  }

  function optionalInputNumber(selector) {
    const raw = $(selector).value;
    if (raw === "") return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : NaN;
  }

  function selectedType() {
    return $("#type").value;
  }

  function switchTab(name) {
    document.querySelectorAll("[data-tab]").forEach((button) => {
      const active = button.dataset.tab === name;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll("[data-tab-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.tabPanel !== name;
    });
  }

  function switchRecordsMode(mode) {
    recordsMode = mode === "ledger" ? "ledger" : "stocks";
    selectedStockCode = null;
    syncRecordsScreens();
  }

  function syncRecordsScreens() {
    document.querySelectorAll("[data-records-mode]").forEach((button) => {
      button.setAttribute("aria-selected", String(button.dataset.recordsMode === recordsMode));
    });
    $("#stockOverviewScreen").hidden = recordsMode !== "stocks" || Boolean(selectedStockCode);
    $("#allRecordsScreen").hidden = recordsMode !== "ledger" || Boolean(selectedStockCode);
    $("#stockDetailScreen").hidden = !selectedStockCode;
  }

  function switchStockDetailMode(mode) {
    stockDetailMode = mode === "ledger" ? "ledger" : "cycles";
    document.querySelectorAll("[data-stock-detail-mode]").forEach((button) => {
      button.setAttribute("aria-selected", String(button.dataset.stockDetailMode === stockDetailMode));
    });
    document.querySelectorAll("[data-stock-detail-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.stockDetailPanel !== stockDetailMode;
    });
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    $("#toast").textContent = message;
    $("#toast").classList.add("show");
    toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 2400);
  }

  function stockForCode(code) {
    return stockByCode.get(String(code || "").trim().toUpperCase()) || null;
  }

  function inferredAsset(record) {
    const stock = stockForCode(record.stockCode);
    return {
      assetType: record.assetType || (stock && stock.assetType) || "stock",
      market: record.market || (stock && stock.market) || "自訂",
      isLeveragedOrInverse: record.isLeveragedOrInverse == null
        ? Boolean(stock && stock.isLeveragedOrInverse)
        : Boolean(record.isLeveragedOrInverse)
    };
  }

  function enrichRecord(record) {
    return { ...record, ...inferredAsset(record) };
  }

  function rebuildStockDirectory() {
    const builtIn = Array.isArray(global.TW_STOCKS) ? global.TW_STOCKS : [];
    stockByCode = new Map(builtIn.map((stock) => [stock.code.toUpperCase(), stock]));
    records.forEach((record) => {
      const code = String(record.stockCode || "").toUpperCase();
      if (code && !stockByCode.has(code)) {
        stockByCode.set(code, {
          code,
          name: record.stockName,
          market: record.market || "自訂",
          assetType: record.assetType || "stock",
          isLeveragedOrInverse: Boolean(record.isLeveragedOrInverse)
        });
      }
    });

    stockByName = new Map();
    stockByCode.forEach((stock) => {
      const key = stock.name.trim().toLocaleLowerCase("zh-Hant-TW");
      if (!stockByName.has(key)) stockByName.set(key, stock);
    });

    const directory = [...stockByCode.values()].sort((a, b) => a.code.localeCompare(b.code, "en"));
    $("#stockCodes").innerHTML = directory.map((stock) =>
      `<option value="${Utils.escapeHtml(stock.code)}" label="${Utils.escapeHtml(stock.name)} · ${Utils.escapeHtml(stock.market)}"></option>`
    ).join("");
    $("#stockNames").innerHTML = directory.map((stock) =>
      `<option value="${Utils.escapeHtml(stock.name)}" label="${Utils.escapeHtml(stock.code)} · ${Utils.escapeHtml(stock.market)}"></option>`
    ).join("");
  }

  function applyStock(stock) {
    if (!stock) return;
    $("#stockCode").value = stock.code;
    $("#stockName").value = stock.name;
    $("#assetType").value = stock.assetType || "stock";
    updateAssetHint(stock);
  }

  function syncStockFields(sourceId) {
    if (sourceId === "stockCode") {
      applyStock(stockForCode($("#stockCode").value));
      return;
    }
    const key = $("#stockName").value.trim().toLocaleLowerCase("zh-Hant-TW");
    applyStock(stockByName.get(key));
  }

  function selectedStockMetadata() {
    const stock = stockForCode($("#stockCode").value);
    return {
      market: stock ? stock.market : "自訂",
      assetType: $("#assetType").value || (stock && stock.assetType) || "stock",
      isLeveragedOrInverse: Boolean(stock && stock.isLeveragedOrInverse)
    };
  }

  function updateAssetHint(stock) {
    const current = stock || stockForCode($("#stockCode").value);
    const assetType = $("#assetType").value;
    const market = current ? current.market : "自訂";
    $("#assetHint").textContent = `${market} · ${Config.ASSET_LABELS[assetType] || Config.ASSET_LABELS.stock}`;
  }

  function formDraft() {
    const metadata = selectedStockMetadata();
    const type = selectedType();
    const reductionKind = type === "reduction" ? $("#reductionKind").value : null;
    return {
      stockCode: $("#stockCode").value.trim().toUpperCase(),
      stockName: $("#stockName").value.trim(),
      date: $("#date").value,
      type: selectedType(),
      market: metadata.market,
      assetType: metadata.assetType,
      isLeveragedOrInverse: metadata.isLeveragedOrInverse,
      isDayTrade: type === "sell" && metadata.assetType === "stock" && $("#isDayTrade").checked,
      price: inputNumber("#price"),
      shares: inputNumber("#shares"),
      cashReceivedActual: type === "dividend" || (type === "reduction" && reductionKind === "cash")
        ? optionalInputNumber("#cashReceivedActual")
        : null,
      reductionKind,
      reducedShares: type === "reduction" ? optionalInputNumber("#reducedShares") : null,
      notes: $("#notes").value.trim(),
      commissionActual: optionalInputNumber("#actualCommission"),
      taxActual: optionalInputNumber("#actualTax")
    };
  }

  function validateRecord(record, calculation) {
    if (!record.stockCode || !record.stockName) return "請輸入股票代號與名稱";
    if (!isRealDate(record.date)) return "請選擇正確日期";
    if (!Config.TYPE_LABELS[record.type]) return "交易類型不正確";
    if (!Number.isFinite(record.price) || record.price < 0) return "價格必須是有限的非負數";
    if ((record.type === "buy" || record.type === "sell") && record.price <= 0) return "成交股價必須大於 0";
    if (!Number.isSafeInteger(record.shares) || record.shares <= 0) return "股數必須是正整數";
    const gross = record.price * record.shares;
    if (!Utils.isSafeAmount(gross)) return "金額過大，無法安全計算";
    if (record.commissionActual !== null && !Utils.isSafeAmount(record.commissionActual)) return "實際手續費不正確或超出安全範圍";
    if (record.taxActual !== null && !Utils.isSafeAmount(record.taxActual)) return "實際證交稅不正確或超出安全範圍";
    if (record.cashReceivedActual !== null && !Utils.isSafeAmount(record.cashReceivedActual)) return "實收現金不正確或超出安全範圍";
    if (record.type === "stockDividend" && !Number.isSafeInteger(gross)) return "實際配發股數必須是整數";
    if (record.type === "split" && (record.price <= 0 || !Number.isSafeInteger(gross))) return "分割後股數必須是正整數";
    if (record.type === "reduction") {
      if (!["cash", "loss"].includes(record.reductionKind)) return "請選擇減資類型";
      if (!Number.isSafeInteger(record.reducedShares) || record.reducedShares <= 0) return "請輸入實際減少股數";
    }
    if (!Calculator.isSafeCalculation(calculation)) {
      return "交易總額超出安全計算範圍，請檢查價格與費用";
    }
    return "";
  }

  function isRealDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  }

  function recordIssue(record) {
    if (!record || typeof record !== "object") return "記錄不是可讀取的物件";
    if (!record.id) return "缺少記錄 ID";
    if (!record.stockCode || !record.stockName) return "缺少股票代號或名稱";
    if (!isRealDate(record.date)) return "日期格式不正確";
    if (!Config.TYPE_LABELS[record.type]) return "交易類型不正確";
    const price = Number(record.price);
    const shares = Number(record.shares);
    if (!Number.isFinite(price) || price < 0) return "價格不正確";
    if (!Number.isSafeInteger(shares) || shares <= 0) return "股數不正確";
    if (!Utils.isSafeAmount(price * shares)) return "金額超出安全範圍";
    for (const key of ["commissionActual", "taxActual", "cashReceivedActual"]) {
      if (record[key] !== null && record[key] !== undefined &&
          !Utils.isSafeAmount(record[key])) return "實際費用不正確";
    }
    if (record.reducedShares !== null && record.reducedShares !== undefined &&
        (!Number.isSafeInteger(Number(record.reducedShares)) || Number(record.reducedShares) <= 0)) return "減少股數不正確";
    if (Number(record.calculationVersion) >= Config.CALCULATION_VERSION) {
      for (const key of ["grossAmount", "netAmount", "commissionEstimated", "taxEstimated"]) {
        const allowNegative = key === "netAmount";
        if (!Utils.isSafeAmount(record[key], allowNegative)) return "已保存的費用快照不完整";
      }
    }
    return "";
  }

  function priceTick(price, direction) {
    if ($("#assetType").value !== "stock") {
      if (direction < 0) return price <= 50 ? 0.01 : 0.05;
      return price < 50 ? 0.01 : 0.05;
    }
    if (direction < 0) {
      if (price <= 10) return 0.01;
      if (price <= 50) return 0.05;
      if (price <= 100) return 0.1;
      if (price <= 500) return 0.5;
      if (price <= 1000) return 1;
      return 5;
    }
    if (price < 10) return 0.01;
    if (price < 50) return 0.05;
    if (price < 100) return 0.1;
    if (price < 500) return 0.5;
    if (price < 1000) return 1;
    return 5;
  }

  function adjustPrice(direction) {
    if (selectedType() !== "buy" && selectedType() !== "sell") return;
    const current = inputNumber("#price");
    const tick = priceTick(current, direction);
    const precision = tick < 0.1 ? 2 : tick < 1 ? 1 : 0;
    const units = direction > 0
      ? Math.floor((current + 1e-9) / tick) + 1
      : Math.ceil((current - 1e-9) / tick) - 1;
    $("#price").value = Math.max(0, Number((units * tick).toFixed(precision)));
    updatePreview();
    scheduleDraftSave();
  }

  function taxHint(calculation, type) {
    if (type === "buy") return "買進不收證交稅";
    if (type !== "sell") return "";
    if (calculation.tax.ruleId === "stock-day-trade-0.15pct") return "現股當沖 0.15%";
    if (calculation.tax.ruleId === "stock-sell-0.3pct") return "股票賣出 0.3%";
    if (calculation.tax.ruleId === "bond-etf-exempt") return "債券 ETF 暫停課稅（至 2026-12-31）";
    return "ETF 賣出 0.1%";
  }

  function updateFormForType() {
    const type = selectedType();
    const labels = Config.FIELD_LABELS[type];
    $("#priceLabel").textContent = labels[0];
    $("#sharesLabel").textContent = labels[1];
    $("#netLabel").textContent = labels[2];
    const trade = type === "buy" || type === "sell";
    const stockSale = type === "sell" && $("#assetType").value === "stock";
    $("#priceMinus").disabled = !trade;
    $("#pricePlus").disabled = !trade;
    $("#dayTradeRow").hidden = !stockSale;
    if (!stockSale) $("#isDayTrade").checked = false;
    $("#costAdjustments").hidden = !trade;
    $("#actualTaxField").hidden = type !== "sell";
    $("#actualTax").disabled = type !== "sell";

    const specialEvent = ["dividend", "stockDividend", "reduction", "split"].includes(type);
    const reduction = type === "reduction";
    const cashReduction = reduction && $("#reductionKind").value === "cash";
    const lossReduction = reduction && !cashReduction;
    const cashEvent = type === "dividend" || cashReduction;
    $("#priceField").hidden = lossReduction;
    if (lossReduction) $("#price").value = "0";
    if (reduction) {
      $("#priceLabel").textContent = cashReduction ? "每股退還現金" : "減資比例／記錄值";
      $("#sharesLabel").textContent = "減資前適用股數";
    }
    $("#eventOptions").hidden = !specialEvent;
    $("#reductionKindField").hidden = !reduction;
    $("#reducedSharesField").hidden = !reduction;
    $("#cashReceivedField").hidden = !cashEvent;
    $("#reductionKind").disabled = !reduction;
    $("#reducedShares").disabled = !reduction;
    $("#cashReceivedActual").disabled = !cashEvent;
    $("#cashReceivedLabel").textContent = type === "dividend" ? "實收配息（選填）" : "實收減資現金（選填）";

    const hints = {
      dividend: "日期建議填除息日，才能歸入正確投資輪次；實收配息留白時使用每股配息 × 配息股數。",
      stockDividend: "例如每股配 0.1 股、原有 1,000 股，會增加 100 股；總成本不變。",
      reduction: cashReduction
        ? "填寫減資前股數、實際減少股數與每股退還現金；實收金額可依通知單覆寫。"
        : "只需填減資前股數與實際減少股數；總成本不變，因此每股成本會提高。",
      split: "例如 1 拆 2：分割比例填 2；股數加倍，總成本不變。"
    };
    $("#eventHint").textContent = hints[type] || "";
    if (type === "reduction") $("#netLabel").textContent = cashReduction ? "實收減資現金" : "記錄值";
  }

  function updatePreview() {
    updateFormForType();
    const draft = formDraft();
    const calculation = Calculator.calculateTransaction(draft, settings);
    $("#previewGross").textContent = money(calculation.gross);
    $("#previewFee").textContent = money(calculation.commission.charged, 0);
    $("#previewFeeLabel").textContent = calculation.commission.actual === null ? "估算手續費" : "實際手續費";
    $("#previewTax").textContent = money(calculation.tax.charged, 0);
    const cashPreview = (draft.type === "dividend" || (draft.type === "reduction" && draft.reductionKind === "cash")) &&
      draft.cashReceivedActual !== null && Number.isFinite(draft.cashReceivedActual)
      ? draft.cashReceivedActual
      : calculation.net;
    $("#previewNet").textContent = money(cashPreview);
    const mixedLotHint = (draft.type === "buy" || draft.type === "sell") && draft.shares >= 1000 && draft.shares % 1000 !== 0
      ? "；股數同時含整股與零股時，券商可能分筆計費，請依對帳單覆寫"
      : "";
    const trade = draft.type === "buy" || draft.type === "sell";
    const roundingLabels = { round: "四捨五入", floor: "無條件捨去", ceil: "無條件進位" };
    const feeHint = calculation.commission.actual === null
      ? `手續費估算：${number(settings.feeDiscount)} 折 · ${calculation.lotType === "odd" ? "零股" : "整股"}最低 ${money(calculation.commission.minimum, 0)} · ${roundingLabels[settings.feeRounding] || "四捨五入"}`
      : `已使用對帳單手續費 ${money(calculation.commission.actual, 0)}`;
    $("#taxHint").textContent = trade ? `${feeHint}；${taxHint(calculation, draft.type)}${mixedLotHint}` : "";
    $("#taxHint").hidden = !trade;

    if (draft.type === "buy" || draft.type === "sell") {
      const tick = priceTick(draft.price, 1);
      $("#priceTickHint").textContent = `${draft.assetType === "stock" ? "股票" : "ETF"}升降單位 ${tick} 元`;
    } else {
      $("#priceTickHint").textContent = "可輸入小數";
    }
    updateAssetHint();
  }

  function scheduleDraftSave() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      const payload = { editingId, savedAt: new Date().toISOString(), form: formDraft() };
      Storage.saveDraft(payload).then(() => {
        draftSaveWarningShown = false;
      }).catch((error) => {
        console.error("草稿儲存失敗", error);
        if (!draftSaveWarningShown) {
          draftSaveWarningShown = true;
          showToast("草稿自動保存失敗；請勿關閉頁面並先匯出備份");
        }
      });
    }, 350);
  }

  function fillForm(record) {
    const enriched = enrichRecord(record);
    $("#stockCode").value = enriched.stockCode || "";
    $("#stockName").value = enriched.stockName || "";
    $("#date").value = enriched.date || "";
    $("#type").value = enriched.type || "buy";
    $("#assetType").value = enriched.assetType || "stock";
    $("#isDayTrade").checked = Boolean(enriched.isDayTrade);
    $("#price").value = enriched.price == null ? "" : enriched.price;
    $("#shares").value = enriched.shares == null ? "" : enriched.shares;
    $("#notes").value = enriched.notes || "";
    $("#actualCommission").value = enriched.commissionActual == null ? "" : enriched.commissionActual;
    $("#actualTax").value = enriched.taxActual == null ? "" : enriched.taxActual;
    $("#cashReceivedActual").value = enriched.cashReceivedActual == null ? "" : enriched.cashReceivedActual;
    $("#reductionKind").value = enriched.reductionKind || "cash";
    $("#reducedShares").value = enriched.reducedShares == null ? "" : enriched.reducedShares;
    updatePreview();
  }

  async function resetForm(clearSavedDraft) {
    clearTimeout(draftTimer);
    editingId = null;
    $("#recordForm").reset();
    $("#date").value = Utils.localDateString(new Date());
    $("#assetType").value = "stock";
    $("#formTitle").textContent = "新增記錄";
    $("#editingTag").hidden = true;
    $("#cancelEdit").hidden = true;
    $("#saveButton").textContent = "儲存記錄";
    updatePreview();
    if (clearSavedDraft) await Storage.clearDraft();
  }

  function recordCalculation(record) {
    return Calculator.storedOrEstimated(enrichRecord(record), settings);
  }

  function cashReceived(record, calculation) {
    const actual = Utils.optionalNumber(record.cashReceivedActual);
    return actual === null ? calculation.gross : actual;
  }

  function renderStats() {
    const totals = records.reduce((result, record) => {
      if (recordIssue(record)) return result;
      const calculation = recordCalculation(record);
      if (record.type === "buy") result.buy += calculation.net;
      if (record.type === "sell") result.sell += calculation.net;
      if (record.type === "dividend") result.dividend += cashReceived(record, calculation);
      return result;
    }, { buy: 0, sell: 0, dividend: 0 });
    $("#statCount").textContent = number(records.length, 0);
    $("#recordCountBadge").textContent = number(records.length, 0);
    $("#statBuy").textContent = money(totals.buy, 0);
    $("#statSell").textContent = money(totals.sell, 0);
    $("#statDividend").textContent = money(totals.dividend, 0);
  }

  function rebuildLedgerIndex() {
    const validRecords = records.filter((record) => !recordIssue(record)).map(enrichRecord);
    portfolioState = Portfolio.calculate(validRecords, settings);
    ledgerIndex = LedgerModel.build(records, portfolioState);
    if (selectedStockCode && !LedgerModel.stockFor(ledgerIndex, selectedStockCode)) selectedStockCode = null;
  }

  function stockCardPresentation(stock) {
    const stockRecords = LedgerModel.recordsFor(ledgerIndex, stock.stockCode);
    const demo = stockRecords.length > 0 && stockRecords.every(DemoData.isDemo);
    const cycle = stock.currentCycle;
    const warningCount = stock.warnings.length;
    if (!cycle) {
      const latestClosed = [...stock.cycles].filter((item) => item.isClosed)
        .sort((a, b) => b.cycleNumber - a.cycleNumber)[0];
      return {
        stockCode: stock.stockCode,
        stockName: stock.stockName,
        demo,
        active: false,
        lead: null,
        leadSuffix: "",
        metrics: [
          { label: "已清倉總損益", value: latestClosed ? money(stock.totals.closedReturn) : "—", tone: stock.totals.closedReturn >= 0 ? "positive" : "negative" }
        ],
        marketMetrics: [],
        foot: `${stock.completedCycles ? `已完成 ${number(stock.completedCycles, 0)} 輪` : "尚無完整輪次"} · 最後活動 ${stock.lastActivityDate || "日期不明"}`,
        warning: warningCount ? `有 ${number(warningCount, 0)} 筆流水未能安全納入輪次，請進入個股查看。` : ""
      };
    }

    const closePrice = MarketData.priceFor(stock.stockCode);
    const marketValue = closePrice === null ? null : closePrice * cycle.shares;
    const unrealizedPnl = marketValue === null ? null : marketValue - cycle.bookCost;
    return {
      stockCode: stock.stockCode,
      stockName: stock.stockName,
      demo,
      active: true,
      lead: number(cycle.shares, 0),
      leadSuffix: "股",
      metrics: [
        { label: "帳面每股成本", value: money(cycle.shares ? cycle.bookCost / cycle.shares : 0, 2) },
        ...(unrealizedPnl === null ? [] : [
          { label: "未實現損益", value: money(unrealizedPnl), tone: unrealizedPnl >= 0 ? "positive" : "negative" }
        ])
      ],
      marketMetrics: [],
      foot: `第 ${number(cycle.cycleNumber, 0)} 輪 · 最後活動 ${stock.lastActivityDate || "日期不明"}`,
      warning: warningCount ? `有 ${number(warningCount, 0)} 筆流水未能安全納入輪次，請進入個股查看。` : cycle.hasEstimatedRecords ? "含舊版記錄，部分買賣費用依目前設定估算。" : ""
    };
  }

  function renderStockOverview() {
    const visible = LedgerModel.filterStocks(ledgerIndex.stocks, $("#stockSearch").value);
    const active = visible.filter((stock) => stock.currentCycle).map(stockCardPresentation);
    const closed = visible.filter((stock) => !stock.currentCycle).map(stockCardPresentation);
    $("#positionCountBadge").textContent = `${number(ledgerIndex.stocks.length, 0)} 檔`;
    $("#activeStockCount").textContent = `${number(active.length, 0)} 檔`;
    $("#closedStockCount").textContent = `${number(closed.length, 0)} 檔`;
    $("#activeStocks").innerHTML = RecordsView.stockList(active, "目前沒有持股", records.length ? "已清倉股票仍整理在下方。" : "新增買進後會建立第一個投資輪次。");
    $("#closedStocks").innerHTML = RecordsView.stockList(closed, visible.length ? "沒有已清倉股票" : "找不到相符個股", visible.length ? "持股全部出清後會自動移到這裡。" : "請調整搜尋條件。");
    $("#portfolioWarnings").hidden = !portfolioState.warnings.length;
    $("#portfolioWarnings").textContent = portfolioState.warnings.length
      ? `有 ${number(portfolioState.warnings.length, 0)} 筆記錄未能安全納入持股成本；原始資料仍保留，請進入個股或全部流水帳檢查。`
      : "";
  }

  function cyclePresentation(cycle, stockCode) {
    const active = !cycle.isClosed;
    const result = active ? cycle.realizedTradingPnl : Number(cycle.totalReturn) || 0;
    const closePrice = active ? MarketData.priceFor(stockCode) : null;
    const marketValue = closePrice === null ? null : closePrice * cycle.shares;
    const unrealizedPnl = marketValue === null ? null : marketValue - cycle.bookCost;
    return {
      number: number(cycle.cycleNumber, 0),
      active,
      period: `${cycle.startDate || "日期不明"} ～ ${active ? "持有中" : cycle.endDate || "日期不明"}`,
      metrics: active ? [
        { label: "目前股數", value: `${number(cycle.shares, 0)} 股` },
        { label: "帳面每股成本", value: money(cycle.shares ? cycle.bookCost / cycle.shares : 0, 2) },
        { label: "回本每股成本", value: money(cycle.shares ? cycle.recoveryCost / cycle.shares : 0, 2), accent: true },
        { label: cycle.recoveryCost >= 0 ? "尚待回收" : "已超額回收", value: money(Math.abs(cycle.recoveryCost)), accent: true }
      ] : [
        { label: "買進支出", value: money(cycle.buyOutflows) },
        { label: "賣出收入", value: money(cycle.saleProceeds) },
        { label: "本輪配息", value: money(cycle.dividends) },
        { label: "最終結果", value: money(result), tone: result >= 0 ? "positive" : "negative", accent: true }
      ],
      marketMetrics: closePrice === null ? [] : [
        { label: "參考收盤", value: money(closePrice, 2) },
        { label: "參考市值", value: money(marketValue) },
        { label: "未實現損益", value: money(unrealizedPnl), tone: unrealizedPnl >= 0 ? "positive" : "negative" }
      ],
      help: active ? "回本成本已扣除本輪賣出收入、配息與現金減資。" : "",
      foot: active
        ? `剩餘帳面成本 ${money(cycle.bookCost)} · 本輪配息 ${money(cycle.dividends)}`
        : `${number(cycle.recordCount, 0)} 筆納入計算`,
      warning: cycle.warnings.length ? `本輪有 ${number(cycle.warnings.length, 0)} 筆流水未能安全納入。` : cycle.hasEstimatedRecords ? "含舊版記錄，部分買賣費用依目前設定估算。" : ""
    };
  }

  function renderStockDetail() {
    if (!selectedStockCode) return;
    const stock = LedgerModel.stockFor(ledgerIndex, selectedStockCode);
    if (!stock) {
      selectedStockCode = null;
      syncRecordsScreens();
      return;
    }
    $("#stockDetailTitle").textContent = `${stock.stockName} ${stock.stockCode}`;
    const stockRecords = LedgerModel.recordsFor(ledgerIndex, stock.stockCode);
    const demo = stockRecords.length > 0 && stockRecords.every(DemoData.isDemo);
    $("#stockDetailSubtitle").textContent = `${stock.currentCycle ? `目前第 ${number(stock.currentCycle.cycleNumber, 0)} 輪持有中` : "目前已清倉"} · 共 ${number(stock.recordCount, 0)} 筆流水${demo ? " · 示範資料" : ""}`;
    const cycles = [...stock.cycles].sort((a, b) => Number(a.isClosed) - Number(b.isClosed) || b.cycleNumber - a.cycleNumber);
    $("#stockCycles").innerHTML = RecordsView.cycleList(cycles.map((cycle) => cyclePresentation(cycle, stock.stockCode)));
    $("#stockRecords").innerHTML = RecordsView.recordList(stockRecords.map(recordPresentation), "這檔股票沒有流水", "請回到全部流水帳檢查資料。");
    switchStockDetailMode(stockDetailMode);
  }

  function openStockDetail(code) {
    const stock = LedgerModel.stockFor(ledgerIndex, code);
    if (!stock) return;
    recordsMode = "stocks";
    selectedStockCode = stock.stockCode;
    stockDetailMode = "cycles";
    syncRecordsScreens();
    renderStockDetail();
  }

  function renderMarketStatus() {
    const status = $("#marketStatus");
    const refresh = $("#refreshMarketData");
    const date = marketState.marketDate || "尚無資料";
    refresh.disabled = !marketState.canRefresh || marketState.status === "checking";
    refresh.textContent = marketState.status === "checking" ? "檢查中…" : "更新行情";

    if (marketState.status === "checking") {
      status.textContent = `收盤 ${date} · 檢查更新中`;
    } else if (!marketState.canRefresh && marketState.marketDate) {
      status.textContent = `收盤 ${date} · 本機快照`;
    } else if (marketState.status === "stale" || marketState.status === "error") {
      status.textContent = `收盤 ${date} · 沿用現有資料`;
    } else if (marketState.marketDate) {
      status.textContent = `收盤 ${date} · 每日更新一次`;
    } else {
      status.textContent = "尚無收盤行情 · 記帳不受影響";
    }
    refresh.title = marketState.canRefresh ? "立即重新讀取靜態行情檔" : "file:// 本機模式使用內建行情，不會連線";
  }

  async function loadMarketData(force) {
    marketState = { ...marketState, status: "checking" };
    renderMarketStatus();
    try {
      marketState = await MarketData.initialize(force);
    } catch (error) {
      console.error(error);
      marketState = { ...marketState, status: "error", error: "行情載入失敗" };
    }
    renderMarketStatus();
    renderStockOverview();
    renderStockDetail();
  }

  function recordPresentation(record) {
    const issue = recordIssue(record);
    if (issue) return {
      issue,
      id: record && record.id,
      stockName: record && record.stockName,
      stockCode: record && record.stockCode,
      date: record && record.date,
      demo: DemoData.isDemo(record)
    };
    const calculation = recordCalculation(record);
    const rawMainAmount = record.type === "buy" || record.type === "sell"
      ? calculation.net
      : (record.type === "dividend" || (record.type === "reduction" && record.reductionKind !== "loss"))
        ? cashReceived(record, calculation)
        : calculation.gross;
    let amountLabel = "金額";
    let mainAmount = money(rawMainAmount);
    if (record.type === "buy") amountLabel = "支出";
    if (record.type === "sell") amountLabel = "收入";
    if (record.type === "dividend" || (record.type === "reduction" && record.reductionKind !== "loss")) amountLabel = "實收";
    if (record.type === "stockDividend") {
      amountLabel = "配發";
      mainAmount = `${number(rawMainAmount, 0)} 股`;
    }
    if (record.type === "split") {
      amountLabel = "分割後";
      mainAmount = `${number(rawMainAmount, 0)} 股`;
    }
    if (record.type === "reduction" && record.reductionKind === "loss") {
      amountLabel = "減少";
      mainAmount = `${number(record.reducedShares, 0)} 股`;
    }
    const costParts = [];
    if (calculation.commission.charged) costParts.push(`手續費 ${money(calculation.commission.charged, 0)}`);
    if (calculation.tax.charged) costParts.push(`證交稅 ${money(calculation.tax.charged, 0)}`);
    const actionParts = [];
    if (record.type === "reduction" && record.reducedShares) actionParts.push(`減少 ${number(record.reducedShares, 0)} 股`);
    if (record.type === "reduction") actionParts.push(record.reductionKind === "loss" ? "虧損減資" : "現金減資");
    let details = `${Config.FIELD_LABELS[record.type][0]} ${number(record.price)} × ${number(record.shares)} 股${costParts.length ? ` · ${costParts.join(" · ")}` : ""}${actionParts.length ? ` · ${actionParts.join(" · ")}` : ""}`;
    if (record.type === "reduction" && record.reductionKind === "loss") {
      details = `減資前 ${number(record.shares, 0)} 股 · 減少 ${number(record.reducedShares, 0)} 股 · 虧損減資`;
    } else if (record.type === "reduction") {
      details = `每股退還 ${number(record.price)} × ${number(record.shares, 0)} 股${actionParts.length ? ` · ${actionParts.join(" · ")}` : ""}`;
    }
    return {
      id: record.id,
      stockName: record.stockName,
      stockCode: record.stockCode,
      date: record.date,
      typeLabel: Config.TYPE_LABELS[record.type],
      amountLabel,
      mainAmount,
      details,
      legacy: calculation.legacy,
      notes: record.notes || "",
      demo: DemoData.isDemo(record)
    };
  }

  function renderRecords() {
    const visible = LedgerModel.filterRecords(records, $("#search").value, $("#filterType").value);
    $("#records").innerHTML = RecordsView.recordList(
      visible.map(recordPresentation),
      records.length ? "找不到相符記錄" : "還沒有記錄",
      records.length ? "請調整搜尋或篩選條件" : "從第一筆買進開始吧"
    );
  }

  function populateSettings() {
    $("#feeDiscount").value = settings.feeDiscount;
    $("#regularMinFee").value = settings.regularMinFee;
    $("#oddLotMinFee").value = settings.oddLotMinFee;
    $("#feeRounding").value = settings.feeRounding;
  }

  function render() {
    records.sort((a, b) => String(b && b.date || "").localeCompare(String(a && a.date || "")) || String(b && b.createdAt || "").localeCompare(String(a && a.createdAt || "")));
    rebuildStockDirectory();
    rebuildLedgerIndex();
    renderStats();
    renderStockOverview();
    renderMarketStatus();
    renderRecords();
    renderStockDetail();
    syncRecordsScreens();
    populateSettings();
    updatePreview();
  }

  async function loadAll() {
    const [savedRecords, savedSettings] = await Promise.all([Storage.getAllRecords(), Storage.getSettings()]);
    records = savedRecords || [];
    settings = normalizeSettings(savedSettings);
    render();
  }

  async function ensureDemoData() {
    const [savedRecords, savedSettings, demoState] = await Promise.all([
      Storage.getAllRecords(),
      Storage.getSettings(),
      Storage.getDemoState()
    ]);
    const action = DemoData.autoSeedAction(savedRecords, demoState);
    if (action === "none") return;
    const now = new Date().toISOString();
    if (action === "skip") {
      await Storage.putDemoState({ status: "skipped", updatedAt: now });
      return;
    }
    const demoRecords = DemoData.create(normalizeSettings(savedSettings));
    await Storage.saveDemoRecords(demoRecords, { status: "loaded", updatedAt: now });
  }

  async function saveRecord(event) {
    event.preventDefault();
    clearTimeout(draftTimer);
    const existing = editingId ? records.find((item) => item.id === editingId) : null;
    const draft = formDraft();
    const calculation = Calculator.calculateTransaction(draft, settings);
    const validationError = validateRecord(draft, calculation);
    if (validationError) {
      showToast(validationError);
      scheduleDraftSave();
      return;
    }

    const now = new Date().toISOString();
    const record = {
      ...draft,
      ...Calculator.snapshot(calculation, settings),
      id: editingId || Utils.uid(),
      createdAt: existing && existing.createdAt ? existing.createdAt : now,
      updatedAt: now
    };

    $("#saveButton").disabled = true;
    try {
      await Storage.saveRecordAndClearDraft(record, { mustExist: Boolean(editingId) });
      if (global.navigator.storage && global.navigator.storage.persist) {
        global.navigator.storage.persist().catch(() => {});
      }
      await resetForm(false);
      await loadAll();
      switchTab("records");
      showToast(existing ? "已更新記錄" : "已儲存記錄");
    } catch (error) {
      console.error(error);
      showToast("儲存失敗，輸入已保留，請再試一次");
      scheduleDraftSave();
    } finally {
      $("#saveButton").disabled = false;
    }
  }

  function editRecord(id) {
    const record = records.find((item) => item.id === id);
    if (!record) return;
    editingId = id;
    fillForm(record);
    $("#formTitle").textContent = "編輯記錄";
    $("#editingTag").hidden = false;
    $("#cancelEdit").hidden = false;
    $("#saveButton").textContent = "更新記錄";
    switchTab("add");
    scheduleDraftSave();
  }

  async function removeRecord(id) {
    const record = records.find((item) => item.id === id);
    const label = record ? (Config.TYPE_LABELS[record.type] || "異常") : "";
    if (!record || !confirm(`要刪除 ${record.stockName || record.stockCode || "這筆"} ${label}記錄嗎？刪除後只能用 CSV 備份復原。`)) return;
    try {
      await Storage.deleteRecord(id);
      if (editingId === id) await resetForm(true);
      await loadAll();
      showToast("已刪除記錄");
    } catch (error) {
      console.error(error);
      showToast("刪除失敗，原記錄仍保留");
    }
  }

  function downloadCsv() {
    const realRecords = DemoData.withoutDemo(records);
    const blob = new Blob([Csv.create(realRecords, settings)], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    const stamp = Utils.localDateString(new Date()).replace(/-/g, "");
    link.href = URL.createObjectURL(blob);
    link.download = `股票帳本備份-${stamp}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    showToast(realRecords.length === records.length ? "已匯出 CSV" : "已匯出正式記錄；示範資料未包含");
  }

  async function importCsv(file) {
    const parsed = Csv.parse(await file.text());
    const demoCount = parsed.records.filter(DemoData.isDemo).length;
    const importedRecords = DemoData.withoutDemo(parsed.records).map(enrichRecord);
    const importedSettings = parsed.settings ? normalizeSettings(parsed.settings) : null;
    const currentIds = new Set(records.map((record) => record.id));
    const updates = importedRecords.filter((record) => currentIds.has(record.id)).length;
    const settingsNote = importedSettings ? "，並套用備份中的手續費設定" : "";
    const demoNote = demoCount ? `；另有 ${demoCount} 筆示範資料會略過` : "";
    const message = `準備合併匯入 ${importedRecords.length} 筆，其中 ${updates} 筆會更新相同 ID 的既有記錄${settingsNote}${demoNote}。其他現有記錄不會被刪除。要繼續嗎？`;
    if (!confirm(message)) return false;
    await Storage.importAtomically(importedRecords, importedSettings);
    await loadAll();
    showToast(`已安全匯入 ${importedRecords.length} 筆記錄`);
    return true;
  }

  async function loadDemoRecords() {
    const existingCount = records.filter(DemoData.isDemo).length;
    const message = existingCount
      ? `要把目前 ${existingCount} 筆示範資料重設為內建範例嗎？正式記錄不會受影響。`
      : `要加入 ${DemoData.count} 筆示範資料嗎？正式記錄不會受影響。`;
    if (!confirm(message)) return;
    try {
      await Storage.saveDemoRecords(DemoData.create(settings), {
        status: "loaded",
        updatedAt: new Date().toISOString()
      }, records.filter(DemoData.isDemo).map((record) => record.id));
      $("#stockSearch").value = "";
      await loadAll();
      $("#settingsDialog").close();
      switchRecordsMode("stocks");
      switchTab("records");
      showToast(`已載入 ${DemoData.count} 筆示範資料`);
    } catch (error) {
      console.error(error);
      showToast("示範資料載入失敗，原資料未變更");
    }
  }

  async function deleteDemoRecords() {
    const demoRecords = records.filter(DemoData.isDemo);
    if (!demoRecords.length) {
      try {
        await Storage.putDemoState({ status: "removed", updatedAt: new Date().toISOString() });
        showToast("目前沒有示範資料");
      } catch (error) {
        console.error(error);
        showToast("無法更新示範資料狀態");
      }
      return;
    }
    if (!confirm(`要刪除全部 ${demoRecords.length} 筆示範資料嗎？正式記錄不會受影響。`)) return;
    try {
      const demoIds = demoRecords.map((record) => record.id);
      const wasEditingDemo = demoIds.includes(editingId);
      await Storage.deleteDemoRecords(demoIds, {
        status: "removed",
        updatedAt: new Date().toISOString()
      });
      if (wasEditingDemo) await resetForm(false);
      await loadAll();
      $("#settingsDialog").close();
      switchRecordsMode("stocks");
      showToast("已刪除全部示範資料，不會在重新開啟時恢復");
    } catch (error) {
      console.error(error);
      showToast("示範資料刪除失敗，原資料仍保留");
    }
  }

  async function restoreDraft() {
    const draft = await Storage.getDraft();
    if (!draft || !draft.form) return;
    if (draft.editingId && DemoData.isDemo({ id: draft.editingId }) &&
        !records.some((record) => record.id === draft.editingId)) {
      await Storage.clearDraft();
      showToast("示範記錄已刪除，舊編輯草稿未復原");
      return;
    }
    const form = draft.form;
    const hasInput = form.stockCode || form.stockName || form.price || form.shares || form.notes;
    if (!hasInput) return;
    editingId = draft.editingId || null;
    fillForm(form);
    if (editingId) {
      $("#formTitle").textContent = "編輯記錄";
      $("#editingTag").hidden = false;
      $("#cancelEdit").hidden = false;
      $("#saveButton").textContent = "更新記錄";
    }
    switchTab("add");
    showToast("已復原上次未儲存的輸入");
  }

  function bindEvents() {
    $("#recordForm").addEventListener("input", (event) => {
      if (event.target.id === "stockCode" || event.target.id === "stockName") syncStockFields(event.target.id);
      updatePreview();
      scheduleDraftSave();
    });
    $("#recordForm").addEventListener("change", (event) => {
      if (event.target.id === "stockCode" || event.target.id === "stockName") syncStockFields(event.target.id);
      updatePreview();
      scheduleDraftSave();
    });
    $("#recordForm").addEventListener("submit", saveRecord);
    $("#cancelEdit").addEventListener("click", () => {
      resetForm(true).catch((error) => {
        console.error(error);
        showToast("表單已重設，但舊草稿清除失敗");
      });
    });

    document.querySelectorAll("[data-price-direction]").forEach((button) => {
      button.addEventListener("click", () => adjustPrice(Number(button.dataset.priceDirection)));
    });
    document.querySelectorAll("[data-shares-add]").forEach((button) => {
      button.addEventListener("click", () => {
        const current = Math.max(0, Math.trunc(inputNumber("#shares")));
        const addition = Number(button.dataset.sharesAdd);
        if (current > Number.MAX_SAFE_INTEGER - addition) {
          showToast("股數過大，無法再增加");
          return;
        }
        $("#shares").value = current + addition;
        updatePreview();
        scheduleDraftSave();
      });
    });
    $("#clearActualCosts").addEventListener("click", () => {
      $("#actualCommission").value = "";
      $("#actualTax").value = "";
      updatePreview();
      scheduleDraftSave();
    });

    document.querySelectorAll("[data-tab]").forEach((button) => {
      button.addEventListener("click", () => switchTab(button.dataset.tab));
    });
    document.querySelectorAll("[data-records-mode]").forEach((button) => {
      button.addEventListener("click", () => switchRecordsMode(button.dataset.recordsMode));
    });
    document.querySelectorAll("[data-stock-detail-mode]").forEach((button) => {
      button.addEventListener("click", () => switchStockDetailMode(button.dataset.stockDetailMode));
    });
    $("#backToStockOverview").addEventListener("click", () => switchRecordsMode("stocks"));
    $("#stockSearch").addEventListener("input", renderStockOverview);
    $("#search").addEventListener("input", renderRecords);
    $("#filterType").addEventListener("change", renderRecords);
    $("#refreshMarketData").addEventListener("click", () => loadMarketData(true));
    $("#recordsPanel").addEventListener("click", (event) => {
      const stockCard = event.target.closest("[data-stock-code]");
      const edit = event.target.closest("[data-edit]");
      const remove = event.target.closest("[data-delete]");
      if (stockCard) openStockDetail(stockCard.dataset.stockCode);
      if (edit) editRecord(edit.dataset.edit);
      if (remove) removeRecord(remove.dataset.delete);
    });
    $("#recordsPanel").addEventListener("keydown", (event) => {
      const stockCard = event.target.closest("[data-stock-code]");
      if (!stockCard || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      openStockDetail(stockCard.dataset.stockCode);
    });

    $("#openSettings").addEventListener("click", () => $("#settingsDialog").showModal());
    $("#closeSettings").addEventListener("click", () => $("#settingsDialog").close());
    $("#settingsDialog").addEventListener("click", (event) => {
      if (event.target === $("#settingsDialog")) $("#settingsDialog").close();
    });
    $("#settingsForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const next = {
        feeDiscount: inputNumber("#feeDiscount"),
        regularMinFee: inputNumber("#regularMinFee"),
        oddLotMinFee: inputNumber("#oddLotMinFee"),
        feeRounding: $("#feeRounding").value
      };
      if (next.feeDiscount < 0 || next.feeDiscount > 10 || next.regularMinFee < 0 || next.oddLotMinFee < 0 ||
          !Number.isSafeInteger(next.regularMinFee) || !Number.isSafeInteger(next.oddLotMinFee)) {
        showToast("請確認手續費設定");
        return;
      }
      try {
        await Storage.putSettings(next);
        settings = next;
        $("#settingsDialog").close();
        render();
        showToast("已儲存設定；舊版記錄會標示為估算");
      } catch (error) {
        console.error(error);
        showToast("設定儲存失敗，原設定仍保留");
      }
    });

    $("#exportCsv").addEventListener("click", downloadCsv);
    $("#loadDemoData").addEventListener("click", loadDemoRecords);
    $("#deleteDemoData").addEventListener("click", deleteDemoRecords);
    $("#importCsv").addEventListener("click", () => $("#csvFile").click());
    $("#csvFile").addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        await importCsv(file);
      } catch (error) {
        console.error(error);
        alert(`匯入失敗：${error.message}\n\n沒有任何資料被寫入。`);
      } finally {
        event.target.value = "";
      }
    });
  }

  async function init() {
    try {
      await Storage.open();
      try {
        await ensureDemoData();
      } catch (error) {
        console.error("示範資料初始化失敗", error);
      }
      bindEvents();
      await resetForm(false);
      await loadAll();
      await restoreDraft();
      loadMarketData(false);
      if (location.protocol !== "file:" && "serviceWorker" in navigator) {
        navigator.serviceWorker.register("./sw.js").catch(() => {});
      }
    } catch (error) {
      console.error(error);
      document.body.innerHTML = `<main class="shell"><section class="card"><div class="card-body"><h1>無法開啟帳本</h1><p>${Utils.escapeHtml(error.message || "瀏覽器無法使用 IndexedDB")}</p><p>請先不要清除瀏覽器資料，並重新開啟這個頁面。</p></div></section></main>`;
    }
  }

  init();
})(window);
