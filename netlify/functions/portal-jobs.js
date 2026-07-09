const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_PIN = process.env.GREEN_GRIN_ADMIN_PIN;
const EMPLOYEE_PIN = process.env.GREEN_GRIN_EMPLOYEE_PIN;

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-pin, x-employee-pin, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS"
};

function json(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

function requireSetup() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return "Supabase is not configured yet. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Netlify.";
  }
  return null;
}

function requireAdmin(event) {
  if (!ADMIN_PIN) return "Admin PIN is not configured yet. Add GREEN_GRIN_ADMIN_PIN in Netlify.";
  if (event.headers["x-admin-pin"] !== ADMIN_PIN) return "Wrong admin PIN.";
  return null;
}

function requireEmployee(event) {
  if (!EMPLOYEE_PIN) return "Employee PIN is not configured yet. Add GREEN_GRIN_EMPLOYEE_PIN in Netlify.";
  if (event.headers["x-employee-pin"] !== EMPLOYEE_PIN) return "Wrong employee PIN.";
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
  if (!response.ok) {
    throw new Error(data?.message || "Supabase request failed.");
  }
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

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});

  const setupError = requireSetup();
  if (setupError) return json(500, { error: setupError });

  try {
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const user = await optionalUser(event);
      const job = {
        customer_user_id: user?.id || null,
        customer_name: body.customer_name || "",
        phone: body.phone || "",
        email: body.email || user?.email || "",
        address: body.address || "",
        service_type: body.service_type || "Service request",
        preferred_date: body.preferred_date || null,
        notes: body.notes || "",
        status: "New"
      };

      if (!job.customer_name || !job.phone) {
        return json(400, { error: "Name and phone are required." });
      }

      const created = await supabase("green_grin_jobs", {
        method: "POST",
        body: JSON.stringify(job)
      });
      return json(200, { job: created?.[0] });
    }

    if (event.httpMethod === "GET") {
      const params = new URLSearchParams(event.rawQuery || "");
      if (params.get("admin") === "1") {
        const adminError = requireAdmin(event);
        if (adminError) return json(401, { error: adminError });
        const jobs = await supabase("green_grin_jobs?select=*&order=created_at.desc&limit=80");
        return json(200, { jobs });
      }

      if (params.get("employee") === "1") {
        const employee = await activeEmployee(event);
        const employeeError = employee ? null : requireEmployee(event);
        if (employeeError) return json(401, { error: employeeError });
        const jobs = await supabase("green_grin_jobs?select=id,customer_name,address,service_type,scheduled_date,status,notes&status=neq.Completed&order=scheduled_date.asc.nullslast&limit=80");
        return json(200, { jobs });
      }

      const phone = params.get("phone");
      if (!phone) return json(400, { error: "Phone is required." });
      const encodedPhone = encodeURIComponent(phone);
      const jobs = await supabase(`green_grin_jobs?select=*&phone=eq.${encodedPhone}&order=created_at.desc&limit=10`);
      return json(200, { jobs });
    }

    if (event.httpMethod === "PATCH") {
      const adminError = requireAdmin(event);
      if (adminError) return json(401, { error: adminError });
      const body = JSON.parse(event.body || "{}");
      if (!body.id) return json(400, { error: "Job id is required." });

      const update = {
        status: body.status || "Scheduled",
        scheduled_date: body.scheduled_date || null
      };
      const id = encodeURIComponent(body.id);
      const updated = await supabase(`green_grin_jobs?id=eq.${id}`, {
        method: "PATCH",
        body: JSON.stringify(update)
      });
      return json(200, { job: updated?.[0] });
    }

    return json(405, { error: "Method not allowed." });
  } catch (error) {
    return json(500, { error: error.message });
  }
};
