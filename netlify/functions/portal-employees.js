const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_PIN = process.env.GREEN_GRIN_ADMIN_PIN;

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-pin",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS"
};

function json(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

function requireSetup() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return "Supabase employee accounts are not fully configured yet.";
  }
  return null;
}

function requireAdmin(event) {
  if (!ADMIN_PIN) return "Admin PIN is not configured yet. Add GREEN_GRIN_ADMIN_PIN in Netlify.";
  if (event.headers["x-admin-pin"] !== ADMIN_PIN) return "Wrong admin PIN.";
  return null;
}

async function verifyUser(event) {
  const auth = event.headers.authorization || event.headers.Authorization || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Please sign in again.");
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`
    }
  });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id) throw new Error("Your sign-in expired. Please sign in again.");
  return user;
}

async function supabase(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || "Supabase request failed.");
  return data;
}

function employeeCodeNumber(code) {
  const match = String(code || "").match(/GGE-(\d{4})$/);
  return match ? Number(match[1]) : 0;
}

async function nextEmployeeCode() {
  const rows = await supabase("green_grin_employees?select=employee_code&employee_code=not.is.null&order=employee_code.desc&limit=1");
  let counters = [];
  try {
    counters = await supabase("green_grin_counters?select=*&name=eq.employee_code&limit=1");
  } catch (_error) {
    counters = [];
  }
  const current = counters?.[0]?.last_value || 0;
  const next = Math.max(current, employeeCodeNumber(rows?.[0]?.employee_code)) + 1;
  try {
    await supabase("green_grin_counters?on_conflict=name", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ name: "employee_code", last_value: next })
    });
  } catch (_error) {
    // The SQL setup creates this counter table. If it is missing, still issue a code from the current max.
  }
  return `GGE-${String(next).padStart(4, "0")}`;
}

async function ensureEmployeeCode(employee) {
  if (!employee || employee.employee_code) return employee || null;
  const employeeCode = await nextEmployeeCode();
  const rows = await supabase(`green_grin_employees?id=eq.${encodeURIComponent(employee.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ employee_code: employeeCode })
  });
  return rows?.[0] || { ...employee, employee_code: employeeCode };
}

async function ensureEmployeeCodes(employees) {
  const fixed = [];
  for (const employee of employees || []) {
    fixed.push(await ensureEmployeeCode(employee));
  }
  return fixed;
}

async function employeeForUser(user) {
  const email = encodeURIComponent((user.email || "").toLowerCase());
  let rows = await supabase(`green_grin_employees?select=*&user_id=eq.${encodeURIComponent(user.id)}&limit=1`);
  if (!rows?.length && email) {
    rows = await supabase(`green_grin_employees?select=*&email=eq.${email}&limit=1`);
    if (rows?.[0] && !rows[0].user_id) {
      rows = await supabase(`green_grin_employees?id=eq.${encodeURIComponent(rows[0].id)}`, {
        method: "PATCH",
        body: JSON.stringify({ user_id: user.id })
      });
    }
  }
  return await ensureEmployeeCode(rows?.[0]);
}

async function deleteAuthUser(userId) {
  if (!userId) return false;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  return response.ok;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  const setupError = requireSetup();
  if (setupError) return json(500, { error: setupError });

  try {
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const email = (body.email || "").toLowerCase();
      const existing = email
        ? await supabase(`green_grin_employees?select=*&email=eq.${encodeURIComponent(email)}&limit=1`)
        : [];
      const employee = {
        employee_code: existing?.[0]?.employee_code || await nextEmployeeCode(),
        full_name: body.full_name || "",
        email,
        phone: body.phone || "",
        status: "Pending"
      };
      if (body.requested_pin) employee.employee_pin = body.requested_pin;
      if (!employee.full_name || !employee.email) {
        return json(400, { error: "Employee name and email are required." });
      }
      const rows = await supabase("green_grin_employees?on_conflict=email", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(employee)
      });
      return json(200, { employee: rows?.[0] });
    }

    if (event.httpMethod === "GET") {
      const params = new URLSearchParams(event.rawQuery || "");
      if (params.get("admin") === "1") {
        const adminError = requireAdmin(event);
        if (adminError) return json(401, { error: adminError });
        const employees = await ensureEmployeeCodes(await supabase("green_grin_employees?select=*&order=created_at.desc&limit=100"));
        return json(200, { employees });
      }

      const user = await verifyUser(event);
      const employee = await employeeForUser(user);
      if (!employee) return json(404, { error: "No employee access request found for this email." });
      if (employee.status !== "Active") return json(403, { error: `Employee access is ${employee.status.toLowerCase()}.` });
      return json(200, { employee });
    }

    if (event.httpMethod === "PATCH") {
      const adminError = requireAdmin(event);
      if (adminError) return json(401, { error: adminError });
      const body = JSON.parse(event.body || "{}");
      if (!body.id) return json(400, { error: "Employee id is required." });
      const update = {};
      if (body.status) update.status = body.status;
      if (Object.prototype.hasOwnProperty.call(body, "employee_pin")) update.employee_pin = body.employee_pin || null;
      if (Object.prototype.hasOwnProperty.call(body, "hourly_rate")) {
        const hourlyRate = Number(body.hourly_rate);
        update.hourly_rate = Number.isFinite(hourlyRate) ? hourlyRate : null;
      }
      if (!Object.keys(update).length) return json(400, { error: "Nothing to update." });
      const rows = await supabase(`green_grin_employees?id=eq.${encodeURIComponent(body.id)}`, {
        method: "PATCH",
        body: JSON.stringify(update)
      });
      return json(200, { employee: rows?.[0] });
    }

    if (event.httpMethod === "DELETE") {
      const adminError = requireAdmin(event);
      if (adminError) return json(401, { error: adminError });
      const body = JSON.parse(event.body || "{}");
      if (!body.id) return json(400, { error: "Employee id is required." });
      const rows = await supabase(`green_grin_employees?select=*&id=eq.${encodeURIComponent(body.id)}&limit=1`);
      const employee = rows?.[0] || null;
      await supabase(`green_grin_employees?id=eq.${encodeURIComponent(body.id)}`, { method: "DELETE" });
      const authDeleted = await deleteAuthUser(employee?.user_id);
      return json(200, { ok: true, authDeleted });
    }

    return json(405, { error: "Method not allowed." });
  } catch (error) {
    if (error.message.includes("employee_pin") && error.message.includes("schema cache")) {
      return json(500, { error: "Employee PIN column is not ready in Supabase yet. Run portal-setup.sql again, then wait about 30 seconds and try again." });
    }
    return json(500, { error: error.message });
  }
};
