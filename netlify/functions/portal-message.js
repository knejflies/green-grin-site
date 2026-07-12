const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_PIN = process.env.GREEN_GRIN_ADMIN_PIN;
const { pushReady, sendPushToTarget } = require("./push-helper");

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-pin, x-employee-pin, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function json(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
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

async function employeeAccountForEvent(event) {
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

async function employeePinForEvent(event) {
  const pin = event.headers["x-employee-pin"];
  if (!pin) return null;
  const rows = await supabase(`green_grin_employees?select=*&employee_pin=eq.${encodeURIComponent(pin)}&status=eq.Active&limit=1`);
  return rows?.[0] || null;
}

async function employeeDoneActor(event, template) {
  if (template !== "completed") return null;
  return await employeeAccountForEvent(event) || await employeePinForEvent(event);
}

function requireSupabaseSetup() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return "Supabase is not configured yet.";
  if (!pushReady()) return "App notification keys are not configured yet.";
  return null;
}

function messageFor(template, job) {
  const name = job.customer_name ? ` ${job.customer_name}` : "";
  const service = job.service_type || "yard service";
  if (template === "objects") {
    return `Hi${name}, Green Grin is scheduled for your ${service}. Please pick up toys, hoses, pet waste, and yard objects so we can work safely and leave a clean finish.`;
  }
  if (template === "completed") {
    return `Hi${name}, Green Grin finished your yard today. Thanks for choosing us.`;
  }
  return `Hi${name}, Green Grin has an update about your ${service}.`;
}

function pushTitle(template) {
  if (template === "objects") return "Yard cleanup reminder";
  if (template === "completed") return "Service completed";
  return "Green Grin update";
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

async function customerPushTarget(job) {
  const target = {
    customer_user_id: job.customer_user_id || null,
    customer_code: job.customer_code || "",
    email: job.email || ""
  };
  const filters = [];
  if (job.customer_user_id) filters.push(`id.eq.${encodeURIComponent(job.customer_user_id)}`);
  if (job.customer_code) filters.push(`customer_code.eq.${encodeURIComponent(job.customer_code)}`);
  if (job.email) filters.push(`email.eq.${encodeURIComponent(String(job.email).toLowerCase())}`);
  const rawPhone = String(job.phone || "").trim();
  const digitsPhone = normalizePhone(rawPhone);
  if (rawPhone) filters.push(`phone.eq.${encodeURIComponent(rawPhone)}`);
  if (digitsPhone && digitsPhone !== rawPhone) filters.push(`phone.eq.${encodeURIComponent(digitsPhone)}`);

  if (filters.length) {
    const rows = await supabase(`green_grin_customers?select=id,customer_code,email,phone&or=(${filters.join(",")})&limit=5`).catch(() => []);
    const customer = rows?.find((row) => row.id === job.customer_user_id)
      || rows?.find((row) => row.customer_code && row.customer_code === job.customer_code)
      || rows?.find((row) => row.email && String(row.email).toLowerCase() === String(job.email || "").toLowerCase())
      || rows?.find((row) => normalizePhone(row.phone) && normalizePhone(row.phone) === digitsPhone)
      || rows?.[0];
    if (customer) {
      target.customer_user_id = target.customer_user_id || customer.id || null;
      target.customer_code = target.customer_code || customer.customer_code || "";
      target.email = target.email || customer.email || "";
    }
  }

  return target;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});

  const setupError = requireSupabaseSetup();
  if (setupError) return json(500, { error: setupError });

  try {
    if (event.httpMethod === "GET") {
      const params = new URLSearchParams(event.rawQuery || "");
      if (params.get("admin") !== "1") return json(400, { error: "Admin log view is required." });
      const adminError = requireAdmin(event);
      if (adminError) return json(401, { error: adminError });
      const logs = await supabase("green_grin_message_log?select=*,green_grin_jobs(customer_name,address,service_type)&order=created_at.desc&limit=80");
      return json(200, { logs });
    }

    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });

    const body = JSON.parse(event.body || "{}");
    if (!body.id || !body.template) return json(400, { error: "Job id and template are required." });
    const employeeActor = await employeeDoneActor(event, body.template);
    const adminError = employeeActor ? null : requireAdmin(event);
    if (adminError) return json(401, { error: adminError });

    const id = encodeURIComponent(body.id);
    const jobs = await supabase(`green_grin_jobs?select=*&id=eq.${id}&limit=1`);
    const job = jobs?.[0];
    if (!job) return json(404, { error: "Job not found." });
    if (body.template === "arriving") return json(400, { error: "On-the-way messages are turned off." });

    const message = messageFor(body.template, job);
    const status = body.template === "completed" && !job.recurring_weekly ? "Completed" : job.status;
    const notificationTag = `green-grin-${job.id}-${body.template}-${Date.now()}`;
    const customerPush = await sendPushToTarget(supabase, await customerPushTarget(job), {
      title: pushTitle(body.template),
      body: message,
      url: "/portal/",
      tag: notificationTag
    });
    let ownerPush = null;
    if (body.template === "completed") {
      ownerPush = await sendPushToTarget(supabase, { owner_type: "admin" }, {
        title: "Job marked done",
        body: `${employeeActor ? employeeActor.full_name || employeeActor.email || "Employee" : "Owner"} marked ${job.customer_name || "a customer"} done.`,
        url: "/admin/",
        tag: `green-grin-admin-${job.id}-done-${Date.now()}`
      });
    }

    await supabase(`green_grin_jobs?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status,
        last_message_template: body.template,
        last_message_sent_at: new Date().toISOString()
      })
    });

    await supabase("green_grin_message_log", {
      method: "POST",
      body: JSON.stringify({
        job_id: job.id,
        phone: job.phone,
        template: body.template,
        message,
        actor_type: employeeActor ? "Employee" : "Owner",
        actor_name: employeeActor ? employeeActor.full_name || employeeActor.email : "Owner",
        actor_employee_id: employeeActor?.id || null,
        twilio_sid: null
      })
    });

    return json(200, {
      ok: true,
      push: ownerPush ? { customer: customerPush, owner: ownerPush } : customerPush
    });
  } catch (error) {
    return json(500, { error: error.message });
  }
};
