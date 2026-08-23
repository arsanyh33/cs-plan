/* ============================================================
   TCSS Chatbot — صفحة مستقلة (chat.html)
   بيرد على أسئلة الطلبة عن الخطط الدراسية بناءً على بيانات الموقع
   الفعلية (assets/kb.json)، عن طريق Cloudflare Worker وسيط بيحمي
   مفتاح الـ API. نفس منطق الويدجت القديم، لكن كصفحة كاملة.
   ============================================================ */
(function () {
  "use strict";

  // ⚠️ غيّر السطر ده بعد ما تعمل الـ Cloudflare Worker وتاخد رابطه —
  // شرح الخطوة دي موجود في دليل-تنصيب-الشات-بوت.md.
  var WORKER_URL = "https://tcss-chatbot.arsanyh33.workers.dev/";

  var MAX_STORED_HISTORY = 20;
  var STORAGE_KEY = "csChatHistory_v1";

  var history = []; // {role:'user'|'assistant', text:''}
  var isSending = false;

  var messagesEl = document.getElementById("chatMessages");
  var suggestionsEl = document.getElementById("chatSuggestions");
  var formEl = document.getElementById("chatForm");
  var inputEl = document.getElementById("chatInput");
  var sendBtn = document.getElementById("chatSendBtn");
  var clearBtn = document.getElementById("chatClearBtn");

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

  function addUserMessage(text) {
    messagesEl.appendChild(el("div", { class: "chat-msg user" }, [document.createTextNode(text)]));
    scrollToEnd();
  }
  function addBotMessage(text, isError) {
    var cls = "chat-msg bot" + (isError ? " error" : "");
    messagesEl.appendChild(el("div", { class: cls }, [document.createTextNode(text)]));
    scrollToEnd();
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

  function saveHistory() {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history)); } catch (e) {}
  }

  function greet() {
    addBotMessage("أهلاً! 👋 أنا مساعد TCSS، اسألني عن أي حاجة في خطتك الدراسية — الساعات، المتطلبات السابقة، شروط السبيشيال، التحويل، أو المعدل والإنذار.");
  }

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
    history = [];
    saveHistory();
    messagesEl.innerHTML = "";
    suggestionsEl.classList.remove("hidden");
    greet();
    inputEl.focus();
  });

  formEl.addEventListener("submit", function (e) {
    e.preventDefault();
    send();
  });

  async function send() {
    var text = inputEl.value.trim();
    if (!text || isSending) return;

    if (WORKER_URL.indexOf("YOUR-WORKER-NAME") !== -1) {
      addBotMessage("⚠️ الشات بوت لسه مش متظبط بالكامل (رابط الـ Worker مش متحط في assets/chat.js). كلم صاحب الموقع.", true);
      return;
    }

    hideSuggestions();
    isSending = true;
    sendBtn.disabled = true;
    addUserMessage(text);
    history.push({ role: "user", text: text });
    saveHistory();
    inputEl.value = "";
    autoGrow();
    addTyping();

    try {
      var res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: history.slice(-MAX_STORED_HISTORY)
        })
      });

      removeTyping();

      if (!res.ok) throw new Error("bad status " + res.status);
      var data = await res.json();
      var reply = (data && data.reply) ? data.reply : "معلش، مقدرتش أفهم رد الخادم. جرّب تسأل تاني.";
      addBotMessage(reply);
      history.push({ role: "assistant", text: reply });
      saveHistory();
    } catch (err) {
      removeTyping();
      addBotMessage("معلش، حصلت مشكلة في الاتصال 🙏 اتأكد إن النت شغال وجرّب تاني كمان شوية.", true);
    } finally {
      isSending = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }
  }

  function init() {
    try {
      var saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(saved) && saved.length) {
        history = saved;
        hideSuggestions();
        history.forEach(function (m) {
          if (m.role === "user") addUserMessage(m.text);
          else addBotMessage(m.text);
        });
      } else {
        greet();
      }
    } catch (e) {
      greet();
    }
    inputEl.focus();
  }

  init();
})();
