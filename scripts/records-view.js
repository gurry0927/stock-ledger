(function (global) {
  "use strict";

  const App = global.StockLedger;
  const { Utils } = App;
  const escape = Utils.escapeHtml;

  function empty(title, body, className) {
    return `<div class="${className || "empty"}"><strong>${escape(title)}</strong>${escape(body || "")}</div>`;
  }

  function recordItem(item) {
    const id = escape(item.id || "");
    if (item.issue) {
      return `<article class="record">
        <div class="record-top"><div><span class="stock">${escape(item.stockName || "無法辨識的記錄")}</span><span class="code">${escape(item.stockCode || "")}</span></div><div class="record-tags">${item.demo ? `<span class="demo-badge">示範</span>` : ""}<span class="tag">需檢查</span></div></div>
        <div class="invalid-note">這筆既有資料格式異常：${escape(item.issue)}。資料仍保留在帳本中，請先匯出 CSV 備份再處理。</div>
        <div class="record-bottom"><span class="meta">${escape(item.date || "日期不明")}</span>${id ? `<div class="record-actions"><button class="text-button" type="button" data-edit="${id}">嘗試編輯</button><button class="text-button delete" type="button" data-delete="${id}">刪除</button></div>` : ""}</div>
      </article>`;
    }
    const actionType = ["buy", "sell", "dividend", "stockDividend", "reduction", "split"].includes(item.type)
      ? item.type
      : "";
    return `<article class="record">
      <div class="record-top"><div><span class="stock">${escape(item.stockName)}</span><span class="code">${escape(item.stockCode)}</span></div><div class="record-tags">${item.demo ? `<span class="demo-badge">示範</span>` : ""}<span class="tag action-tag${actionType ? ` action-${actionType}` : ""}">${escape(item.typeLabel)}</span></div></div>
      <div class="record-main"><strong>${item.amountLabel ? `<small>${escape(item.amountLabel)}</small>` : ""}${escape(item.mainAmount)}</strong><div class="meta">${escape(item.details)}</div></div>
      ${item.legacy ? `<div class="legacy-note">舊記錄：費用依目前設定估算，編輯儲存後會固定。</div>` : ""}
      ${item.notes ? `<div class="meta record-note">${escape(item.notes)}</div>` : ""}
      <div class="record-bottom"><span class="meta">${escape(item.date)}</span><div class="record-actions"><button class="text-button" type="button" data-edit="${id}">編輯</button><button class="text-button delete" type="button" data-delete="${id}">刪除</button></div></div>
    </article>`;
  }

  function recordList(items, emptyTitle, emptyBody) {
    return items.length ? items.map(recordItem).join("") : empty(emptyTitle, emptyBody);
  }

  function metrics(items, className) {
    const market = className.includes("market-strip");
    return `<div class="${className}">${items.map((metric) =>
      `<div class="${market ? "market-metric" : "position-metric"}${metric.accent ? " recovery" : ""}"><span>${escape(metric.label)}</span><strong class="${market ? "market-pnl " : ""}${metric.tone || ""}">${escape(metric.value)}</strong></div>`
    ).join("")}</div>`;
  }

  function stockCard(item) {
    return `<article class="stock-overview-card" role="button" tabindex="0" data-stock-code="${escape(item.stockCode)}" aria-label="查看 ${escape(item.stockName)} ${escape(item.stockCode)}">
      <div class="position-top"><div class="position-title"><strong>${escape(item.stockName)}</strong><span>${escape(item.stockCode)}</span>${item.demo ? `<span class="demo-badge">示範</span>` : ""}</div><span class="stock-state ${item.active ? "active" : "closed"}">${item.active ? "持有中" : "已清倉"}</span></div>
      ${item.lead !== null && item.lead !== undefined ? `<div class="stock-card-lead">${escape(item.lead)}<small>${escape(item.leadSuffix || "")}</small></div>` : ""}
      ${metrics(item.metrics, "position-grid overview-metrics")}
      ${item.marketMetrics && item.marketMetrics.length ? metrics(item.marketMetrics, "market-strip") : ""}
      <div class="position-foot overview-foot"><span>${escape(item.foot)}</span><strong aria-hidden="true">›</strong></div>
      ${item.warning ? `<div class="portfolio-warning">${escape(item.warning)}</div>` : ""}
    </article>`;
  }

  function stockList(items, emptyTitle, emptyBody) {
    return items.length ? items.map(stockCard).join("") : empty(emptyTitle, emptyBody, "portfolio-empty");
  }

  function cycleCard(item) {
    return `<article class="cycle-card">
      <div class="position-top"><div><strong>第 ${escape(item.number)} 輪</strong><div class="meta">${escape(item.period)}</div></div><span class="stock-state ${item.active ? "active" : "closed"}">${item.active ? "進行中" : "已結束"}</span></div>
      ${metrics(item.metrics, "position-grid cycle-grid")}
      ${item.help ? `<p class="metric-help">${escape(item.help)}</p>` : ""}
      ${item.marketMetrics && item.marketMetrics.length ? metrics(item.marketMetrics, "market-strip") : ""}
      <div class="position-foot">${escape(item.foot)}</div>
      ${item.warning ? `<div class="portfolio-warning">${escape(item.warning)}</div>` : ""}
    </article>`;
  }

  function cycleList(items) {
    return items.length ? items.map(cycleCard).join("") : empty("尚無可用輪次", "請先檢查這檔股票的流水記錄。", "portfolio-empty");
  }

  App.RecordsView = Object.freeze({ recordList, stockList, cycleList });
})(typeof window !== "undefined" ? window : globalThis);
