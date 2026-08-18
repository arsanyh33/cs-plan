# Top Computer Science Students

🔗 **https://arsanyh33.github.io/cs-plan/**

دليل مقررات قسم الرياضيات وعلوم الحاسب — كلية العلوم، جامعة الإسكندرية.
لائحة الساعات المعتمدة. موقع أونلاين عادي — يشتغل من أي متصفح.

## المحتوى
- حاسب (رئيسي) + إحصاء (فرعي) — 132 ساعة
- علوم الحاسب — سبيشيال — 132 ساعة

## أدوات
| | |
|---|---|
| حجم الخط | `A−` `A` `A+` — أو `Ctrl` + `+` / `−` / `0` |
| معاينة الأجهزة | Auto / Mobile / Tablet / Laptop |
| بحث | `/` أو `Ctrl+K` |
| نسخة احتياطية | `diagnostics.html` |

## هيكل المشروع
```
index.html              الصفحة الرئيسية
about.html               عن المشروع
404.html                 صفحة الخطأ
diagnostics.html        التشخيص + تصدير/استيراد البيانات
registry.json           ⭐ سجل الصفحات — هنا تضيف صفحة جديدة

originals/   🔒 الملفات الأصلية زي ما هي + checksums
modules/     cs-stat · cs-special · _template
assets/      app.css · bridge.css · store.js · inapp.js
             bridge.js · shell.js · bg.js · fonts/ · icons/
tools/       patch_modules.py · verify_data.py · test_logic.js
```

## إضافة صفحة جديدة
```bash
cp -r modules/_template modules/schedule
```
1. اكتب صفحتك في `modules/schedule/index.html`
2. ضيف object في `registry.json`
3. زوّد رقم `version` في `registry.json`

مفتاح الحفظ يبدأ بـ `cs` + حرف كبير (مثال `csSchedule_v1`) → يدخل النسخ الاحتياطي تلقائيًا.

## تحديث
```bash
python3 tools/patch_modules.py    # لو عدّلت ملفات originals/
python3 tools/verify_data.py      # يتأكد إن البيانات ما اتغيرتش
node tools/test_logic.js          # 64 اختبار
```

## ملاحظات
- الموقع أونلاين بالكامل — مفيش تخزين أوفلاين ولا تثبيت PWA. بيانات المستخدم (تقدمه، تقديراته) بس هي اللي بتتخزن محليًا على جهازه.
- الخطوط مدمجة base64 جوه `assets/fonts/fonts.css`. نسخة الملفات المنفصلة في `fonts.linked.css`.
- `assets/icons/og.png` (صورة معاينة واتساب) لازم ترفعها يدويًا — الملفات الثنائية مابتترفعش عبر الـ API.
