(function (global) {
  "use strict";

  const App = global.StockLedger;
  const Config = App.Config;
  let database;

  function open() {
    if (database) return Promise.resolve(database);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(Config.DB_NAME, Config.DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        // 升級只補上缺少的 store，不刪除或重建既有資料。
        if (!db.objectStoreNames.contains(Config.STORE_RECORDS)) {
          const records = db.createObjectStore(Config.STORE_RECORDS, { keyPath: "id" });
          records.createIndex("date", "date");
          records.createIndex("stockCode", "stockCode");
        }
        if (!db.objectStoreNames.contains(Config.STORE_SETTINGS)) {
          db.createObjectStore(Config.STORE_SETTINGS, { keyPath: "key" });
        }
      };

      request.onsuccess = () => {
        database = request.result;
        database.onversionchange = () => {
          database.close();
          database = null;
        };
        resolve(database);
      };
      request.onerror = () => reject(request.error || new Error("無法開啟資料庫"));
      request.onblocked = () => reject(new Error("資料庫升級被其他分頁阻擋，請關閉其他帳本頁面後重試"));
    });
  }

  function transaction(storeNames, mode, work) {
    return new Promise((resolve, reject) => {
      const tx = database.transaction(storeNames, mode);
      let result;
      let settled = false;

      tx.oncomplete = () => {
        settled = true;
        resolve(result);
      };
      tx.onerror = () => {
        if (!settled) reject(tx.error || new Error("資料庫交易失敗"));
      };
      tx.onabort = () => {
        if (!settled) reject(tx.error || new Error("資料庫交易已取消"));
      };

      try {
        result = work(tx);
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  }

  function requestValue(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = database.transaction(storeName, "readonly");
      const request = key === undefined
        ? tx.objectStore(storeName).getAll()
        : tx.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("讀取資料失敗"));
    });
  }

  async function getAllRecords() {
    return requestValue(Config.STORE_RECORDS);
  }

  async function getSettings() {
    const saved = await requestValue(Config.STORE_SETTINGS, "main");
    return saved ? saved.value : null;
  }

  async function getDraft() {
    const saved = await requestValue(Config.STORE_SETTINGS, "draft");
    return saved ? saved.value : null;
  }

  async function getMarketCache() {
    const saved = await requestValue(Config.STORE_SETTINGS, "market_prices");
    return saved ? saved.value : null;
  }

  async function getDemoState() {
    const saved = await requestValue(Config.STORE_SETTINGS, "demo_state");
    return saved ? saved.value : null;
  }

  function putSettings(settings) {
    return transaction(Config.STORE_SETTINGS, "readwrite", (tx) => {
      tx.objectStore(Config.STORE_SETTINGS).put({ key: "main", value: settings });
    });
  }

  function saveDraft(draft) {
    return transaction(Config.STORE_SETTINGS, "readwrite", (tx) => {
      tx.objectStore(Config.STORE_SETTINGS).put({ key: "draft", value: draft });
    });
  }

  function clearDraft() {
    return transaction(Config.STORE_SETTINGS, "readwrite", (tx) => {
      tx.objectStore(Config.STORE_SETTINGS).delete("draft");
    });
  }

  function putMarketCache(cache) {
    return transaction(Config.STORE_SETTINGS, "readwrite", (tx) => {
      tx.objectStore(Config.STORE_SETTINGS).put({ key: "market_prices", value: cache });
    });
  }

  function putDemoState(state) {
    return transaction(Config.STORE_SETTINGS, "readwrite", (tx) => {
      tx.objectStore(Config.STORE_SETTINGS).put({ key: "demo_state", value: state });
    });
  }

  function saveDemoRecords(records, state, replacedIds) {
    return transaction([Config.STORE_RECORDS, Config.STORE_SETTINGS], "readwrite", (tx) => {
      const recordStore = tx.objectStore(Config.STORE_RECORDS);
      (Array.isArray(replacedIds) ? replacedIds : []).forEach((id) => recordStore.delete(id));
      records.forEach((record) => recordStore.put(record));
      tx.objectStore(Config.STORE_SETTINGS).put({ key: "demo_state", value: state });
    });
  }

  function deleteDemoRecords(ids, state) {
    return transaction([Config.STORE_RECORDS, Config.STORE_SETTINGS], "readwrite", (tx) => {
      const recordStore = tx.objectStore(Config.STORE_RECORDS);
      const settingsStore = tx.objectStore(Config.STORE_SETTINGS);
      const idSet = new Set(ids);
      ids.forEach((id) => recordStore.delete(id));
      settingsStore.put({ key: "demo_state", value: state });

      // 若草稿正在編輯被刪除的示範記錄，必須在同一交易清除；
      // 否則下次開啟可能復原舊草稿，讓使用者誤以為資料又出現。
      const draftRequest = settingsStore.get("draft");
      draftRequest.onsuccess = () => {
        if (idSet.has(draftRequest.result && draftRequest.result.value && draftRequest.result.value.editingId)) {
          settingsStore.delete("draft");
        }
      };
      draftRequest.onerror = () => tx.abort();
    });
  }

  function saveRecordAndClearDraft(record, options) {
    // 記錄寫入與草稿清除必須同時成功；任一失敗會整筆回滾。
    return transaction([Config.STORE_RECORDS, Config.STORE_SETTINGS], "readwrite", (tx) => {
      const recordStore = tx.objectStore(Config.STORE_RECORDS);
      const settingsStore = tx.objectStore(Config.STORE_SETTINGS);
      const commit = () => {
        recordStore.put(record);
        settingsStore.delete("draft");
      };

      if (!(options && options.mustExist)) {
        commit();
        return;
      }

      // 編輯採條件式更新：若另一分頁已刪除原記錄，就取消整筆交易，
      // 避免舊分頁的儲存動作把已刪除資料重新建立。
      const existingRequest = recordStore.get(record.id);
      existingRequest.onsuccess = () => {
        if (!existingRequest.result) {
          tx.abort();
          return;
        }
        commit();
      };
      existingRequest.onerror = () => tx.abort();
    });
  }

  function deleteRecord(id) {
    return transaction(Config.STORE_RECORDS, "readwrite", (tx) => {
      tx.objectStore(Config.STORE_RECORDS).delete(id);
    });
  }

  function importAtomically(records, settings) {
    // 整份 CSV 共用一個 readwrite transaction，避免只匯入前半段。
    return transaction([Config.STORE_RECORDS, Config.STORE_SETTINGS], "readwrite", (tx) => {
      const recordStore = tx.objectStore(Config.STORE_RECORDS);
      records.forEach((record) => recordStore.put(record));
      if (settings) tx.objectStore(Config.STORE_SETTINGS).put({ key: "main", value: settings });
    });
  }

  App.Storage = Object.freeze({
    open,
    getAllRecords,
    getSettings,
    getDraft,
    getMarketCache,
    getDemoState,
    putSettings,
    saveDraft,
    clearDraft,
    putMarketCache,
    putDemoState,
    saveDemoRecords,
    deleteDemoRecords,
    saveRecordAndClearDraft,
    deleteRecord,
    importAtomically
  });
})(typeof window !== "undefined" ? window : globalThis);
