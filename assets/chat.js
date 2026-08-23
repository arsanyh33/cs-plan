/* ============================================================
   TCSS Chatbot — منطق مشترك بين اللوحة الجانبية (index.html)
   والصفحة المستقلة (chat.html). الاتنين بيستخدموا نفس الـ IDs
   جوه الـ HTML بتاعهم فبيشتغلوا بنفس الملف ده من غير أي تعديل.

   بيرد على أسئلة الطلبة عن الخطط الدراسية بناءً على بيانات الموقع
   الفعلية (assets/kb.json)، عن طريق Cloudflare Worker وسيط بيحمي
   مفتاح الـ API. الرد بييجي Streaming (كلمة كلمة) من الـ Worker،
   ومعروض بتنسيق Markdown-lite (Bold، نقط، عناوين بسيطة).

   ⭐ إضافات (v2.13.0): تكبير/تصغير خط الشات، مشاركة المحادثة،
   أرشيف محادثات قديمة (بدل الجلسة المؤقتة)، نسخ رد البوت، وتقييم
   سريع 👍/👎 (بيتسجل كـ GA4 event بس من غير تخزين محلي).
   ============================================================ */
(function () {
  "use strict";

  var WORKER_URL = "https://tcss-chatbot.arsanyh33.workers.dev/";

  var MAX_SEND_HISTORY = 20; // أقصى عدد رسائل نبعتها للـ Worker مع كل طلب

  var CONV_KEY = "csChatConversations_v1"; // أرشيف المحادثات (localStorage)
  var MAX_CONVERSATIONS = 30;

  var FONT_KEY = "csChatFontSize_v1";
  var FONT_MIN = 13, FONT_MAX = 22, FONT_DEFAULT = 16;

  var history = []; // {role:'user'|'assistant', text:''} — المحادثة الحالية بس
  var activeId = null; // id المحادثة الحالية جوه الأرشيف (null لحد ما تتحفظ أول مرة)
  var isSending = false;

  var messagesEl = document.getElementById("chatMessages");
  var suggestionsEl = document.getElementById("chatSuggestions");
  var formEl = document.getElementById("chatForm");
  var inputEl = document.getElementById("chatInput");
  var sendBtn = document.getElementById("chatSendBtn");
  var clearBtn = document.getElementById("chatClearBtn");

  var fontDecBtn = document.getElementById("chatFontDecBtn");
  var fontIncBtn = document.getElementById("chatFontIncBtn");
  var shareBtn = document.getElementById("chatShareBtn");
  var archiveBtn = document.getElementById("chatArchiveBtn");
  var archiveCloseBtn = document.getElementById("chatArchiveCloseBtn");
  var archiveEl = document.getElementById("chatArchive");
  var archiveListEl = document.getElementById("chatArchiveList");

  // الحاوية الرئيسية (chat-shell في الصفحة الكاملة، chat-drawer في اللوحة الجانبية)
  var containerEl = document.querySelector(".chat-shell, .chat-drawer");

  if (!messagesEl || !formEl || !inputEl || !sendBtn) return; // أمان لو الصفحة اتغيرت مستقبلاً

  /* ---------- Markdown-lite renderer (آمن — بيعمل escape الأول) ---------- */
  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function inlineMd(s) {
    return s
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__(.+?)__/g, "<strong>$1</strong>")
      .replace(/`([^`]+?)`/g, "<code>$1</code>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>");
  }
  function mdLiteToHtml(raw) {
    var text = escapeHtml(raw || "");
    var blocks = text.split(/\n{2,}/);
    var html = blocks.map(function (block) {
      var lines = block.split("\n").filter(function (l) { return l.length; });
      if (!lines.length) return "";

      var bulletRe = /^\s*[-*•]\s+/;
      var numberRe = /^\s*\d+[.)]\s+/;
      var headingMatch = lines.length === 1 && lines[0].match(/^(#{1,4})\s+(.*)$/);

      if (lines.every(function (l) { return bulletRe.test(l); })) {
        return "<ul>" + lines.map(function (l) {
          return "<li>" + inlineMd(l.replace(bulletRe, "")) + "</li>";
        }).join("") + "</ul>";
      }
      if (lines.every(function (l) { return numberRe.test(l); })) {
        return "<ol>" + lines.map(function (l) {
          return "<li>" + inlineMd(l.replace(numberRe, "")) + "</li>";
        }).join("") + "</ol>";
      }
      if (headingMatch) {
        var level = Math.min(headingMatch[1].length + 2, 5);
        return "<h" + level + ">" + inlineMd(headingMatch[2]) + "</h" + level + ">";
      }
      return "<p>" + lines.map(inlineMd).join("<br>") + "</p>";
    }).join("");
    return html;
  }

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "class") e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }

  function scrollToEnd() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  /* ---------- نسخ للكليبورد (مستقل، من غير أي اعتماد على ملفات تانية) ---------- */
  function legacyCopyText(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; })
        .catch(function () { return legacyCopyText(text); });
    }
    return Promise.resolve(legacyCopyText(text));
  }

  /* ---------- تنبيه صغير مؤقت (Toast) داخل الشات نفسه ---------- */
  var toastTimer = null;
  function showChatToast(msg) {
    if (!containerEl) return;
    var t = containerEl.querySelector(".chat-toast");
    if (!t) {
      t = el("div", { class: "chat-toast" });
      containerEl.appendChild(t);
    }
    t.textContent = msg;
    // إعادة تشغيل الأنيميشن
    t.classList.remove("show");
    void t.offsetWidth;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1800);
  }

  function flashButton(btn, ok) {
    if (!btn) return;
    btn.classList.remove("flash-ok", "flash-fail");
    void btn.offsetWidth;
    btn.classList.add(ok === false ? "flash-fail" : "flash-ok");
    setTimeout(function () { btn.classList.remove("flash-ok", "flash-fail"); }, 1200);
  }

  /* ------------------------------ الرسائل ------------------------------ */
  function addUserMessage(text) {
    messagesEl.appendChild(el("div", { class: "chat-msg user" }, [document.createTextNode(text)]));
    scrollToEnd();
  }
  function createBotBubble(isError) {
    var cls = "chat-msg bot" + (isError ? " error" : "");
    var bubble = el("div", { class: cls });
    messagesEl.appendChild(bubble);
    scrollToEnd();
    return bubble;
  }
  function setBotBubbleText(bubble, text, streaming) {
    bubble.innerHTML = mdLiteToHtml(text) + (streaming ? '<span class="chat-cursor">▌</span>' : "");
    scrollToEnd();
  }
  function addBotMessage(text, isError) {
    var bubble = createBotBubble(isError);
    setBotBubbleText(bubble, text, false);
    return bubble;
  }
  function addFinalBotMessage(text) {
    var bubble = addBotMessage(text, false);
    attachBotActions(bubble);
    return bubble;
  }
  function addTyping() {
    var t = el("div", { class: "chat-msg bot typing", id: "chatTyping" }, [
      el("span"), el("span"), el("span")
    ]);
    messagesEl.appendChild(t);
    scrollToEnd();
  }
  function removeTyping() {
    var t = document.getElementById("chatTyping");
    if (t) t.remove();
  }

  function hideSuggestions() {
    suggestionsEl.classList.add("hidden");
  }

  /* ---------- زرار نسخ + تقييم تحت كل رد فعلي من البوت ---------- */
  function attachBotActions(bubble) {
    var plainText = bubble.innerText || bubble.textContent || "";

    var copyBtn = el("button", {
      type: "button", class: "chat-msg-action", title: "نسخ الرد", "aria-label": "نسخ الرد"
    }, [svgIcon('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>')]);
    copyBtn.addEventListener("click", function () {
      copyText(plainText).then(function (ok) {
        flashButton(copyBtn, ok);
        showChatToast(ok ? "اتنسخ الرد ✓" : "معلش، انسخه يدويًا");
      });
    });

    var upBtn = el("button", {
      type: "button", class: "chat-msg-action", title: "رد مفيد", "aria-label": "رد مفيد"
    }, [svgIcon('<path d="M7 10v11"/><path d="M20.4 10.2 19 21H9a2 2 0 0 1-2-2v-9l5-8 1.5 1a2 2 0 0 1 .8 2.2l-1 3.6h5.6a2 2 0 0 1 1.9 2.4z"/>')]);
    var downBtn = el("button", {
      type: "button", class: "chat-msg-action", title: "رد مش مفيد", "aria-label": "رد مش مفيد"
    }, [svgIcon('<path d="M17 14V3"/><path d="M3.6 13.8 5 3h10a2 2 0 0 1 2 2v9l-5 8-1.5-1a2 2 0 0 1-.8-2.2l1-3.6H5.1a2 2 0 0 1-1.9-2.4z"/>')]);

    function rate(value, chosenBtn) {
      if (upBtn.disabled) return; // اتقيّمت قبل كده
      upBtn.disabled = true;
      downBtn.disabled = true;
      chosenBtn.classList.add("active");
      try {
        if (typeof gtag === "function") gtag("event", "chat_rating", { rating: value });
      } catch (e) { /* تتبع اختياري، لو فشل ملوش أثر على الشات */ }
      showChatToast("شكرًا لتقييمك! 🙏");
    }
    upBtn.addEventListener("click", function () { rate("up", upBtn); });
    downBtn.addEventListener("click", function () { rate("down", downBtn); });

    var actions = el("div", { class: "chat-msg-actions" }, [copyBtn, upBtn, downBtn]);
    bubble.appendChild(actions);
  }

  function svgIcon(pathsInner) {
    var wrapper = document.createElement("span");
    wrapper.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + pathsInner + '</svg>';
    return wrapper.firstChild;
  }

  function greet() {
    addBotMessage("أهلاً! 👋 أنا مساعد TCSS، اسألني عن أي حاجة في خطتك الدراسية — الساعات، المتطلبات السابقة، شروط السبيشيال، التحويل، أو المعدل والإنذار.");
  }

  /* ------------------------- أرشيف المحادثات ------------------------- */
  function loadConversations() {
    try {
      var arr = JSON.parse(localStorage.getItem(CONV_KEY) || "[]");
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function saveConversations(list) {
    try { localStorage.setItem(CONV_KEY, JSON.stringify(list)); } catch (e) {}
  }
  function truncateTitle(text) {
    text = (text || "").trim().replace(/\s+/g, " ");
    if (!text) return "محادثة بدون عنوان";
    return text.length > 42 ? text.slice(0, 42) + "…" : text;
  }

  /* بتتحفظ المحادثة الحالية في الأرشيف — بتتنادى بعد أي رسالة (مستخدم
     أو بوت) عشان لو حصل أي مقاطعة (قفل التاب مثلاً) مفيش حاجة تضيع. */
  function persistActiveConversation() {
    if (!history.length) return;
    var list = loadConversations();
    var idx = activeId ? list.findIndex(function (c) { return c.id === activeId; }) : -1;
    var now = new Date().toISOString();

    if (idx === -1) {
      activeId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      list.unshift({ id: activeId, title: truncateTitle(history[0].text), updatedAt: now, messages: history.slice() });
    } else {
      var item = list.splice(idx, 1)[0];
      item.messages = history.slice();
      item.updatedAt = now;
      list.unshift(item);
    }

    if (list.length > MAX_CONVERSATIONS) list = list.slice(0, MAX_CONVERSATIONS);
    saveConversations(list);
  }

  function formatConvDate(iso) {
    try {
      var d = new Date(iso);
      var now = new Date();
      var opts = { day: "numeric", month: "long" };
      if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
      return new Intl.DateTimeFormat("ar-EG", opts).format(d);
    } catch (e) { return ""; }
  }

  function renderArchiveList() {
    if (!archiveListEl) return;
    var list = loadConversations();
    archiveListEl.innerHTML = "";

    if (!list.length) {
      archiveListEl.appendChild(el("div", { class: "chat-archive-empty" }, [
        document.createTextNode("لسه مفيش محادثات محفوظة — أي محادثة تبدأها هتتحفظ هنا تلقائيًا.")
      ]));
      return;
    }

    list.forEach(function (conv) {
      var mainBtn = el("button", { type: "button", class: "chat-archive-item-main" }, [
        el("span", { class: "chat-archive-item-title" }, [document.createTextNode(conv.title)]),
        el("span", { class: "chat-archive-item-date" }, [document.createTextNode(formatConvDate(conv.updatedAt))])
      ]);
      mainBtn.addEventListener("click", function () { openConversation(conv.id); });

      var delBtn = el("button", {
        type: "button", class: "chat-archive-item-del", title: "حذف المحادثة", "aria-label": "حذف المحادثة"
      }, [svgIcon('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>')]);
      delBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!confirm('هيتمسح المحادثة دي نهائيًا ومش هترجع تاني.\n\nمتأكد؟')) return;
        deleteConversation(conv.id);
      });

      archiveListEl.appendChild(el("div", { class: "chat-archive-item" }, [mainBtn, delBtn]));
    });
  }

  function openConversation(id) {
    var conv = loadConversations().find(function (c) { return c.id === id; });
    if (!conv) return;
    activeId = conv.id;
    history = conv.messages.slice();
    messagesEl.innerHTML = "";
    hideSuggestions();
    history.forEach(function (m) {
      if (m.role === "user") addUserMessage(m.text);
      else addFinalBotMessage(m.text);
    });
    closeArchive();
    scrollToEnd();
  }

  function deleteConversation(id) {
    saveConversations(loadConversations().filter(function (c) { return c.id !== id; }));
    if (activeId === id) startNewConversation();
    renderArchiveList();
    showChatToast("اتمسحت المحادثة");
  }

  function openArchive() {
    renderArchiveList();
    if (containerEl) containerEl.classList.add("archive-open");
  }
  function closeArchive() {
    if (containerEl) containerEl.classList.remove("archive-open");
  }
  if (archiveBtn) {
    archiveBtn.addEventListener("click", function () {
      if (containerEl && containerEl.classList.contains("archive-open")) closeArchive();
      else openArchive();
    });
  }
  if (archiveCloseBtn) archiveCloseBtn.addEventListener("click", closeArchive);

  function startNewConversation() {
    activeId = null;
    history = [];
    messagesEl.innerHTML = "";
    suggestionsEl.classList.remove("hidden");
    greet();
    inputEl.focus();
  }

  /* ---------------------------- تكبير/تصغير الخط ---------------------------- */
  function applyFontSize(px) {
    messagesEl.style.setProperty("--chat-font-size", px + "px");
  }
  var currentFontSize = FONT_DEFAULT;
  (function initFontSize() {
    var v = parseInt(localStorage.getItem(FONT_KEY), 10);
    if (!v || isNaN(v)) v = FONT_DEFAULT;
    currentFontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, v));
    applyFontSize(currentFontSize);
  })();
  function changeFontSize(delta) {
    currentFontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, currentFontSize + delta));
    applyFontSize(currentFontSize);
    try { localStorage.setItem(FONT_KEY, currentFontSize); } catch (e) {}
  }
  if (fontDecBtn) fontDecBtn.addEventListener("click", function () { changeFontSize(-1); });
  if (fontIncBtn) fontIncBtn.addEventListener("click", function () { changeFontSize(1); });

  /* -------------------------------- المشاركة -------------------------------- */
  function buildShareText() {
    var lines = ["محادثتي مع مساعد TCSS 🤖", ""];
    history.forEach(function (m) {
      lines.push((m.role === "user" ? "أنا: " : "مساعد TCSS: ") + m.text);
      lines.push("");
    });
    lines.push("— من موقع Top Computer Science Students");
    return lines.join("\n");
  }
  if (shareBtn) {
    shareBtn.addEventListener("click", function () {
      if (!history.length) {
        showChatToast("ابدأ المحادثة الأول عشان تقدر تشاركها");
        return;
      }
      var text = buildShareText();
      try {
        if (typeof gtag === "function") {
          gtag("event", "share", { method: navigator.share ? "web_share" : "copy_text", content_type: "chat" });
        }
      } catch (e) {}
      if (navigator.share) {
        navigator.share({ title: "محادثتي مع مساعد TCSS", text: text }).catch(function () {});
      } else {
        copyText(text).then(function (ok) {
          flashButton(shareBtn, ok);
          showChatToast(ok ? "اتنسخت المحادثة كاملة ✓" : "معلش، مقدرناش ننسخ — جرب تاني");
        });
      }
    });
  }

  /* ------------------------------ حقل الإدخال ------------------------------ */
  function autoGrow() {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 130) + "px";
  }
  inputEl.addEventListener("input", autoGrow);
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      formEl.requestSubmit();
    }
  });

  Array.prototype.forEach.call(suggestionsEl.querySelectorAll("button"), function (btn) {
    btn.addEventListener("click", function () {
      inputEl.value = btn.textContent;
      formEl.requestSubmit();
    });
  });

  clearBtn.addEventListener("click", function () {
    startNewConversation();
  });

  formEl.addEventListener("submit", function (e) {
    e.preventDefault();
    send();
  });

  async function send() {
    var text = inputEl.value.trim();
    if (!text || isSending) return;

    hideSuggestions();
    isSending = true;
    sendBtn.disabled = true;
    addUserMessage(text);
    history.push({ role: "user", text: text });
    persistActiveConversation();
    inputEl.value = "";
    autoGrow();
    addTyping();

    var accumulated = "";
    var bubble = null;
    var gotAnyChunk = false;

    try {
      var res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: history.slice(-MAX_SEND_HISTORY)
        })
      });

      if (!res.ok || !res.body) throw new Error("bad status " + res.status);

      // قراءة الرد كـ Stream (Server-Sent Events) بدل ما ننتظر الرد كامل
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });

        var lines = buffer.split("\n");
        buffer = lines.pop(); // آخر سطر ممكن يكون ناقص، نسيبه للـ chunk الجاي

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (line.slice(0, 5) !== "data:") continue;
          var jsonStr = line.slice(5).trim();
          if (!jsonStr) continue;

          var obj;
          try { obj = JSON.parse(jsonStr); } catch (e) { continue; }

          if (obj.delta) {
            if (!gotAnyChunk) {
              removeTyping();
              bubble = createBotBubble(false);
              gotAnyChunk = true;
            }
            accumulated += obj.delta;
            setBotBubbleText(bubble, accumulated, true);
          }
        }
      }

      removeTyping();

      if (!gotAnyChunk || !accumulated.trim()) {
        addBotMessage("معلش، مقدرتش أفهم رد الخادم. جرّب تسأل تاني.", true);
      } else {
        setBotBubbleText(bubble, accumulated, false); // شيل مؤشر الكتابة النهائي
        attachBotActions(bubble);
        history.push({ role: "assistant", text: accumulated });
        persistActiveConversation();
      }
    } catch (err) {
      removeTyping();
      if (bubble && accumulated) {
        // اتقطع الاتصال في نص الرد — سيب اللي وصل وبس شيل مؤشر الكتابة
        setBotBubbleText(bubble, accumulated, false);
        attachBotActions(bubble);
        history.push({ role: "assistant", text: accumulated });
        persistActiveConversation();
      } else {
        addBotMessage("معلش، حصلت مشكلة في الاتصال 🙏 اتأكد إن النت شغال وجرّب تاني كمان شوية.", true);
      }
    } finally {
      isSending = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }
  }

  function init() {
    // كل فتح جديد للشات بيبدأ بمحادثة فاضية (زي شات جي بي تي) — المحادثات
    // القديمة كلها متاحة من زرار "المحادثات" ومحفوظة بالكامل في الأرشيف.
    greet();
    inputEl.focus();
  }

  init();
})();
