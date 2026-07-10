const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_PIN = process.env.GREEN_GRIN_ADMIN_PIN;

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-pin, x-employee-pin, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS"
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

async function activeEmployeeByPin(event) {
  const pin = event.headers["x-employee-pin"];
  if (!pin) return null;
  const rows = await supabase(`green_grin_employees?select=*&employee_pin=eq.${encodeURIComponent(pin)}&status=eq.Active&limit=1`);
  return rows?.[0] || null;
}

async function matchingCustomer(body) {
  const email = (body.email || "").toLowerCase().trim();
  const phone = (body.phone || "").trim();
  if (email) {
    const rows = await supabase(`green_grin_customers?select=*&email=eq.${encodeURIComponent(email)}&limit=1`);
    if (rows?.[0]) return rows[0];
  }
  if (phone) {
    const rows = await supabase(`green_grin_customers?select=*&phone=eq.${encodeURIComponent(phone)}&limit=1`);
    if (rows?.[0]) return rows[0];
  }
  return null;
}

async function syncCustomerPlan(customerUserId, job) {
  if (!customerUserId) return;
  await supabase(`green_grin_customers?id=eq.${encodeURIComponent(customerUserId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      billing_plan: job.service_type || null,
      billing_status: job.status || "Scheduled",
      monthly_price: job.monthly_price || null,
      annual_price: job.annual_price || null,
      phone: job.phone || "",
      email: job.email || "",
      full_name: job.customer_name || ""
    })
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});

  const setupError = requireSetup();
  if (setupError) return json(500, { error: setupError });

  try {
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const adminCreate = Boolean(event.headers["x-admin-pin"]);
      const adminError = adminCreate ? requireAdmin(event) : null;
      if (adminError) return json(401, { error: adminError });
      const user = adminCreate ? null : await optionalUser(event);
      const customer = adminCreate ? await matchingCustomer(body) : null;
      const scheduleStartDate = adminCreate ? body.schedule_start_date || body.scheduled_date || null : null;
      const scheduleEndDate = adminCreate ? body.schedule_end_date || null : null;
      const scheduledDate = adminCreate ? scheduleStartDate : null;
      const job = {
        customer_user_id: customer?.id || user?.id || null,
        customer_name: body.customer_name || "",
        phone: body.phone || "",
        email: body.email || user?.email || "",
        address: body.address || "",
        service_type: body.service_type || "Service request",
        preferred_date: body.preferred_date || null,
        scheduled_date: scheduledDate,
        recurring_weekly: Boolean(adminCreate && scheduleStartDate && scheduleEndDate),
        schedule_start_date: scheduleStartDate,
        schedule_end_date: scheduleEndDate,
        cleanup_reminder_time: body.cleanup_reminder_time || "08:00",
        annual_price: body.annual_price || null,
        monthly_price: body.monthly_price || null,
        notes: body.notes || "",
        status: adminCreate ? body.status || (scheduledDate ? "Scheduled" : "New") : "New"
      };

      if (!job.customer_name || !job.phone) {
        return json(400, { error: "Name and phone are required." });
      }

      const created = await supabase("green_grin_jobs", {
        method: "POST",
        body: JSON.stringify(job)
      });
      await syncCustomerPlan(created?.[0]?.customer_user_id, created?.[0] || job);
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
        const employee = await activeEmployee(event) || await activeEmployeeByPin(event);
        if (!employee) return json(401, { error: "Employee access was not found. Sign in or use the PIN the owner set for you." });
        const jobs = await supabase("green_grin_jobs?select=id,customer_name,address,service_type,scheduled_date,recurring_weekly,schedule_start_date,schedule_end_date,status,notes&status=neq.Completed&order=scheduled_date.asc.nullslast&limit=80");
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
        scheduled_date: body.schedule_start_date || body.scheduled_date || null,
        recurring_weekly: Boolean(body.schedule_start_date && body.schedule_end_date),
        schedule_start_date: body.schedule_start_date || body.scheduled_date || null,
        schedule_end_date: body.schedule_end_date || null,
        cleanup_reminder_time: body.cleanup_reminder_time || "08:00",
        annual_price: body.annual_price || null,
        monthly_price: body.monthly_price || null
      };
      const id = encodeURIComponent(body.id);
      const updated = await supabase(`green_grin_jobs?id=eq.${id}`, {
        method: "PATCH",
        body: JSON.stringify(update)
      });
      if (updated?.[0]?.customer_user_id) {
        await syncCustomerPlan(updated[0].customer_user_id, updated[0]);
      }
      return json(200, { job: updated?.[0] });
    }

    if (event.httpMethod === "DELETE") {
      const adminError = requireAdmin(event);
      if (adminError) return json(401, { error: adminError });
      const body = JSON.parse(event.body || "{}");
      if (!body.id) return json(400, { error: "Job id is required." });
      const id = encodeURIComponent(body.id);
      await supabase(`green_grin_message_log?job_id=eq.${id}`, { method: "DELETE" });
      await supabase(`green_grin_jobs?id=eq.${id}`, { method: "DELETE" });
      return json(200, { ok: true });
    }

    return json(405, { error: "Method not allowed." });
  } catch (error) {
    return json(500, { error: error.message });
  }
};
