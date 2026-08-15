/* ==========================================================================
   bridge.js — الجسر بين ملفاتك الأصلية والتطبيق
   --------------------------------------------------------------------------
   ⚠️  الملف ده لا يعدّل أي بيانات أكاديمية. لا ساعات، لا أكواد، لا متطلبات
       سابقة، لا تقديرات، لا شروط سبيشيال. هو بس:
         1) بيعمل نسخة احتياطية تلقائية من حفظك على IndexedDB
         2) بيرجّع بياناتك لو المتصفح مسح localStorage
         3) بيضيف شريط تنقل للرجوع للداشبورد
         4) بيحمي اللينكات الخارجية لما تكون بدون نت
         5) بيبلّغ الداشبورد بملخص تقدمك (للعرض بس)
   ========================================================================== */
(function (global) {
  'use strict';

  const MODULE_ID = (document.documentElement.getAttribute('data-module') || '').trim() || 'unknown';
  const BASE = (function () {
    const s = document.querySelector('script[src*="bridge.js"]');
    if (!s) return '../../';
    return s.getAttribute('src').replace(/assets\/bridge\.js.*$/, '');
  })();

  /* ------------------------------------------------- 1) تحصين الحفظ */

  let saveTimer = null;
  function scheduleMirror() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (global.UniStore) global.UniStore.mirrorToIDB().then(broadcast).catch(() => {});
    }, 900);
  }

  /**
   * نلفّ localStorage.setItem بغلاف شفاف: نفس السلوك بالحرف،
   * بس بنعرف إن فيه حفظ حصل فنعمل مرآة. مفيش أي تغيير في القيمة.
   */
  function hookStorage() {
    let proto;
    try { proto = Object.getPrototypeOf(localStorage) || Storage.prototype; }
    catch (e) { return; }
    const original = proto.setItem;
    const originalRemove = proto.removeItem;
    if (!original || original.__uniHooked) return;

    const wrapped = function (key, value) {
      const r = original.apply(this, arguments);   // القيمة تتحفظ زي ما هي بالحرف
      if (typeof key === 'string' && /^cs[A-Z]/.test(key)) scheduleMirror();
      return r;
    };
    wrapped.__uniHooked = true;
    try { proto.setItem = wrapped; } catch (e) { void e; }

    if (originalRemove && !originalRemove.__uniHooked) {
      const wrappedRemove = function (key) {
        const r = originalRemove.apply(this, arguments);
        if (typeof key === 'string' && /^cs[A-Z]/.test(key)) scheduleMirror();
        return r;
      };
      wrappedRemove.__uniHooked = true;
      try { proto.removeItem = wrappedRemove; } catch (e) { void e; }
    }
  }

  /* ------------------------------------------------- 2) شريط التنقل */

  function buildNavBar(recovered) {
    const bar = document.createElement('div');
    bar.id = 'uniBridgeBar';
    bar.innerHTML = `
      <a class="ubb-home" href="${BASE}index.html" title="الرجوع للرئيسية — Top Computer Science Students">
        <span class="ubb-ic">◀</span><span class="ubb-tx">الرئيسية</span>
      </a>
      <span class="ubb-sep"></span>
      <span class="ubb-status" id="ubbStatus"></span>
      <span class="ubb-grow"></span>
      <button type="button" class="ubb-act" id="ubbBackup" title="نزّل نسخة احتياطية من كل بياناتك">
        <span class="ubb-ic">⤓</span><span class="ubb-tx">نسخة احتياطية</span>
      </button>`;
    document.body.appendChild(bar);
    document.documentElement.classList.add('has-bridge-bar');

    const statusEl = bar.querySelector('#ubbStatus');
    function paintStatus() {
      if (!statusEl) return;
      if (!navigator.onLine) {
        statusEl.innerHTML = '<b class="ubb-off">● بدون نت</b> — كل حاجة شغالة';
      } else {
        statusEl.innerHTML = '<b class="ubb-on">● متصل</b>';
      }
    }
    paintStatus();
    global.addEventListener('online', paintStatus);
    global.addEventListener('offline', paintStatus);

    const bkBtn = bar.querySelector('#ubbBackup');
    if (bkBtn) bkBtn.addEventListener('click', () => {
      if (!global.UniStore) return;
      bkBtn.disabled = true;
      global.UniStore.downloadBackup()
        .then((r) => { toast(`✅ اتنزّلت النسخة — ${r.keys} عناصر`); })
        .catch(() => { toast('⚠️ فشل التنزيل، جرّب تاني'); })
        .then(() => { bkBtn.disabled = false; });
    });

    if (recovered && recovered.length) {
      toast(`🛟 رجّعنا بياناتك من النسخة الاحتياطية (${recovered.length} عناصر) — المتصفح كان مسحها`, 9000);
    }
  }

  function toast(msg, ms) {
    let host = document.getElementById('uniToastHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'uniToastHost';
      document.body.appendChild(host);
    }
    const t = document.createElement('div');
    t.className = 'uni-toast';
    t.textContent = msg;
    host.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => {
      t.classList.remove('in');
      setTimeout(() => t.remove(), 400);
    }, ms || 4200);
  }

  /* ------------------------------- 3) حماية اللينكات الخارجية offline */

  function guardExternalLinks() {
    document.addEventListener('click', (ev) => {
      const a = ev.target.closest && ev.target.closest('a[href^="http"]');
      if (!a) return;
      let sameOrigin = false;
      try { sameOrigin = new URL(a.href).origin === location.origin; } catch (e) { void e; }
      if (sameOrigin) return;
      if (!navigator.onLine) {
        ev.preventDefault();
        toast('📴 اللينك ده محتاج نت — مفيش اتصال دلوقتي', 3800);
      }
    }, true);

    /* نضمن إن اللينكات الخارجية تفتح في تاب جديد بأمان */
    document.querySelectorAll('a[href^="http"]').forEach((a) => {
      try {
        if (new URL(a.href).origin !== location.origin) {
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
        }
      } catch (e) { void e; }
    });
  }

  /* ------------------------------ 4) ملخص للداشبورد (عرض فقط) */

  function summarize() {
    /* بنقرا المتغيرات العامة الموجودة في ملفاتك — قراءة فقط، صفر تعديل */
    const out = { module: MODULE_ID, at: Date.now() };
    try {
      if (typeof courses !== 'undefined' && Array.isArray(courses)) {
        out.totalCourses = courses.length;
        out.totalHours = courses.reduce((s, c) => s + (Number(c.hours) || 0), 0);
      }
    } catch (e) { void e; }
    try {
      if (typeof state !== 'undefined' && state && state.done) {
        const doneIds = Object.keys(state.done).filter((k) => state.done[k]);
        out.doneCount = doneIds.length;
        if (typeof courses !== 'undefined' && Array.isArray(courses)) {
          const byId = {};
          courses.forEach((c) => { byId[c.id] = c; });
          out.doneHours = doneIds.reduce((s, id) => s + ((byId[id] && Number(byId[id].hours)) || 0), 0);
        }
        out.gradedCount = Object.keys(state.grades || {}).length;
      }
    } catch (e) { void e; }
    try {
      const rs = (typeof realState !== 'undefined' && realState) ||
                 (typeof actualState !== 'undefined' && actualState) || null;
      if (rs && Array.isArray(rs.terms)) {
        out.realTerms = rs.terms.length;
        out.realCourses = rs.terms.reduce((s, t) => s + ((t.courses && t.courses.length) || 0), 0);
      }
    } catch (e) { void e; }
    try {
      const el = document.getElementById('cgpaLiveValue');
      if (el) out.cgpaText = (el.textContent || '').trim();
    } catch (e) { void e; }
    return out;
  }

  function broadcast() {
    const sum = summarize();
    try { localStorage.setItem('uniSummary_' + MODULE_ID, JSON.stringify(sum)); }
    catch (e) { void e; }
  }

  /* ------------------------------------ 5) مراعاة الأجهزة الضعيفة */

  function tuneForDevice() {
    const mem = navigator.deviceMemory || 4;
    const cores = navigator.hardwareConcurrency || 4;
    const weak = mem <= 2 || cores <= 2;
    const reduce = global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (weak) document.documentElement.classList.add('weak-device');
    if (weak || reduce) document.documentElement.classList.add('reduce-fx');
  }

  /* ---------------------------------------- 6) تسجيل الـ Service Worker */

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return;   // مفتوح كملف محلي، مش هينفع
    navigator.serviceWorker.register(BASE + 'sw.js', { scope: BASE }).catch(() => {});
  }

  /* ------------------------------------------------------------- التشغيل */

  function boot() {
    tuneForDevice();
    hookStorage();
    guardExternalLinks();
    registerSW();

    if (global.UniInApp) {
      try { global.UniInApp.guard({ url: new URL(BASE + 'index.html', location.href).href }); }
      catch (e) { void e; }
    }

    const afterRestore = (recovered) => {
      buildNavBar(recovered);
      if (global.UniStore) global.UniStore.mirrorToIDB().then(broadcast).catch(broadcast);
      else broadcast();
      /* لو رجّعنا بيانات، الصفحة محتاجة تعيد القراءة */
      if (recovered && recovered.length) {
        setTimeout(() => {
          try {
            if (typeof loadLocal === 'function') loadLocal();
            if (typeof loadRealLocal === 'function') loadRealLocal();
            if (typeof loadActualLocal === 'function') loadActualLocal();
            if (typeof updateProgress === 'function') updateProgress();
            if (typeof renderTermGrid === 'function') renderTermGrid();
            if (typeof renderRealTerms === 'function') renderRealTerms();
            if (typeof renderActualTerms === 'function') renderActualTerms();
          } catch (e) { void e; }
        }, 60);
      }
    };

    if (global.UniStore) {
      global.UniStore.restoreFromIDB().then(afterRestore).catch(() => afterRestore([]));
      global.UniStore.persistRequest().catch(() => {});
    } else {
      afterRestore([]);
    }

    /* حفظ المرآة قبل الخروج — أهم لحظة */
    const flush = () => { if (global.UniStore) global.UniStore.mirrorToIDB().catch(() => {}); broadcast(); };
    global.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
    setInterval(flush, 45000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  global.UniBridge = { summarize, broadcast, toast, MODULE_ID };
})(typeof window !== 'undefined' ? window : this);
