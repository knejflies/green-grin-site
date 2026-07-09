const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_PIN = process.env.GREEN_GRIN_ADMIN_PIN;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;

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
  return null;
}

function requireTwilioSetup() {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) return "Twilio is not configured yet.";
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

async function sendSms(to, body) {
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
  const params = new URLSearchParams({
    To: to,
    From: TWILIO_FROM_NUMBER,
    Body: body
  });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || "Twilio SMS failed.");
  return data;
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
    const twilioError = requireTwilioSetup();
    if (twilioError) return json(500, { error: twilioError });

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
    const sms = await sendSms(job.phone, message);
    const status = body.template === "completed" ? "Completed" : job.status;

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
        twilio_sid: sms.sid || null
      })
    });

    return json(200, { ok: true, sid: sms.sid });
  } catch (error) {
    return json(500, { error: error.message });
  }
};
