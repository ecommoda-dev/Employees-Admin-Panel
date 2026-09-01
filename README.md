<div dir="rtl">

# 👥 Employees Admin Panel — إدارة الموظفين

**Worker v2.1.0** · **HTML v2.1.2** · آخر تحديث: **31-08-2026**

أداة داخلية لإدارة حسابات موظفي EcomModa — إضافة وتعديل وإيقاف وتفعيل وحذف،
مع إعادة ضبط الـ PIN، ومنح/سحب صلاحية الإدارة، وسجل تدقيق كامل لكل إجراء،
وسجل الدخول والخروج من **كل** أدوات الستاك.

## الروابط

| | |
|---|---|
| **الواجهة** | https://ecommoda-dev.github.io/Employees-Admin-Panel/ |
| **الـ API** | https://employees-admin-panel-worker.ecommoda-dev.workers.dev |

> ⚠️ الدخول مقصور على الحسابات اللي عندها `is_admin = 1`.

## البنية

```
Employees-Admin-Panel/
├── index.js        ← كود الـ Worker (Cloudflare Workers + D1)
├── wrangler.toml   ← الاسم + binding الـ D1
├── index.html      ← الواجهة (GitHub Pages)
├── Index.html      ← صفحة تحويل فقط — بدون أي منطق
├── CLAUDE.md       ← قواعد الأداة والمسائل المفتوحة
├── README.md
└── .gitignore
```

## النشر

النشر **آلي** بالكامل من `main` — مفيش رفع يدوي:

| القطعة | المنصّة | الزمن |
|---|---|---|
| `index.js` + `wrangler.toml` | Cloudflare Workers Builds | ~٢٣ ثانية |
| `index.html` | GitHub Pages | دقيقة–اتنين |

> ⛔ **ممنوع نسخ/لصق كود في داشبورد Cloudflare بعد الربط** — أول push جاي
> بيمسحه. الريبو هو المصدر الوحيد.

## المتغيّرات

| المتغيّر | النوع | مكانه |
|---|---|---|
| `WORKER_SECRET` | 🔑 سر | داشبورد Cloudflare (+ **Promote** بعد أي تعديل) |
| `DB` | binding | `wrangler.toml` |

**مفيش `[vars]`** — الأداة مالهاش أي تعامل مع Shopify.

## التوثيق

التفاصيل الكاملة — تصنيف المتغيّرات · قيم D1 · خط الأساس · استرجاع النسخ
القديمة · المسائل المفتوحة → **[`CLAUDE.md`](./CLAUDE.md)**

</div>
