const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_PIN = process.env.GREEN_GRIN_ADMIN_PIN;

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-pin, x-employee-pin",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function json(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

function requireSetup() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return "Supabase is not configured yet.";
  return null;
}

function requireAdmin(event) {
  if (!ADMIN_PIN) return "Admin PIN is not configured yet. Add GREEN_GRIN_ADMIN_PIN in Netlify.";
  if (event.headers["x-admin-pin"] !== ADMIN_PIN) return "Wrong admin PIN.";
  return null;
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

async function optionalUser(event) {
  const auth = event.headers.authorization || event.headers.Authorization || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token || !SUPABASE_ANON_KEY) return null;

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`
    }
  });
  const user = await response.json().catch(() => null);
  return response.ok && user?.id ? user : null;
}

async function activeEmployee(event) {
  const user = await optionalUser(event);
  if (!user) return null;
  const email = encodeURIComponent((user.email || "").toLowerCase());
  let rows = await supabase(`green_grin_employees?select=*&user_id=eq.${encodeURIComponent(user.id)}&status=eq.Active&limit=1`);
  if (!rows?.length && email) {
    rows = await supabase(`green_grin_employees?select=*&email=eq.${email}&status=eq.Active&limit=1`);
    if (rows?.[0] && !rows[0].user_id) {
      rows = await supabase(`green_grin_employees?id=eq.${encodeURIComponent(rows[0].id)}`, {
        method: "PATCH",
        body: JSON.stringify({ user_id: user.id })
      });
    }
  }
  return rows?.[0] || null;
}

async function activeEmployeeByPin(event) {
  const pin = event.headers["x-employee-pin"];
  if (!pin) return null;
  const rows = await supabase(`green_grin_employees?select=*&employee_pin=eq.${encodeURIComponent(pin)}&status=eq.Active&limit=1`);
  return rows?.[0] || null;
}

function minutesBetween(start, end) {
  const minutes = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  return Number.isFinite(minutes) ? Math.max(0, minutes) : 0;
}

function moneyForMinutes(minutes, hourlyRate) {
  const rate = Number(hourlyRate) || 0;
  return Math.round((minutes / 60) * rate * 100) / 100;
}

function rangeStart(unit, count) {
  const now = new Date();
  const start = new Date(now);
  if (unit === "months") start.setMonth(start.getMonth() - count);
  else if (unit === "weeks") start.setDate(start.getDate() - count * 7);
  else start.setDate(start.getDate() - count);
  return start.toISOString();
}

function cleanPeriod(unitValue, countValue) {
  const unit = ["days", "weeks", "months"].includes(unitValue) ? unitValue : "weeks";
  const count = Math.max(1, Math.min(Number(countValue || 1), 60));
  return { unit, count };
}

function summarize(entries, rates = new Map()) {
  const employees = new Map();
  let totalMinutes = 0;
  let totalPay = 0;
  for (const entry of entries || []) {
    const minutes = entry.total_minutes ?? (entry.clock_out_at ? minutesBetween(entry.clock_in_at, entry.clock_out_at) : 0);
    const hourlyRate = Number(entry.hourly_rate ?? rates.get(entry.employee_id) ?? 0);
    const grossPay = Number(entry.gross_pay ?? moneyForMinutes(minutes, hourlyRate));
    totalMinutes += minutes;
    totalPay += grossPay;
    const key = entry.employee_id || entry.employee_name || "Unknown";
    const current = employees.get(key) || {
      employee_id: entry.employee_id,
      employee_code: entry.employee_code || "",
      employee_name: entry.employee_name || "Employee",
      total_minutes: 0,
      total_pay: 0,
      hourly_rate: hourlyRate,
      entries: 0
    };
    current.total_minutes += minutes;
    current.total_pay += grossPay;
    if (!current.hourly_rate && hourlyRate) current.hourly_rate = hourlyRate;
    current.entries += 1;
    employees.set(key, current);
  }
  return {
    total_minutes: totalMinutes,
    total_hours: Math.round((totalMinutes / 60) * 100) / 100,
    total_pay: Math.round(totalPay * 100) / 100,
    employees: [...employees.values()].map((employee) => ({
      ...employee,
      total_hours: Math.round((employee.total_minutes / 60) * 100) / 100,
      total_pay: Math.round(employee.total_pay * 100) / 100
    }))
  };
}

async function employeeStatus(employee, unit = "weeks", count = 1) {
  const employeeId = encodeURIComponent(employee.id);
  const open = await supabase(`green_grin_time_entries?select=*&employee_id=eq.${employeeId}&clock_out_at=is.null&order=clock_in_at.desc&limit=1`);
  const recent = await supabase(`green_grin_time_entries?select=*&employee_id=eq.${employeeId}&order=clock_in_at.desc&limit=12`);
  const period = await supabase(`green_grin_time_entries?select=*&employee_id=eq.${employeeId}&clock_in_at=gte.${encodeURIComponent(rangeStart(unit, count))}&order=clock_in_at.desc&limit=500`);
  const rates = new Map([[employee.id, Number(employee.hourly_rate) || 0]]);
  return { open: open?.[0] || null, recent, unit, count, summary: summarize(period, rates) };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  const setupError = requireSetup();
  if (setupError) return json(500, { error: setupError });

  try {
    if (event.httpMethod === "GET") {
      const params = new URLSearchParams(event.rawQuery || "");

      if (params.get("admin") === "1") {
        const adminError = requireAdmin(event);
        if (adminError) return json(401, { error: adminError });
        const { unit, count } = cleanPeriod(params.get("unit"), params.get("count"));
        const employeeId = params.get("employee_id") || "";
        const employees = await supabase("green_grin_employees?select=id,hourly_rate&limit=500");
        const rates = new Map((employees || []).map((employee) => [employee.id, Number(employee.hourly_rate) || 0]));
        const filters = [`clock_in_at=gte.${encodeURIComponent(rangeStart(unit, count))}`];
        if (employeeId) filters.push(`employee_id=eq.${encodeURIComponent(employeeId)}`);
        const entries = await supabase(`green_grin_time_entries?select=*&${filters.join("&")}&order=clock_in_at.desc&limit=1000`);
        return json(200, { unit, count, entries, summary: summarize(entries, rates) });
      }

      const employee = await activeEmployee(event) || await activeEmployeeByPin(event);
      if (!employee) return json(401, { error: "Employee access was not found. Sign in or use the PIN the owner set for you." });
      const { unit, count } = cleanPeriod(params.get("unit"), params.get("count"));
      return json(200, { employee, ...(await employeeStatus(employee, unit, count)) });
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const employee = await activeEmployee(event) || await activeEmployeeByPin(event);
      if (!employee) return json(401, { error: "Employee access was not found. Sign in or use the PIN the owner set for you." });
      const status = await employeeStatus(employee);

      if (body.action === "clock-in") {
        if (status.open) return json(409, { error: "You are already clocked in." });
        const now = new Date().toISOString();
        const rows = await supabase("green_grin_time_entries", {
          method: "POST",
          body: JSON.stringify({
            employee_id: employee.id,
            employee_code: employee.employee_code || "",
            employee_name: employee.full_name || employee.email || "Employee",
            clock_in_at: now,
            hourly_rate: Number(employee.hourly_rate) || 0,
            notes: body.notes || ""
          })
        });
        const { unit, count } = cleanPeriod(body.unit, body.count);
        return json(200, { entry: rows?.[0] || null, ...(await employeeStatus(employee, unit, count)) });
      }

      if (body.action === "clock-out") {
        if (!status.open) return json(400, { error: "You are not clocked in." });
        const now = new Date().toISOString();
        const totalMinutes = minutesBetween(status.open.clock_in_at, now);
        const hourlyRate = Number(status.open.hourly_rate ?? employee.hourly_rate ?? 0);
        const rows = await supabase(`green_grin_time_entries?id=eq.${encodeURIComponent(status.open.id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            clock_out_at: now,
            total_minutes: totalMinutes,
            hourly_rate: hourlyRate,
            gross_pay: moneyForMinutes(totalMinutes, hourlyRate),
            notes: body.notes ?? status.open.notes ?? ""
          })
        });
        const { unit, count } = cleanPeriod(body.unit, body.count);
        return json(200, { entry: rows?.[0] || null, ...(await employeeStatus(employee, unit, count)) });
      }

      return json(400, { error: "Choose clock-in or clock-out." });
    }

    return json(405, { error: "Method not allowed." });
  } catch (error) {
    return json(500, { error: error.message });
  }
};
