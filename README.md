# Top Computer Science Students

🔗 **https://arsanyh33.github.io/cs-plan/**

دليل مقررات قسم الرياضيات وعلوم الحاسب — كلية العلوم، جامعة الإسكندرية.
لائحة الساعات المعتمدة. يعمل بدون إنترنت ويتثبّت على الشاشة الرئيسية.

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
| تثبيت | `install.html` |

## هيكل المشروع
```
index.html              الصفحة الرئيسية
install.html            التثبيت (يكتشف الجهاز)
diagnostics.html        التشخيص + تصدير/استيراد البيانات
offline.html            صفحة الاحتياط
sw.js                   Service Worker — الشغل بدون نت
registry.json           ⭐ سجل الصفحات — هنا تضيف صفحة جديدة
manifest.webmanifest    تعريف التطبيق

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
3. ضيف المسار في `PRECACHE` جوه `sw.js` وزوّد `CACHE_VERSION`

مفتاح الحفظ يبدأ بـ `cs` + حرف كبير (مثال `csSchedule_v1`) → يدخل النسخ الاحتياطي تلقائيًا.

## تحديث
```bash
python3 tools/patch_modules.py    # لو عدّلت ملفات originals/
python3 tools/verify_data.py      # يتأكد إن البيانات ما اتغيرتش
node tools/test_logic.js          # 64 اختبار
```
زوّد `CACHE_VERSION` في `sw.js` بعد أي تعديل.

## ملاحظات
- الشغل بدون نت محتاج `https://` — يعني من اللينك، مش بفتح الملف مباشرة.
- الخطوط مدمجة base64 جوه `assets/fonts/fonts.css`. نسخة الملفات المنفصلة في `fonts.linked.css`.
- `assets/icons/og.png` (صورة معاينة واتساب) لازم ترفعها يدويًا — الملفات الثنائية مابتترفعش عبر الـ API.
