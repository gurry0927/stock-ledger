"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

function installIsolatedIndexedDb() {
  const stores = new Map();

  const database = {
    objectStoreNames: { contains: (name) => stores.has(name) },
    createObjectStore(name, options) {
      const store = { keyPath: options.keyPath, data: new Map() };
      stores.set(name, store);
      return { createIndex() {} };
    },
    close() {},
    transaction(storeNames, mode) {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      const staged = new Map(names.map((name) => [name, new Map(stores.get(name).data)]));
      const tx = {
        error: null,
        aborted: false,
        objectStore(name) {
          const store = stores.get(name);
          const data = mode === "readwrite" ? staged.get(name) : store.data;
          return {
            put(value) {
              if (value && value.id === "SMOKE-FAIL") throw new Error("模擬寫入失敗");
              data.set(value[store.keyPath], structuredClone(value));
            },
            delete(key) { data.delete(key); },
            get(key) {
              const request = {};
              queueMicrotask(() => {
                request.result = data.has(key) ? structuredClone(data.get(key)) : undefined;
                if (request.onsuccess) request.onsuccess();
              });
              return request;
            },
            getAll() {
              const request = {};
              queueMicrotask(() => {
                request.result = [...data.values()].map((value) => structuredClone(value));
                if (request.onsuccess) request.onsuccess();
              });
              return request;
            }
          };
        },
        abort() {
          this.aborted = true;
          queueMicrotask(() => { if (this.onabort) this.onabort(); });
        }
      };
      // IndexedDB 會等同一交易內的 request callback 結束後才提交；
      // 用 setImmediate 模擬，讓 callback 內新增的 put/delete 也包含在交易中。
      setImmediate(() => {
        if (tx.aborted) return;
        if (mode === "readwrite") {
          names.forEach((name) => { stores.get(name).data = staged.get(name); });
        }
        if (tx.oncomplete) tx.oncomplete();
      });
      return tx;
    }
  };

  globalThis.indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = database;
        if (request.onupgradeneeded) request.onupgradeneeded();
        if (request.onsuccess) request.onsuccess();
      });
      return request;
    }
  };
}

installIsolatedIndexedDb();
require("../scripts/config.js");
require("../scripts/storage.js");

const { Storage } = globalThis.StockLedger;

test("記錄儲存成功後才清草稿，重開仍可讀取", async () => {
  await Storage.open();
  await Storage.saveDraft({ form: { stockCode: "SMOKE" } });
  await Storage.saveRecordAndClearDraft({ id: "SMOKE-SAVED", date: "2026-08-09" });
  assert.equal(await Storage.getDraft(), null);
  assert.deepEqual(await Storage.getAllRecords(), [{ id: "SMOKE-SAVED", date: "2026-08-09" }]);
});

test("批次匯入中途失敗時，記錄與設定全部回滾", async () => {
  const originalSettings = { feeDiscount: 6, regularMinFee: 20, oddLotMinFee: 1, feeRounding: "round" };
  await Storage.putSettings(originalSettings);
  const before = await Storage.getAllRecords();

  await assert.rejects(
    Storage.importAtomically(
      [{ id: "SMOKE-WOULD-ROLLBACK" }, { id: "SMOKE-FAIL" }],
      { feeDiscount: 0, regularMinFee: 0, oddLotMinFee: 0, feeRounding: "floor" }
    ),
    /模擬寫入失敗/
  );

  assert.deepEqual(await Storage.getAllRecords(), before);
  assert.deepEqual(await Storage.getSettings(), originalSettings);
});

test("合法批次可一次提交，並能更新相同 ID", async () => {
  await Storage.importAtomically([
    { id: "SMOKE-SAVED", date: "2026-08-10" },
    { id: "SMOKE-IMPORTED", date: "2026-08-09" }
  ], null);
  const records = await Storage.getAllRecords();
  assert.equal(records.length, 2);
  assert.equal(records.find((record) => record.id === "SMOKE-SAVED").date, "2026-08-10");
});

test("刪除示範資料與防止重生狀態會在同一交易提交", async () => {
  const demoRecords = [{ id: "DEMO-A" }, { id: "DEMO-B" }];
  await Storage.saveDemoRecords(demoRecords, { status: "loaded" });
  assert.equal((await Storage.getAllRecords()).filter((record) => record.id.startsWith("DEMO-")).length, 2);
  assert.deepEqual(await Storage.getDemoState(), { status: "loaded" });

  await Storage.saveDraft({ editingId: "DEMO-A", form: { stockCode: "DEMO" } });
  await Storage.deleteDemoRecords(demoRecords.map((record) => record.id), { status: "removed" });
  assert.equal((await Storage.getAllRecords()).filter((record) => record.id.startsWith("DEMO-")).length, 0);
  assert.deepEqual(await Storage.getDemoState(), { status: "removed" });
  assert.equal(await Storage.getDraft(), null);

  await Storage.saveRecordAndClearDraft({ id: "REAL-AFTER-DEMO-DELETE" });
  assert.equal((await Storage.getAllRecords()).filter((record) => record.id.startsWith("DEMO-")).length, 0);
  assert.deepEqual(await Storage.getDemoState(), { status: "removed" });
});

test("舊分頁不能把已刪除的記錄用編輯儲存重新建立", async () => {
  await Storage.saveRecordAndClearDraft({ id: "STALE-EDIT", date: "2026-08-01" });
  await Storage.deleteRecord("STALE-EDIT");
  await Storage.saveDraft({ editingId: "STALE-EDIT", form: { stockCode: "STALE" } });

  await assert.rejects(
    Storage.saveRecordAndClearDraft(
      { id: "STALE-EDIT", date: "2026-08-09" },
      { mustExist: true }
    ),
    /取消/
  );

  assert.equal((await Storage.getAllRecords()).some((record) => record.id === "STALE-EDIT"), false);
  assert.equal((await Storage.getDraft()).editingId, "STALE-EDIT");
});

test("重設示範資料會在同一交易移除舊版本遺留 ID", async () => {
  await Storage.saveDemoRecords([{ id: "DEMO-OLD" }], { status: "loaded" });
  await Storage.saveDemoRecords([{ id: "DEMO-NEW" }], { status: "loaded" }, ["DEMO-OLD"]);
  const records = await Storage.getAllRecords();
  assert.equal(records.some((record) => record.id === "DEMO-OLD"), false);
  assert.equal(records.some((record) => record.id === "DEMO-NEW"), true);
});

test("示範資料載入失敗時記錄與狀態都不會只寫一半", async () => {
  const beforeRecords = await Storage.getAllRecords();
  const beforeState = await Storage.getDemoState();
  await assert.rejects(
    Storage.saveDemoRecords([{ id: "DEMO-WOULD-ROLLBACK" }, { id: "SMOKE-FAIL" }], { status: "loaded" }),
    /模擬寫入失敗/
  );
  assert.deepEqual(await Storage.getAllRecords(), beforeRecords);
  assert.deepEqual(await Storage.getDemoState(), beforeState);
});
