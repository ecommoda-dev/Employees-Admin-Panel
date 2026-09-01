# Employees Admin Panel — قواعد الأداة

**وثيقة الأداة v1.1.0** · آخر تحديث: **01-09-2026**

أداة **قطعتين**: Worker على Cloudflare + واجهة HTML على GitHub Pages.

| العنصر | القيمة |
|---|---|
| اسم الـ Worker | `employees-admin-panel-worker` |
| رابط الـ Worker | `https://employees-admin-panel-worker.ecommoda-dev.workers.dev` |
| رابط الواجهة | `https://ecommoda-dev.github.io/Employees-Admin-Panel/` |
| `tool` في D1 | `employees_admin` |
| نسخة الـ Worker | v2.1.0 |
| نسخة الـ HTML | v2.1.2 |

> ℹ️ **نسخة الـ Worker ≠ نسخة الـ HTML** — قطعتين منفصلتين، الاختلاف طبيعي.

---

## 1. المتغيّرات — التصنيف الثلاثي (`ecommoda-tool-migration-playbook` §4-أ-٢)

| المتغيّر | النوع | مكانه |
|---|---|---|
| `WORKER_SECRET` | 🔑 **سر** | الداشبورد → Settings → Variables and Secrets |
| `DB` | binding | `wrangler.toml` → `[[d1_databases]]` |

✅ **الصف الثالث (var ليه fallback) فاضي تمامًا في الأداة دي.**
الكود بيستخدم `env.` مرتين بس — `env.DB` و `env.WORKER_SECRET`. مفيش
`[vars]` خالص، ومفيش أي `env.X || 'default'`. يعني **فخ "أرقام غلط بصمت"
(§7 الفخ السادس) مش وارد هنا معماريًا** — أي متغيّر ناقص بيدّي 401 صريح.

⚠️ **متضيفش `SHOP_DOMAIN` ولا `LOCATION_ID`** — الأداة دي مالهاش أي تعامل
مع Shopify. وجودهم في `wrangler.toml` هيبقى ضوضاء مضللة.

---

## 2. قيم D1 المسجّلة

مسجّلة في `ecommoda-constants` §7.

| `type` | متى |
|---|---|
| `login` / `logout` | دخول/خروج الأداة |
| `add_employee` · `update_display_name` | إضافة/تعديل موظف |
| `disable_employee` · `enable_employee` | إيقاف/تفعيل |
| `reset_pin` · `delete_employee` | مسح PIN / حذف نهائي |
| `grant_admin` · `revoke_admin` | منح/سحب صلاحية إدارة |

> ⚠️ **الكود بيكتب ١٠ أنواع، و`ecommoda-constants` §7 مسجّل ٥ بس.**
> المسجَّل: `login` · `enable_employee` · `disable_employee` · `grant_admin` ·
> `reset_pin` — وهي بالظبط القيم اللي **ظهرت فعليًا في D1**.
> **الناقص خمسة** (متأكَّد بالعدّ من الكود 01-09-2026): `logout` ·
> `add_employee` · `update_display_name` · `delete_employee` · `revoke_admin`.
> الخمسة دول موجودين في الكود بس لسه ما اتنفّذوش ولا مرة، عشان كده ما ظهروش
> في D1 — **مش معناها إنهم مش هيتكتبوا**. بند مفتوح تحت.
>
> المصدر: `ADMIN_ACTIONS` فيه **٨** إجراءات، زائد `login` و`logout` = ١٠.

---

## 3. خط الأساس — مستنبط من D1 (مش من تشغيل الأداة)

الأداة كانت شغّالة قبل النقل، وخط الأساس **ما اتسجّلش بتشغيل يدوي**.
البديل المستنبط (`ecommoda-tool-migration-playbook` §0-ب) — حالة `logs`
لحظة النقل **31-08-2026**:

| `type` | العدد | آخر صف |
|---|---|---|
| `login` | 11 | 2026-08-31T17:49:52Z |
| `enable_employee` | 2 | 2026-08-16T08:09:58Z |
| `disable_employee` | 2 | 2026-08-13T06:36:10Z |
| `reset_pin` | 1 | 2026-08-17T09:44:53Z |
| `grant_admin` | 1 | 2026-08-09T19:42:42Z |

**الاستعلام للمقارنة بعد النقل** (one-liner للـ D1 Console — §8 في `ecommoda-constants`):

```sql
SELECT type, COUNT(*) AS n, MAX(timestamp) AS latest FROM logs WHERE tool = 'employees_admin' GROUP BY type ORDER BY n DESC;
```

✅ **بند ١٠ اتقفل — 01-09-2026.** بعد الدمج والتشغيل، نفس الاستعلام رجّع:

| `type` | قبل | بعد |
|---|---|---|
| `login` | 11 | **13** |
| `enable_employee` | 2 | 2 |
| `disable_employee` | 2 | 2 |
| `reset_pin` | 1 | 1 |
| `grant_admin` | 1 | 1 |

**الـ `login` بس هو اللي زاد، والباقي ثابت بالظبط** — ده إثبات إن الأداة
بتكتب في D1 من النسخة المنشورة من git، ومن غير أي أثر جانبي على البيانات
التاريخية. الأداة **مالهاش** فخ السادس أصلاً (§1)، والبند ده بقى مقفول
بدليل مش بافتراض.

---

## 4. النسخ القديمة — الاسترجاع

ملفات النسخ المرقّمة اتمسحت من `main` (`ecommoda-tool-migration-playbook` §5.3).
git بيحفظها — **مش محتاجة tags** (§8 · §10).

| الملف | آخر commit موجود فيه |
|---|---|
| `1.1.0.html` | `d3a4c66` |
| `Index.html` (النسخة الكاملة، قبل ما تبقى صفحة تحويل) | `d3a4c66` |

```bash
git show d3a4c66:1.1.0.html > /tmp/1.1.0.html
```

> ✅ **إثبات نظافة الترحيل:** `Index.html` القديم و `index.html` الجديد ليهم
> **نفس الـ blob SHA** — `40d1754fb25c9d33109d530ee90072ce07d023b8`.
> دليل رياضي إن مفيش بايت واحد اتغيّر في الواجهة.
>
> ✅ **ونفس الشيء للـ Worker:** `index.js` اتكتب من
> `workers_get_worker_code` بالظبط زي ما رجع، والـ 18 `action` كلهم موجودين
> بنفس الترتيب. البصمة اتضافت في **commit منفصل بعده** عشان الكوميت الأول
> يفضل دليل مطابقة بايت ببايت للنسخة المنشورة.

---

## 5. ملاحظات معمارية

- **CORS صارم (Option B)** — `ALLOWED_ORIGINS = ['https://ecommoda-dev.github.io']`
  فقط. أداة كتابة على بيانات حساسة، مفيش wildcard.
  ✅ نضيفة من `ecommoda24.github.io` المهجور (`ecommoda-constants` §5).
- **`WORKER_SECRET` مطلوب على كل الـ endpoints بلا استثناء** — حتى
  `get_employees`. مفيش أي راوت بره البوابة.
- **الدخول مقصور على `is_admin = 1`** — التحقق مرتين: `check_employee`
  (تحذير مبكر قبل الـ PIN) و `verify_employee` (403 نهائي).
- **موظف مايقدرش يسحب صلاحية الإدارة من نفسه** — حماية من قفل النفس بره الأداة.
- **`get_access_log` بيقرا كل الـ tools** مش الأداة دي بس — ده سجل الدخول
  المركزي للستاك كله. أي تغيير فيه بيأثر على رؤية كل الأدوات.

---

## 6. مسائل مفتوحة

1. ✅ **عمود `employees.is_admin` — اتوثّق 01-09-2026 (كان بند 🔴).**
   الكود بيشير لملف `SETUP.txt` **غير موجود في الريبو ولا في أي حتة**،
   فالأمر اتقرا من مخطط D1 الفعلي (`sqlite_master`) واتوثّق هنا.

   ⛔ **متشغّلوش دلوقتي — العمود موجود بالفعل**، والتنفيذ هيرمي
   `duplicate column name: is_admin`. ده **مرجع لإعادة البناء بس**.

   ```sql
   ALTER TABLE employees ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
   ```

   ⚠️ **`NOT NULL` جزء من التعريف الفعلي** — المخطط الحقيقي في D1 هو
   `is_admin INTEGER NOT NULL DEFAULT 0`. أمر من غير `NOT NULL` بيدّي عمود
   nullable مختلف عن الإنتاج. (الكود بيستخدم `COALESCE(is_admin, 0)` في
   `list_employees`، فهو بيتحمّل الاتنين — يعني الفرق **مش هيبان كخطأ**،
   وده بالظبط اللي بيخلي التوثيق الدقيق مهم هنا.)

   المخطط الكامل للجدول وقت التوثيق:
   ```sql
   CREATE TABLE employees (username TEXT PRIMARY KEY, display_name TEXT NOT NULL, pin TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), last_login TEXT, is_admin INTEGER NOT NULL DEFAULT 0);
   ```

2. 🟡 **الواجهة بتخزّن `WORKER_SECRET` في `localStorage`** (مفتاح
   `employees_admin_worker_secret`) عبر مودال الإعدادات — نمط أقدم من
   `ecommoda-constants` §5b (اللي بيقول الرابط يتحط في `§CONFIG` مباشرة).
   **ما اتغيّرش في النقل عن قصد** — النقل بايت ببايت. أي تغيير هنا شغل منفصل.

3. 🟡 **`ecommoda-constants` §7 ناقص **خمس** قيم `type`** للأداة دي — تفصيل في §2 فوق.

4. ⚪ **`Build watch paths` لسه ما اتضيّقتش** — الافتراضي `*`، يعني أي تعديل
   HTML بينشر الـ Worker تاني بلا داعي (`ecommoda-tool-migration-playbook` §13-ب).
   لو اتضيّقت لـ `index.js` + `wrangler.toml`، **لازم الاختبارين الاتنين**
   (سلبي وإيجابي) — واحد مش كفاية.
   ⚠️ ولو الأداة كبرت وضافت ملف بيعتمد عليه الـ Worker، **لازم يتضاف للـ paths**.

🔴 **معلّقة:** — لا شيء

---

## بصمة المهارات

| المهارة | الإصدار وقت آخر تعديل |
|---|---|
| ecommoda-worker-builder | v1.0.0 |
| ecommoda-html-builder | v1.0.0 |
| ecommoda-constants | v1.0.0 |

آخر مطابقة: 31-08-2026 · `index.js` v2.1.0 · `index.html` v2.1.2

> ⚠️ `v1.0.0` هنا معناها **"ما قبل النظام"** — الكود اتكتب 09-08-2026، قبل
> ما نظام إصدارات المهارات يبدأ (25-08-2026). **مش شهادة مطابقة**
> (`ecommoda-skill-versioning` Step 5). الـ backfill ممنوع (Step 6) — البصمة
> هتترفع أول مرة الأداة تتفتح لسبب حقيقي.
>
> ⛔ **ممنوع** التحقق من بصمة الـ Worker عن طريق `workers_get_worker_code` —
> `esbuild` بيشيل التعليقات وقت البناء، فالبصمة **مش** في النسخة المنشورة.
> مصدر الحقيقة = الملف ده.
