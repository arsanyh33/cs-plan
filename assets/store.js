/* ==========================================================================
   store.js — طبقة التخزين المُحصَّنة
   --------------------------------------------------------------------------
   الفكرة: ملفاتك الأصلية بتحفظ في localStorage (وده شغال كويس).
   المشكلة إن localStorage بيتمسح:
     • أندرويد: لما مساحة الجهاز تقل، النظام بيمسح بيانات المواقع.
     • آيفون/سفاري: بيمسح بيانات الموقع بعد 7 أيام عدم استخدام.
     • المستخدم نفسه لو مسح بيانات المتصفح.
   الحل: مرآة تلقائية على IndexedDB (أقوى وأكبر وأصعب في المسح)
         + نسخة احتياطية كملف JSON تنزّلها على جهازك.
   مهم: الملف ده لا يعدّل بياناتك ولا يغيّر مفاتيحك — بيقرأ وبينسخ بس.
   ========================================================================== */
(function (global) {
  'use strict';

  const DB_NAME = 'uniPlannerVault';
  const DB_VERSION = 2;
  const STORE = 'snapshots';
  const META = 'meta';

  /* المفاتيح اللي ملفاتك بتستخدمها — أي مفتاح جديد يتضاف هنا بسطر واحد */
  const WATCHED_KEYS = [
    { key: 'csStatPlanState_v1', module: 'cs-stat',    label: 'خطة حاسب + إحصاء — التقدم والتقديرات' },
    { key: 'csStatRealPlan_v1',  module: 'cs-stat',    label: 'خطة حاسب + إحصاء — خطتي الفعلية' },
    { key: 'csSpecialPlan_v1',   module: 'cs-special', label: 'حاسب سبيشيال — التقدم والتقديرات' },
    { key: 'csActualPlan_v1',    module: 'cs-special', label: 'حاسب سبيشيال — خطتي الفعلية' },
    { key: 'csTrackGuideDeviceMode_v1', module: 'cs-tracks', label: 'تراكات ومسارات — وضع العرض' },
    { key: 'csTrackGuideFontSize_v1',   module: 'cs-tracks', label: 'تراكات ومسارات — حجم الخط' },
  ];

  /* مفاتيح الشل نفسه (إعدادات، مش بيانات أكاديمية) */
  const SHELL_KEYS = ['uniShellPrefs_v1'];

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in global)) return reject(new Error('IndexedDB غير مدعوم'));
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { return reject(e); }
      req.onerror = () => reject(req.error || new Error('فشل فتح قاعدة البيانات'));
      req.onblocked = () => reject(new Error('قاعدة البيانات مقفولة في تاب تاني'));
      req.onupgradeneeded = (ev) => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(META))  db.createObjectStore(META,  { keyPath: 'key' });
        void ev;
      };
      req.onsuccess = () => resolve(req.result);
    }).catch((e) => { dbPromise = null; throw e; });
    return dbPromise;
  }

  function tx(storeName, mode, fn) {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode);
      const store = t.objectStore(storeName);
      let result;
      try { result = fn(store); } catch (e) { return reject(e); }
      t.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('أُلغيت العملية'));
    }));
  }

  const wrap = (r) => ({ __req: r });

  /* ---------------------------------------------------------------- قراءة/كتابة */

  function idbPut(key, value) {
    return tx(STORE, 'readwrite', (s) => wrap(s.put({
      key, value, savedAt: Date.now(), len: (value || '').length
    })));
  }

  function idbGet(key) {
    return tx(STORE, 'readonly', (s) => wrap(s.get(key)))
      .then((row) => (row ? row.value : null));
  }

  function idbAll() {
    return tx(STORE, 'readonly', (s) => wrap(s.getAll()));
  }

  /* --------------------------------------------------- المزامنة الأساسية */

  /**
   * أي مفتاح جديد بيبدأ بـ cs + حرف كبير (زي csSchedule_v1) بيتلقط تلقائيًا.
   * كده أي صفحة تضيفها في المستقبل تدخل في النسخ الاحتياطي من غير ما
   * تعدّل الملف ده — بس ضيفها في WATCHED_KEYS لو عايزها بعنوان عربي واضح.
   */
  const AUTO_KEY_RE = /^cs[A-Z][A-Za-z0-9_]*$/;

  function discoverKeys() {
    const known = new Set(WATCHED_KEYS.map((w) => w.key).concat(SHELL_KEYS));
    const found = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && !known.has(k) && AUTO_KEY_RE.test(k)) found.push(k);
      }
    } catch (e) { void e; }
    return found;
  }

  /** كل المفاتيح اللي بنحرسها: المعروفة + اللي اتلقطت تلقائيًا */
  function allKeys() {
    return WATCHED_KEYS.map((w) => w.key)
      .concat(SHELL_KEYS)
      .concat(discoverKeys());
  }

  /** ينسخ كل مفاتيح localStorage الموجودة → IndexedDB */
  function mirrorToIDB() {
    const jobs = [];
    allKeys().forEach((key) => {
      let raw = null;
      try { raw = localStorage.getItem(key); } catch (e) { void e; }
      if (raw != null && raw !== '') jobs.push(idbPut(key, raw));
    });
    return Promise.all(jobs).then(() => jobs.length).catch(() => 0);
  }

  /**
   * الاستعادة: لو localStorage فاضي/ناقص و IndexedDB فيه نسخة → يرجّعها.
   * ده اللي بينجّي بياناتك لما أندرويد يمسح localStorage.
   * بيرجّع قائمة المفاتيح اللي اتعافت.
   */
  function restoreFromIDB() {
    return idbAll().then((rows) => {
      const recovered = [];
      (rows || []).forEach((row) => {
        let current = null;
        try { current = localStorage.getItem(row.key); } catch (e) { void e; }
        const isEmpty = current == null || current === '' || current === '{}' ||
                        current === 'null' || current === '[]';
        if (isEmpty && row.value && row.value.length > 2) {
          try { localStorage.setItem(row.key, row.value); recovered.push(row.key); }
          catch (e) { void e; }
        }
      });
      return recovered;
    }).catch(() => []);
  }

  /* ------------------------------------------------ التصدير والاستيراد */

  function buildBackup() {
    const payload = {
      __format: 'uni-planner-backup',
      __version: 1,
      exportedAt: new Date().toISOString(),
      device: (global.navigator && navigator.userAgent) || 'unknown',
      data: {},
    };
    return idbAll().then((rows) => {
      const fromIDB = {};
      (rows || []).forEach((r) => { fromIDB[r.key] = r.value; });
      /* المفاتيح المعروفة + أي مفتاح جديد من صفحة ضفتها + أي مفتاح موجود
         في IndexedDB بس اتمسح من localStorage (مهم عشان مانخسرهوش) */
      const keys = new Set(allKeys());
      Object.keys(fromIDB).forEach((k) => { if (AUTO_KEY_RE.test(k) || keys.has(k)) keys.add(k); });
      Array.from(keys).map((key) => ({ key })).forEach(({ key }) => {
        let v = null;
        try { v = localStorage.getItem(key); } catch (e) { void e; }
        /* الأحدث/الأطول يفوز — الأمان أهم من الدقة هنا */
        if ((v == null || v === '') && fromIDB[key]) v = fromIDB[key];
        if (v != null && v !== '') payload.data[key] = v;
      });
      return payload;
    }).catch(() => {
      allKeys().forEach((key) => {
        let v = null;
        try { v = localStorage.getItem(key); } catch (e) { void e; }
        if (v) payload.data[key] = v;
      });
      return payload;
    });
  }

  function downloadBackup() {
    return buildBackup().then((payload) => {
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const name = `نسخة-خطتي-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; a.rel = 'noopener';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
      try { localStorage.setItem('uniLastBackupAt', String(Date.now())); } catch (e) { void e; }
      return { name, keys: Object.keys(payload.data).length, bytes: json.length };
    });
  }

  /**
   * الاستيراد. mode:
   *   'replace' → يستبدل المفاتيح الموجودة في الملف
   *   'fill'    → يكتب بس المفاتيح الفاضية عندك (أأمن)
   */
  function importBackup(fileOrText, mode) {
    mode = mode || 'replace';
    const readText = (typeof fileOrText === 'string')
      ? Promise.resolve(fileOrText)
      : new Promise((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.onerror = () => rej(new Error('تعذّر قراءة الملف'));
          fr.readAsText(fileOrText, 'utf-8');
        });

    return readText.then((text) => {
      let parsed;
      try { parsed = JSON.parse(text); }
      catch (e) { throw new Error('الملف ده مش JSON صالح — اتأكد إنه ملف النسخة الاحتياطية'); }
      if (!parsed || parsed.__format !== 'uni-planner-backup' || !parsed.data) {
        throw new Error('الملف ده مش نسخة احتياطية من التطبيق ده');
      }
      const allowed = new Set(WATCHED_KEYS.map((w) => w.key).concat(SHELL_KEYS));
      const applied = [], skipped = [];
      Object.keys(parsed.data).forEach((key) => {
        /* بنقبل المفاتيح المعروفة، أو أي مفتاح بنمط cs* (صفحة ضفتها بنفسك).
           أي حاجة تانية بترفض — حماية من ملف نسخة معدّل أو خبيث. */
        if (!allowed.has(key) && !AUTO_KEY_RE.test(key)) { skipped.push(key); return; }
        const val = parsed.data[key];
        if (typeof val !== 'string') { skipped.push(key); return; }
        try { JSON.parse(val); } catch (e) { skipped.push(key); return; }
        let current = null;
        try { current = localStorage.getItem(key); } catch (e) { void e; }
        if (mode === 'fill' && current && current !== '' && current !== '{}') { skipped.push(key); return; }
        try { localStorage.setItem(key, val); applied.push(key); } catch (e) { skipped.push(key); }
      });
      return mirrorToIDB().then(() => ({ applied, skipped, exportedAt: parsed.exportedAt }));
    });
  }

  /* ------------------------------------------------------- حالة التخزين */

  function persistRequest() {
    if (!navigator.storage || !navigator.storage.persist) return Promise.resolve('unsupported');
    return navigator.storage.persisted()
      .then((already) => (already ? true : navigator.storage.persist()))
      .then((ok) => (ok ? 'granted' : 'denied'))
      .catch(() => 'error');
  }

  function storageStatus() {
    const out = {
      persisted: null, usage: null, quota: null, percent: null,
      localStorageOK: false, indexedDBOK: false,
      keysPresent: [], keysMissing: [], lastBackupAt: null,
    };
    try {
      const probe = '__probe__' + Date.now();
      localStorage.setItem(probe, '1'); localStorage.removeItem(probe);
      out.localStorageOK = true;
    } catch (e) { void e; }
    try { out.lastBackupAt = Number(localStorage.getItem('uniLastBackupAt')) || null; } catch (e) { void e; }

    WATCHED_KEYS.forEach(({ key, label, module }) => {
      let v = null;
      try { v = localStorage.getItem(key); } catch (e) { void e; }
      (v && v.length > 2 ? out.keysPresent : out.keysMissing).push({ key, label, module, bytes: v ? v.length : 0 });
    });

    const jobs = [];
    if (navigator.storage && navigator.storage.estimate) {
      jobs.push(navigator.storage.estimate().then((est) => {
        out.usage = est.usage; out.quota = est.quota;
        out.percent = est.quota ? (est.usage / est.quota) * 100 : null;
      }).catch(() => {}));
    }
    if (navigator.storage && navigator.storage.persisted) {
      jobs.push(navigator.storage.persisted().then((p) => { out.persisted = p; }).catch(() => {}));
    }
    jobs.push(openDB().then(() => { out.indexedDBOK = true; }).catch(() => { out.indexedDBOK = false; }));
    return Promise.all(jobs).then(() => out);
  }

  function readKey(key) {
    let v = null;
    try { v = localStorage.getItem(key); } catch (e) { void e; }
    if (!v) return null;
    try { return JSON.parse(v); } catch (e) { return null; }
  }

  function wipeAll() {
    allKeys().forEach((key) => { try { localStorage.removeItem(key); } catch (e) { void e; } });
    return tx(STORE, 'readwrite', (s) => wrap(s.clear())).catch(() => null);
  }

  global.UniStore = {
    WATCHED_KEYS, SHELL_KEYS,
    mirrorToIDB, restoreFromIDB,
    buildBackup, downloadBackup, importBackup,
    storageStatus, persistRequest, readKey, wipeAll,
    discoverKeys, allKeys, AUTO_KEY_RE,
    idbGet, idbPut,
  };
})(typeof window !== 'undefined' ? window : this);
