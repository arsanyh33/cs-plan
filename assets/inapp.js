/* ==========================================================================
   inapp.js — كشف المتصفح الداخلي (واتساب / فيسبوك / إنستجرام / ...)
   --------------------------------------------------------------------------
   المشكلة اللي بيحلها:
   لما تبعت لينك التطبيق على واتساب أو فيسبوك، اللينك بيفتح جوه "متصفح داخلي"
   (WebView) مش المتصفح الحقيقي. والنتيجة:
     • مفيش زر "إضافة للشاشة الرئيسية" → التطبيق مش بيتثبت
     • الـ Service Worker مش بيتسجل أو بيتسجل معزول → مفيش offline
     • التخزين معزول وبيتمسح مع قفل الـ WebView → التقدم بيضيع
     • إنستجرام بيمسح الـ #hash من اللينك → الراوتينج بيتلغبط
   الحل هنا: نكتشف الحالة ونعرض شاشة بتشرح وتفتح المتصفح الحقيقي فعليًا.
   ========================================================================== */
(function (global) {
  'use strict';

  const ua = (navigator.userAgent || '') + ' ' + (navigator.vendor || '');

  const SIGNATURES = [
    { id: 'whatsapp',  name: 'واتساب',    re: /WhatsApp/i },
    { id: 'instagram', name: 'إنستجرام',  re: /Instagram/i },
    { id: 'messenger', name: 'ماسنجر',    re: /\bMessenger\b|FB_IAB\/MESSENGER/i },
    { id: 'facebook',  name: 'فيسبوك',    re: /FBAN|FBAV|FB_IAB|FB4A|FBIOS/i },
    { id: 'tiktok',    name: 'تيك توك',   re: /BytedanceWebview|musical_ly|Bytelocale|TikTok/i },
    { id: 'twitter',   name: 'تويتر (X)', re: /Twitter(?:Android)?\b|TwitterIOS/i },
    { id: 'snapchat',  name: 'سناب شات',  re: /Snapchat/i },
    { id: 'linkedin',  name: 'لينكدإن',   re: /LinkedInApp/i },
    { id: 'telegram',  name: 'تليجرام',   re: /\bTelegram(?:Bot)?\b/i },
    { id: 'line',      name: 'لاين',      re: /\bLine\//i },
    { id: 'pinterest', name: 'بينتريست',  re: /Pinterest/i },
    { id: 'wechat',    name: 'وي شات',    re: /MicroMessenger/i },
  ];

  function detect() {
    const isIOS = /iPad|iPhone|iPod/.test(ua) ||
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/i.test(ua);
    const standalone = global.matchMedia && matchMedia('(display-mode: standalone)').matches;
    const iosStandalone = 'standalone' in navigator && navigator.standalone === true;
    const installed = !!(standalone || iosStandalone);

    let app = null;
    for (const s of SIGNATURES) { if (s.re.test(ua)) { app = s; break; } }

    /* كشف سلوكي إضافي لأندرويد: WebView حقيقي بيحمل "; wv" في الـ UA */
    const androidWebView = isAndroid && /;\s*wv\)/i.test(ua);
    if (!app && androidWebView && !installed) {
      app = { id: 'generic-wv', name: 'تطبيق تاني', re: null };
    }

    /* iOS: متصفح داخلي بدون Safari في الـ UA */
    const iosInApp = isIOS && !/Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua) && !installed;
    if (!app && iosInApp) app = { id: 'generic-ios', name: 'تطبيق تاني', re: null };

    const browser =
      /EdgiOS|Edg\//i.test(ua) ? 'edge' :
      /CriOS|Chrome\//i.test(ua) ? 'chrome' :
      /FxiOS|Firefox/i.test(ua) ? 'firefox' :
      /Safari/i.test(ua) ? 'safari' : 'other';

    return {
      inApp: !!app && !installed,
      app: app ? { id: app.id, name: app.name } : null,
      isIOS, isAndroid, installed, browser,
      isDesktop: !isIOS && !isAndroid,
      supportsSW: 'serviceWorker' in navigator,
      supportsPrompt: 'onbeforeinstallprompt' in global,
    };
  }

  /* -------------------------------------------------------- فتح المتصفح */

  /** أندرويد: intent:// بيفتح كروم فعليًا — مش مجرد كلام */
  function chromeIntentURL(url) {
    const u = new URL(url, location.href);
    const noScheme = u.href.replace(/^https?:\/\//, '');
    return 'intent://' + noScheme +
      '#Intent;scheme=' + u.protocol.replace(':', '') +
      ';package=com.android.chrome;S.browser_fallback_url=' +
      encodeURIComponent(u.href) + ';end';
  }

  /** بديل: أي متصفح افتراضي على أندرويد */
  function defaultBrowserIntentURL(url) {
    const u = new URL(url, location.href);
    const noScheme = u.href.replace(/^https?:\/\//, '');
    return 'intent://' + noScheme + '#Intent;scheme=' + u.protocol.replace(':', '') +
      ';action=android.intent.action.VIEW;S.browser_fallback_url=' +
      encodeURIComponent(u.href) + ';end';
  }

  function copyLink(url) {
    const text = url || location.href;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true).catch(() => legacyCopy(text));
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.select(); ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }

  /* ------------------------------------- QR بدون أي مكتبة خارجية (offline) */
  /* مولّد QR مبسّط: بنستخدم encoding رقمي/بايت مع مستوى تصحيح L.
     مكتوب من الصفر عشان يشتغل بدون نت ومن غير CDN.                        */
  function qrMatrix(text) {
    /* تنفيذ QR كامل طويل جدًا — بنستخدم بدل كده رسم اللينك كنص كبير قابل
       للقراءة + زر نسخ. الـ QR الحقيقي بيتولد في صفحة install من ملف
       qr.js الصغير لو اتوفر. */
    void text; return null;
  }

  /* ------------------------------------------------------- شاشة الاعتراض */

  function buildInterstitial(info, opts) {
    opts = opts || {};
    const shareURL = opts.url || location.href;
    const appName = (info.app && info.app.name) || 'تطبيق تاني';

    const host = document.createElement('div');
    host.className = 'inapp-gate';
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-labelledby', 'inappTitle');

    const androidBtns = info.isAndroid ? `
      <a class="ia-btn ia-primary" id="iaOpenChrome" href="${chromeIntentURL(shareURL)}">
        <span class="ia-ic">🌐</span>
        <span><b>افتح في كروم</b><small>الطريقة الصح — اضغط هنا</small></span>
      </a>
      <a class="ia-btn" id="iaOpenDefault" href="${defaultBrowserIntentURL(shareURL)}">
        <span class="ia-ic">📲</span>
        <span><b>افتح في المتصفح الافتراضي</b><small>لو كروم مش موجود</small></span>
      </a>` : '';

    const iosSteps = info.isIOS ? `
      <div class="ia-steps">
        <div class="ia-steps-title">على الآيفون، سفاري مش بيفتح تلقائي — اعمل كده:</div>
        <ol>
          <li>اضغط على <b class="ia-kbd">⋯</b> أو <b class="ia-kbd">↗</b> في رُكن الشاشة</li>
          <li>اختار <b>«فتح في سفاري»</b> (Open in Safari)</li>
          <li>ومن سفاري: <b>شير ⬆️</b> ← <b>«إضافة إلى الشاشة الرئيسية»</b></li>
        </ol>
      </div>` : '';

    const androidSteps = info.isAndroid ? `
      <div class="ia-steps">
        <div class="ia-steps-title">أو يدويًا من ${appName}:</div>
        <ol>
          <li>اضغط <b class="ia-kbd">⋮</b> فوق على اليمين</li>
          <li>اختار <b>«فتح في المتصفح»</b> (Open in browser)</li>
        </ol>
      </div>` : '';

    host.innerHTML = `
      <div class="ia-box">
        <div class="ia-badge">⚠️</div>
        <h1 id="inappTitle">إنت فاتح اللينك من جوه ${appName}</h1>
        <p class="ia-lede">
          المتصفح الداخلي بتاع ${appName} <b>مش بيقدر يثبّت التطبيق</b> ولا
          يخليه يشتغل بدون نت، وأي تقدم تسجله هنا <b>بيضيع</b> لما تقفل الشاشة.
        </p>
        <p class="ia-lede" style="color:var(--rose,#e0455a)">
          ⚠️ <b>متضغطش دلوقتي على أي زرار "إضافة إلى الشاشة الرئيسية" أو تثبيت
          جوه ${appName} نفسه</b> — الأيقونة اللي هتتحمل هتبقى <b>باظة ومش هتفتح</b>
          تاني. لازم تفتح اللينك في كروم أو سفاري الأول زي تحت، وبعدين ثبّته من هناك.
        </p>

        <div class="ia-actions">
          ${androidBtns}
          <button class="ia-btn ${info.isAndroid ? '' : 'ia-primary'}" id="iaCopy">
            <span class="ia-ic">📋</span>
            <span><b>انسخ اللينك</b><small>والصقه في كروم أو سفاري</small></span>
          </button>
        </div>

        <div class="ia-url" id="iaUrl" title="اضغط للنسخ">${shareURL}</div>
        ${iosSteps}${androidSteps}

        <div class="ia-why">
          <b>ليه بنطلب كده؟</b> عشان التطبيق يتحوّل لأيقونة على شاشتك،
          ويفتح بعد كده <b>من غير نت خالص</b>، وتقدمك يتحفظ بشكل دائم.
        </div>

        <button class="ia-skip" id="iaSkip">أكمّل هنا برضو (تقدمي مش هيتحفظ، ومينفعش أثبّت من هنا) ↓</button>
      </div>`;

    return host;
  }

  function warnBar(appName) {
    const bar = document.createElement('div');
    bar.className = 'inapp-warnbar';
    bar.innerHTML = `
      <span>⚠️ إنت في متصفح ${appName} — تقدمك <b>مش محفوظ</b>، والتطبيق مش هيشتغل بدون نت،
      و<b>متثبتوش من هنا</b> هيبقى باظ.</span>
      <button type="button" id="iaReopen">افتح في المتصفح</button>`;
    return bar;
  }

  /** الدالة الرئيسية: تنادى من أي صفحة */
  function guard(opts) {
    opts = opts || {};
    const info = detect();
    if (!info.inApp) return info;

    const dismissKey = 'uniInAppDismissed_v1';
    let dismissed = false;
    try { dismissed = sessionStorage.getItem(dismissKey) === '1'; } catch (e) { void e; }

    const appName = (info.app && info.app.name) || 'التطبيق';

    /* ------------------------------------------------------------------
       محاولة تلقائية (مرة واحدة بس في الجلسة): على أندرويد، نحاول نفتح
       كروم فورًا من غير ما ننتظر المستخدم يدوس أي زرار. لو كروم موجود
       هيتفتح فعليًا ويسيب واتساب في الخلفية. لو مش موجود، الـ intent
       بيرجع لنفس الصفحة (fallback) وهنا الشاشة اليدوية بتظهر عادي.
       ما بنعملهاش لو المستخدم فعلًا دوس "أكمّل هنا برضو" قبل كده،
       عشان ما نضايقوش كل تنقل بين الصفحات. ما بنعملهاش على iOS لأن
       آبل بتمنع أي تحويل تلقائي للمتصفح من جافاسكريبت. */
    if (info.isAndroid && !dismissed) {
      const autoKey = 'uniInAppAutoTried_v1';
      let autoTried = false;
      try { autoTried = sessionStorage.getItem(autoKey) === '1'; } catch (e) { void e; }
      if (!autoTried) {
        try { sessionStorage.setItem(autoKey, '1'); } catch (e) { void e; }
        try { location.href = chromeIntentURL(opts.url || location.href); } catch (e) { void e; }
      }
    }

    if (dismissed) {
      const bar = warnBar(appName);
      document.body.appendChild(bar);
      document.documentElement.classList.add('has-warnbar');
      const rb = bar.querySelector('#iaReopen');
      if (rb) rb.addEventListener('click', () => {
        try { sessionStorage.removeItem(dismissKey); } catch (e) { void e; }
        location.reload();
      });
      return info;
    }

    const gate = buildInterstitial(info, opts);
    document.documentElement.style.overflow = 'hidden';
    document.body.appendChild(gate);

    const copyBtn = gate.querySelector('#iaCopy');
    const urlEl = gate.querySelector('#iaUrl');
    const doCopy = (el) => copyLink(opts.url || location.href).then((ok) => {
      const target = el || copyBtn;
      if (!target) return;
      const prev = target.innerHTML;
      target.innerHTML = ok
        ? '<span class="ia-ic">✅</span><span><b>اتنسخ!</b><small>الصقه في كروم</small></span>'
        : '<span class="ia-ic">⚠️</span><span><b>انسخه يدويًا</b><small>من الخانة تحت</small></span>';
      setTimeout(() => { target.innerHTML = prev; }, 2200);
    });
    if (copyBtn) copyBtn.addEventListener('click', () => doCopy(copyBtn));
    if (urlEl) urlEl.addEventListener('click', () => {
      copyLink(opts.url || location.href).then(() => {
        urlEl.classList.add('copied');
        setTimeout(() => urlEl.classList.remove('copied'), 1600);
      });
    });

    const skip = gate.querySelector('#iaSkip');
    if (skip) skip.addEventListener('click', () => {
      try { sessionStorage.setItem(dismissKey, '1'); } catch (e) { void e; }
      document.documentElement.style.overflow = '';
      gate.remove();
      const bar = warnBar(appName);
      document.body.appendChild(bar);
      document.documentElement.classList.add('has-warnbar');
      const rb = bar.querySelector('#iaReopen');
      if (rb) rb.addEventListener('click', () => {
        try { sessionStorage.removeItem(dismissKey); } catch (e) { void e; }
        location.reload();
      });
    });

    return info;
  }

  global.UniInApp = { detect, guard, copyLink, chromeIntentURL, defaultBrowserIntentURL, qrMatrix };
})(typeof window !== 'undefined' ? window : this);
