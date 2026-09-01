// ══════════════════════════════════════════════════════
// employees-admin-panel-worker — v2.2.0
// إدارة الموظفين (إضافة / تعديل / إيقاف / حذف) + سجل دخول وخروج
// كل الأدوات + سجل إجراءات إدارية (audit log) + صلاحية is_admin
//
// v2.0.0 — إعادة بناء كاملة لمطابقة قواعد ecommoda-worker-builder:
//   - Section Tags كاملة
//   - Universal D1 Auth (PIN login) بدل ما كانت الأداة من غير تسجيل دخول
//   - WORKER_SECRET + Authorization: Bearer بدل X-Admin-Secret
//   - CORS صارم (Option B) بدل الـ wildcard — أداة كتابة/تعديل
//   - سجل تدقيق (audit log) لكل إجراء إداري: مين عمل إيه ومتى
//
// v2.1.0 — عمود is_admin:
//   - عمود جديد employees.is_admin (INTEGER NOT NULL DEFAULT 0)
//   - check_employee/verify_employee بيرفضوا أي حساب is_admin = 0 من دخول هذه الأداة تحديداً
//   - إجراءات جديدة: grant_admin / revoke_admin (مسجّلة في audit log)
//   - حماية: لا يمكن لموظف سحب صلاحيته الإدارية من نفسه
//
// v2.2.0 — مواءمة مع ecommoda-worker-builder v1.1.0:
//   - Step 5A ⑨: endpointان إلزاميان — ?action=diag و ?action=get_config
//   - Step 5A ⑦: فشل D1 بيرجع كـ logged:false — مش 500 على عملية نجحت فعلاً
//   - Step 5A ④: نتيجة كل إجراء إداري تلات حالات (success/warning/error)
//     وبتتسجّل في extra.result عشان عمود "النتيجة" في تاب السجل
//   - Step 5A ⑧: assertEnv() قبل أي كتابة — متغيّر ناقص بيوقف العملية باسمه
//   - offset بيتقصّ على صفر (كان parseInt خام)
//   - تصحيح توثيقي: مرجع SETUP.txt المحذوف اتشال — المخطط في CLAUDE.md §6
//
// skills: worker-builder v1.1.0 · constants v1.4.1 — 01-09-2026
// ══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
// §CONSTANTS
// ══════════════════════════════════════════════════════
const TOOL_NAME      = 'employees_admin';
const WORKER_VERSION = 'v2.2.0';   // بيترجع من ?action=get_config — الواجهة بتقارنه بنسختها

// أنواع إجراءات التدقيق (audit) — تُستخدم كـ type في جدول logs
const ADMIN_ACTIONS = {
  ADD:          'add_employee',
  UPDATE:       'update_display_name',
  DISABLE:      'disable_employee',
  ENABLE:       'enable_employee',
  RESET_PIN:    'reset_pin',
  DELETE:       'delete_employee',
  GRANT_ADMIN:  'grant_admin',
  REVOKE_ADMIN: 'revoke_admin',
};

// ══════════════════════════════════════════════════════
// §CORS — Option B (صارم) — أداة كتابة/تعديل على بيانات الموظفين
// ══════════════════════════════════════════════════════
const ALLOWED_ORIGINS = [
  'https://ecommoda-dev.github.io',
];
function getCORS(request) {
  const origin  = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

// ══════════════════════════════════════════════════════
// §HELPERS
// ══════════════════════════════════════════════════════
function json(data, status = 200, request = null) {
  const headers = { 'Content-Type': 'application/json' };
  Object.assign(headers, request ? getCORS(request) : { 'Access-Control-Allow-Origin': '*' });
  return new Response(JSON.stringify(data), { status, headers });
}

function validUsername(u) { return /^[a-zA-Z0-9_]{2,40}$/.test(u); }

/**
 * §HELPERS::assertEnv — Step 5A ⑧
 * متغيّر ناقص لازم يوقف العملية برسالة **باسمه**، مش يتحوّل لفشل غامض جوه SQL.
 * الأداة دي مالهاش [vars] خالص — المطلوب بس الـ binding والسر.
 */
function assertEnv(env, names) {
  const missing = names.filter(n => !env[n]);
  if (missing.length) throw new Error(`متغيّرات ناقصة في الـ Worker: ${missing.join(', ')} — راجع الداشبورد ثم Promote`);
}

/**
 * §HELPERS::logSafe — Step 5A ⑦
 * الفعل الأساسي (UPDATE/INSERT/DELETE) حصل فعلاً قبل النداء ده. فشل الكتابة في
 * `logs` بعده **مايسقّطش الرد كله على 500** — بيرجع كـ `logged:false` عشان
 * الواجهة تحذّر إن العملية تمت بس السجل ناقص.
 * ⚠️ مش `.catch(() => {})` — ده بيخفي الفشل تمامًا وممنوع (anti-patterns).
 */
async function logSafe(db, entry) {
  try {
    await writeLog(db, entry);
    return { logged: true, logError: null };
  } catch (e) {
    return { logged: false, logError: e.message };
  }
}

// ══════════════════════════════════════════════════════
// §SHARED — Auth & Logging Functions — EcomModa D1 Pattern v1.3.0
// copy verbatim — لا تعدّل
// ══════════════════════════════════════════════════════

/**
 * Verify employee and return display_name if correct.
 * Updates last_login automatically.
 * Returns: string (display_name) or null if wrong PIN.
 * Throws: Error if account is suspended.
 */
async function verifyEmployee(db, username, pin) {
  const row = await db.prepare(
    'SELECT display_name, is_active FROM employees WHERE username = ? AND pin = ?'
  ).bind(username, pin).first();

  if (!row) return null;

  if (!row.is_active) {
    throw new Error('الحساب موقوف — تواصل مع المسؤول');
  }

  db.prepare('UPDATE employees SET last_login = ? WHERE username = ?')
    .bind(new Date().toISOString(), username)
    .run()
    .catch(() => {});

  return row.display_name;
}

/**
 * Check if employee exists and has a PIN registered.
 * Used in Login screen to decide: normal login vs first-time PIN setup.
 */
async function checkEmployee(db, username) {
  const row = await db.prepare(
    'SELECT is_active, pin FROM employees WHERE username = ?'
  ).bind(username).first();

  if (!row) return { exists: false, hasPin: false, isActive: false };
  return {
    exists:   true,
    hasPin:   !!row.pin,
    isActive: !!row.is_active,
  };
}

/**
 * Register PIN for the first time.
 * Throws if: user not found / suspended / already has PIN.
 */
async function registerPin(db, username, pin) {
  const row = await db.prepare(
    'SELECT pin, is_active FROM employees WHERE username = ?'
  ).bind(username).first();

  if (!row)           throw new Error('اسم المستخدم غير موجود');
  if (!row.is_active) throw new Error('الحساب موقوف — تواصل مع المسؤول');
  if (row.pin)        throw new Error('هذا المستخدم مسجّل بالفعل — تواصل مع المسؤول لإعادة الضبط');

  await db.prepare('UPDATE employees SET pin = ? WHERE username = ?')
    .bind(pin, username)
    .run();

  return true;
}

/**
 * Write a log entry to D1.
 * Only tool and type are required. All other fields optional (null if not provided).
 */
async function writeLog(db, entry) {
  await db.prepare(`
    INSERT INTO logs
      (timestamp, tool, type, employee, order_id, order_name,
       sku, product_title, delta, value_before, value_after, notes, extra)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    entry.timestamp    ?? new Date().toISOString(),
    entry.tool,
    entry.type,
    entry.employee     ?? null,
    entry.orderId      ?? null,
    entry.orderName    ?? null,
    entry.sku          ?? null,
    entry.productTitle ?? null,
    entry.delta        ?? null,
    entry.valueBefore  ?? null,
    entry.valueAfter   ?? null,
    entry.notes        ?? null,
    entry.extra ? JSON.stringify(entry.extra) : null
  ).run();
}

/**
 * Fetch logs from D1 with server-side filtering + pagination.
 * login/logout excluded server-side via SQL — NOT client-side.
 * Max limit per page: 100 (enforced server-side).
 */
async function getLogs(db, {
  tool     = null,
  employee = null,
  type     = null,
  search   = null,
  limit    = 100,
  offset   = 0,
} = {}) {
  let sql = "SELECT * FROM logs WHERE type NOT IN ('login','logout')";
  const b = [];

  if (tool)     { sql += ' AND tool = ?';     b.push(tool); }
  if (employee) { sql += ' AND employee = ?'; b.push(employee); }
  if (type)     { sql += ' AND type = ?';     b.push(type); }
  if (search) {
    sql += ' AND (order_name LIKE ? OR notes LIKE ?)';
    b.push(`%${search}%`, `%${search}%`);
  }

  sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  b.push(Math.min(limit, 100), offset);

  return (await db.prepare(sql).bind(...b).all()).results;
}

/**
 * Count total matching log rows (for pagination UI).
 */
async function getLogsCount(db, {
  tool     = null,
  employee = null,
  search   = null,
} = {}) {
  let sql = "SELECT COUNT(*) as total FROM logs WHERE type NOT IN ('login','logout')";
  const b = [];

  if (tool)     { sql += ' AND tool = ?';     b.push(tool); }
  if (employee) { sql += ' AND employee = ?'; b.push(employee); }
  if (search) {
    sql += ' AND (order_name LIKE ? OR notes LIKE ?)';
    b.push(`%${search}%`, `%${search}%`);
  }

  const row = await db.prepare(sql).bind(...b).first();
  return row?.total ?? 0;
}

/**
 * Fetch all matching logs for XLSX export — up to 2000 rows.
 */
async function getLogsExport(db, {
  tool     = null,
  employee = null,
  search   = null,
} = {}) {
  let sql = "SELECT * FROM logs WHERE type NOT IN ('login','logout')";
  const b = [];

  if (tool)     { sql += ' AND tool = ?';     b.push(tool); }
  if (employee) { sql += ' AND employee = ?'; b.push(employee); }
  if (search) {
    sql += ' AND (order_name LIKE ? OR notes LIKE ?)';
    b.push(`%${search}%`, `%${search}%`);
  }

  sql += ' ORDER BY timestamp DESC LIMIT 2000';

  return (await db.prepare(sql).bind(...b).all()).results;
}

// ══════════════════════════════════════════════════════
// §HANDLER
// ══════════════════════════════════════════════════════
export default {
  async fetch(request, env) {

    // 1. CORS Preflight — دايماً أول حاجة
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: getCORS(request) });
    }

    // 2. WORKER_SECRET check — دايماً ثاني حاجة (لا استثناءات — ولا حتى get_employees)
    const auth = request.headers.get('Authorization');
    if (!auth || auth !== `Bearer ${env.WORKER_SECRET}`) {
      return json({ ok: false, error: 'Unauthorized' }, 401, request);
    }

    const url    = new URL(request.url);
    const action = url.searchParams.get('action') || '';
    const body   = request.method === 'POST'
      ? await request.json().catch(() => ({}))
      : {};
    const p = (k) => url.searchParams.get(k) ?? body[k] ?? '';

    try {

      // ─── §DIAG — endpointان إلزاميان (worker-builder Step 5A ⑨) ───
      // get_config — بيكشف Promote ناقص أو Worker شبح: الواجهة بتقارن
      // نسختها بنسخة الـ Worker وبتعرض تحذير لو مختلفين.
      if (action === 'get_config') {
        return json({ ok: true, version: WORKER_VERSION, tool: TOOL_NAME }, 200, request);
      }

      // diag — فحص ذاتي **بدون أي كتابة**.
      // ⚠️ ممنوع يرجّع قيمة أي سر — الأسماء والأطوال بس.
      if (action === 'diag') {
        const checks = [];
        const envKeys = Object.keys(env).sort().map(k => ({
          name: k,
          type: typeof env[k],
          // الطول بيكشف المسافة المخفية في آخر السر — من غير ما يعرض القيمة
          length: typeof env[k] === 'string' ? env[k].length : null,
        }));

        checks.push({
          ok:   !!env.WORKER_SECRET,
          name: 'WORKER_SECRET',
          detail: env.WORKER_SECRET
            ? `موجود — الطول ${String(env.WORKER_SECRET).length} حرف`
            : 'ناقص — ضيفه في Settings → Variables and Secrets ثم Promote',
        });
        checks.push({
          ok:   !!env.DB,
          name: 'D1 binding (DB)',
          detail: env.DB ? 'موجود في wrangler.toml' : 'ناقص — راجع [[d1_databases]] في wrangler.toml',
        });

        // اتصال D1 فعلي + وجود عمود is_admin في المخطط (CLAUDE.md §6)
        try {
          const row = await env.DB.prepare(
            'SELECT COUNT(*) AS total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active, SUM(COALESCE(is_admin,0)) AS admins FROM employees'
          ).first();
          checks.push({
            ok: true, name: 'جدول employees',
            detail: `${row?.total ?? 0} موظف — منهم ${row?.active ?? 0} نشط و${row?.admins ?? 0} بصلاحية إدارة`,
          });
        } catch (e) {
          checks.push({ ok: false, name: 'جدول employees', detail: `فشل الاستعلام: ${e.message}` });
        }

        try {
          const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM logs WHERE tool = ?').bind(TOOL_NAME).first();
          checks.push({ ok: true, name: 'جدول logs', detail: `${row?.n ?? 0} صف باسم الأداة (tool = '${TOOL_NAME}')` });
        } catch (e) {
          checks.push({ ok: false, name: 'جدول logs', detail: `فشل الاستعلام: ${e.message}` });
        }

        const origin = request.headers.get('Origin') || '(بدون Origin)';
        checks.push({
          ok:   ALLOWED_ORIGINS.includes(origin),
          name: 'CORS Origin',
          detail: `الطلب جاي من ${origin} — المسموح: ${ALLOWED_ORIGINS.join(' · ')}`,
        });

        return json({ ok: true, version: WORKER_VERSION, tool: TOOL_NAME, envKeys, checks }, 200, request);
      }
      // ──────────────────────────────────────────────────────

      // متغيّر ناقص يوقف العملية برسالة باسمه — مش فشل غامض جوه SQL (Step 5A ⑧)
      assertEnv(env, ['DB']);

      // ─── §AUTH ──────────────────────────────────────────────
      // check_employee — GET (no sensitive data — GET is ok)
      // ⚠️ مُخصَّص لهذه الأداة: بيضيف isAdmin للتحقق المبكر (قبل إدخال الـ PIN)
      // بدون تعديل دالة checkEmployee المشتركة نفسها (§SHARED — verbatim)
      if (action === 'check_employee') {
        const username = url.searchParams.get('username');
        if (!username) return json({ ok: false, error: 'username مطلوب' }, 400, request);
        const result = await checkEmployee(env.DB, username);
        if (result.exists) {
          const row = await env.DB.prepare('SELECT is_admin FROM employees WHERE username = ?').bind(username).first();
          result.isAdmin = !!row?.is_admin;
        } else {
          result.isAdmin = false;
        }
        return json({ ok: true, ...result }, 200, request);
      }

      // register_pin — POST (PIN in body — GET is FORBIDDEN)
      if (action === 'register_pin') {
        if (request.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405, request);
        const { username, pin } = body;
        if (!username || !pin) return json({ ok: false, error: 'username و pin مطلوبان' }, 400, request);
        await registerPin(env.DB, username, pin);
        return json({ ok: true }, 200, request);
      }

      // verify_employee — POST (PIN in body — GET is FORBIDDEN)
      // ⚠️ مُخصَّص لهذه الأداة: بعد التحقق من الـ PIN (عبر الدالة المشتركة verifyEmployee
      // بدون أي تعديل عليها)، بيتحقق كمان من is_admin — هذه الأداة تحديداً مقصورة على
      // الموظفين اللي عندهم صلاحية إدارة (is_admin = 1)
      if (action === 'verify_employee') {
        if (request.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405, request);
        const { username, pin } = body;
        if (!username || !pin) return json({ ok: false, error: 'username و pin مطلوبان' }, 400, request);

        const displayName = await verifyEmployee(env.DB, username, pin);
        if (!displayName) return json({ ok: false, error: 'PIN خطأ أو المستخدم غير موجود' }, 401, request);

        const row = await env.DB.prepare('SELECT is_admin FROM employees WHERE username = ?').bind(username).first();
        if (!row?.is_admin) {
          return json({ ok: false, error: 'هذا الحساب غير مصرّح له بالدخول على أداة إدارة الموظفين' }, 403, request);
        }

        // ⚠️ الدخول نفسه نجح فعلاً فوق — فشل D1 بعد كده يرجع logged:false مش 500
        const { logged } = await logSafe(env.DB, {
          tool:     TOOL_NAME,
          type:     'login',
          employee: username,
          notes:    `دخول: ${displayName}`,
        });
        return json({ ok: true, displayName, logged }, 200, request);
      }

      // log_logout — GET ok (no sensitive data)
      if (action === 'log_logout') {
        const username = url.searchParams.get('username');
        let logged = true;
        if (username) {
          ({ logged } = await logSafe(env.DB, {
            tool:     TOOL_NAME,
            type:     'logout',
            employee: username,
            notes:    `خروج: ${username.replace(/_/g, ' ')}`,
          }));
        }
        return json({ ok: true, logged }, 200, request);
      }

      // get_employees — GET (for HTML dropdown)
      if (action === 'get_employees') {
        const { results } = await env.DB.prepare(
          'SELECT username, display_name FROM employees WHERE is_active = 1 ORDER BY display_name'
        ).all();
        return json({ ok: true, employees: results }, 200, request);
      }
      // ──────────────────────────────────────────────────────

      // ─── §ADMIN — إدارة الموظفين (كتابة) ───────────────────
      // كل الأكشنز هنا محمية بالفعل بـ WORKER_SECRET من فوق.
      // actor = username الموظف اللي مسجّل دخول حالياً في الأداة (لغرض التدقيق فقط)
      //
      // ⚠️ عقد موحّد لكل إجراء إداري (Step 5A ④ و⑦):
      //   الفعل الأساسي بيتنفّذ الأول ويتأكد من `r.changes` (مش من نية النداء)،
      //   وبعدين السجل بيتكتب بـ logSafe. الرد بيرجع دايمًا:
      //     status: 'success' | 'warning'   ← warning = الفعل تم والسجل فشل
      //     logged: true | false            ← الواجهة بتحذّر لو false
      //   ونفس القيمة بتتكتب في extra.result عشان عمود "النتيجة" في تاب السجل.

      // §ADMIN::listEmployees
      if (action === 'list_employees') {
        const res = await env.DB.prepare(
          `SELECT username, display_name, is_active,
                  (pin IS NOT NULL) AS has_pin,
                  COALESCE(is_admin, 0) AS is_admin,
                  created_at, last_login
           FROM employees ORDER BY display_name ASC`
        ).all();
        return json({ ok: true, employees: res.results }, 200, request);
      }

      // §ADMIN::addEmployee
      if (action === 'add_employee') {
        const username    = String(p('username')).trim();
        const displayName = String(p('display_name')).trim();
        const isAdmin     = p('is_admin') ? 1 : 0;
        const actor       = String(p('actor')).trim() || null;
        if (!username || !displayName) return json({ ok: false, error: 'username و display_name مطلوبان' }, 400, request);
        if (!validUsername(username))  return json({ ok: false, error: 'الـ username: حروف إنجليزية وأرقام وـ فقط (2–40 حرف)' }, 400, request);

        const exists = await env.DB.prepare('SELECT username FROM employees WHERE username = ?').bind(username).first();
        if (exists) return json({ ok: false, error: 'الـ username موجود بالفعل' }, 400, request);

        const r = await env.DB.prepare('INSERT INTO employees (username, display_name, is_admin) VALUES (?, ?, ?)').bind(username, displayName, isAdmin).run();
        if (!r.success) return json({ ok: false, error: 'D1 ما أكدتش الإضافة' }, 500, request);

        const { logged, logError } = await logSafe(env.DB, {
          tool: TOOL_NAME, type: ADMIN_ACTIONS.ADD, employee: actor,
          notes: `إضافة موظف: ${displayName} (${username})${isAdmin ? ' — بصلاحية إدارة' : ''}`,
          extra: { targetUsername: username, targetDisplayName: displayName, isAdmin: !!isAdmin, result: 'success' },
        });

        return json({ ok: true, status: logged ? 'success' : 'warning', logged, logError, message: `تمت إضافة ${displayName}` }, 200, request);
      }

      // §ADMIN::updateDisplayName
      if (action === 'update_display_name') {
        const username    = String(p('username')).trim();
        const displayName = String(p('display_name')).trim();
        const actor       = String(p('actor')).trim() || null;
        if (!username || !displayName) return json({ ok: false, error: 'username و display_name مطلوبان' }, 400, request);

        const before = await env.DB.prepare('SELECT display_name FROM employees WHERE username = ?').bind(username).first();
        const r = await env.DB.prepare('UPDATE employees SET display_name = ? WHERE username = ?').bind(displayName, username).run();
        if (r.changes === 0) return json({ ok: false, error: 'المستخدم غير موجود' }, 404, request);

        const { logged, logError } = await logSafe(env.DB, {
          tool: TOOL_NAME, type: ADMIN_ACTIONS.UPDATE, employee: actor,
          notes: `تعديل اسم: ${username} → ${displayName}`,
          valueBefore: before?.display_name ?? null, valueAfter: displayName,
          extra: { targetUsername: username, newDisplayName: displayName, result: 'success' },
        });

        return json({ ok: true, status: logged ? 'success' : 'warning', logged, logError, message: 'تم تحديث الاسم' }, 200, request);
      }

      // §ADMIN::disableEmployee
      if (action === 'disable_employee') {
        const username = String(p('username')).trim();
        const actor    = String(p('actor')).trim() || null;
        if (!username) return json({ ok: false, error: 'username مطلوب' }, 400, request);

        const r = await env.DB.prepare('UPDATE employees SET is_active = 0 WHERE username = ?').bind(username).run();
        if (r.changes === 0) return json({ ok: false, error: 'المستخدم غير موجود' }, 404, request);

        const { logged, logError } = await logSafe(env.DB, {
          tool: TOOL_NAME, type: ADMIN_ACTIONS.DISABLE, employee: actor,
          notes: `إيقاف موظف: ${username}`,
          valueBefore: 'is_active=1', valueAfter: 'is_active=0',
          extra: { targetUsername: username, result: 'success' },
        });

        return json({ ok: true, status: logged ? 'success' : 'warning', logged, logError, message: `تم إيقاف ${username}` }, 200, request);
      }

      // §ADMIN::enableEmployee
      if (action === 'enable_employee') {
        const username = String(p('username')).trim();
        const actor    = String(p('actor')).trim() || null;
        if (!username) return json({ ok: false, error: 'username مطلوب' }, 400, request);

        const r = await env.DB.prepare('UPDATE employees SET is_active = 1 WHERE username = ?').bind(username).run();
        if (r.changes === 0) return json({ ok: false, error: 'المستخدم غير موجود' }, 404, request);

        const { logged, logError } = await logSafe(env.DB, {
          tool: TOOL_NAME, type: ADMIN_ACTIONS.ENABLE, employee: actor,
          notes: `تفعيل موظف: ${username}`,
          valueBefore: 'is_active=0', valueAfter: 'is_active=1',
          extra: { targetUsername: username, result: 'success' },
        });

        return json({ ok: true, status: logged ? 'success' : 'warning', logged, logError, message: `تم تفعيل ${username}` }, 200, request);
      }

      // §ADMIN::resetPin
      if (action === 'reset_pin') {
        const username = String(p('username')).trim();
        const actor    = String(p('actor')).trim() || null;
        if (!username) return json({ ok: false, error: 'username مطلوب' }, 400, request);

        const r = await env.DB.prepare('UPDATE employees SET pin = NULL WHERE username = ?').bind(username).run();
        if (r.changes === 0) return json({ ok: false, error: 'المستخدم غير موجود' }, 404, request);

        const { logged, logError } = await logSafe(env.DB, {
          tool: TOOL_NAME, type: ADMIN_ACTIONS.RESET_PIN, employee: actor,
          notes: `مسح PIN: ${username}`,
          extra: { targetUsername: username, result: 'success' },
        });

        return json({ ok: true, status: logged ? 'success' : 'warning', logged, logError, message: `تم مسح PIN لـ ${username}` }, 200, request);
      }

      // §ADMIN::deleteEmployee
      if (action === 'delete_employee') {
        const username = String(p('username')).trim();
        const actor    = String(p('actor')).trim() || null;
        if (!username) return json({ ok: false, error: 'username مطلوب' }, 400, request);

        // ⚠️ الحذف لا رجعة فيه — الاسم المعروض بيتقرا قبله عشان السجل يفضل مفهوم بعدين
        const before = await env.DB.prepare('SELECT display_name FROM employees WHERE username = ?').bind(username).first();
        const r = await env.DB.prepare('DELETE FROM employees WHERE username = ?').bind(username).run();
        if (r.changes === 0) return json({ ok: false, error: 'المستخدم غير موجود' }, 404, request);

        const { logged, logError } = await logSafe(env.DB, {
          tool: TOOL_NAME, type: ADMIN_ACTIONS.DELETE, employee: actor,
          notes: `حذف نهائي: ${username}${before?.display_name ? ` (${before.display_name})` : ''}`,
          extra: { targetUsername: username, targetDisplayName: before?.display_name ?? null, result: 'success' },
        });

        return json({ ok: true, status: logged ? 'success' : 'warning', logged, logError, message: `تم حذف ${username} نهائياً` }, 200, request);
      }

      // §ADMIN::grantAdmin
      if (action === 'grant_admin') {
        const username = String(p('username')).trim();
        const actor    = String(p('actor')).trim() || null;
        if (!username) return json({ ok: false, error: 'username مطلوب' }, 400, request);

        const r = await env.DB.prepare('UPDATE employees SET is_admin = 1 WHERE username = ?').bind(username).run();
        if (r.changes === 0) return json({ ok: false, error: 'المستخدم غير موجود' }, 404, request);

        const { logged, logError } = await logSafe(env.DB, {
          tool: TOOL_NAME, type: ADMIN_ACTIONS.GRANT_ADMIN, employee: actor,
          notes: `منح صلاحية إدارة: ${username}`,
          valueBefore: 'is_admin=0', valueAfter: 'is_admin=1',
          extra: { targetUsername: username, result: 'success' },
        });

        return json({ ok: true, status: logged ? 'success' : 'warning', logged, logError, message: `تم منح صلاحية الإدارة لـ ${username}` }, 200, request);
      }

      // §ADMIN::revokeAdmin
      if (action === 'revoke_admin') {
        const username = String(p('username')).trim();
        const actor    = String(p('actor')).trim() || null;
        if (!username) return json({ ok: false, error: 'username مطلوب' }, 400, request);

        // حماية: موظف مايقدرش يسحب صلاحيته من نفسه (تفادي قفل النفس بره الأداة)
        if (actor && actor === username) {
          return json({ ok: false, error: 'لا يمكنك سحب صلاحية الإدارة من نفسك — اطلب من مسؤول آخر' }, 400, request);
        }

        const r = await env.DB.prepare('UPDATE employees SET is_admin = 0 WHERE username = ?').bind(username).run();
        if (r.changes === 0) return json({ ok: false, error: 'المستخدم غير موجود' }, 404, request);

        const { logged, logError } = await logSafe(env.DB, {
          tool: TOOL_NAME, type: ADMIN_ACTIONS.REVOKE_ADMIN, employee: actor,
          notes: `سحب صلاحية إدارة: ${username}`,
          valueBefore: 'is_admin=1', valueAfter: 'is_admin=0',
          extra: { targetUsername: username, result: 'success' },
        });

        return json({ ok: true, status: logged ? 'success' : 'warning', logged, logError, message: `تم سحب صلاحية الإدارة من ${username}` }, 200, request);
      }

      // §ADMIN::getAccessLog — سجل الدخول والخروج من كل الأدوات (عبر كل الـ tools مش بس هذه)
      if (action === 'get_access_log') {
        const employee = url.searchParams.get('employee') || '';
        const tool     = url.searchParams.get('tool')     || '';
        const type     = url.searchParams.get('type')     || '';      // 'login' | 'logout' | '' = كلاهما
        const dateFrom = url.searchParams.get('date_from') || '';     // YYYY-MM-DD
        const dateTo   = url.searchParams.get('date_to')   || '';     // YYYY-MM-DD
        const limit    = Math.min(parseInt(url.searchParams.get('limit') || '300'), 1000);
        const offset   = Math.max(parseInt(url.searchParams.get('offset') || '0'), 0);

        let sql = `SELECT timestamp, tool, type, employee, notes
                   FROM logs WHERE type IN ('login','logout')`;
        const b = [];

        if (employee) { sql += ' AND employee = ?'; b.push(employee); }
        if (tool)     { sql += ' AND tool = ?';     b.push(tool); }
        if (type)     { sql += ' AND type = ?';     b.push(type); }
        if (dateFrom) { sql += ' AND date(timestamp) >= ?'; b.push(dateFrom); }
        if (dateTo)   { sql += ' AND date(timestamp) <= ?'; b.push(dateTo); }

        sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
        b.push(limit, offset);

        const res = await env.DB.prepare(sql).bind(...b).all();

        let countSql = `SELECT COUNT(*) as total FROM logs WHERE type IN ('login','logout')`;
        const cb = [];
        if (employee) { countSql += ' AND employee = ?'; cb.push(employee); }
        if (tool)     { countSql += ' AND tool = ?';     cb.push(tool); }
        if (type)     { countSql += ' AND type = ?';     cb.push(type); }
        if (dateFrom) { countSql += ' AND date(timestamp) >= ?'; cb.push(dateFrom); }
        if (dateTo)   { countSql += ' AND date(timestamp) <= ?'; cb.push(dateTo); }

        const countRes = await env.DB.prepare(countSql).bind(...cb).first();
        return json({ ok: true, entries: res.results, total: countRes?.total ?? 0 }, 200, request);
      }
      // ──────────────────────────────────────────────────────

      // ─── §LOG-ENDPOINTS — سجل الإجراءات الإدارية (audit) ───
      // get_logs / get_logs_count / get_logs_export القياسية —
      // بتستبعد login/logout تلقائياً وتعرض فقط add/update/disable/enable/reset_pin/delete
      if (action === 'get_logs') {
        const entries = await getLogs(env.DB, {
          tool:     url.searchParams.get('tool')     || TOOL_NAME,
          employee: url.searchParams.get('employee') || null,
          type:     url.searchParams.get('type')     || null,
          search:   url.searchParams.get('search')   || null,
          limit:    Math.min(parseInt(url.searchParams.get('limit') || '100'), 100),
          offset:   Math.max(parseInt(url.searchParams.get('offset') || '0'), 0),
        });
        return json({ ok: true, entries }, 200, request);
      }

      if (action === 'get_logs_count') {
        const total = await getLogsCount(env.DB, {
          tool:     url.searchParams.get('tool')     || TOOL_NAME,
          employee: url.searchParams.get('employee') || null,
          search:   url.searchParams.get('search')   || null,
        });
        return json({ ok: true, total }, 200, request);
      }

      if (action === 'get_logs_export') {
        const entries = await getLogsExport(env.DB, {
          tool:     url.searchParams.get('tool')     || TOOL_NAME,
          employee: url.searchParams.get('employee') || null,
          search:   url.searchParams.get('search')   || null,
        });
        return json({ ok: true, entries }, 200, request);
      }
      // ──────────────────────────────────────────────────────

      return json({ ok: false, error: 'Unknown action' }, 400, request);

    } catch (e) {
      return json({ ok: false, error: e.message }, 500, request);
    }
  },
};
