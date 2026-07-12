const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TIME_ZONE = process.env.GREEN_GRIN_TIMEZONE || "America/Denver";
const { pushReady, sendPushToTarget } = require("./push-helper");

exports.config = {
  schedule: "*/15 * * * *"
};

function localDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function dateOnly(value) {
  return String(value || "").split("T")[0];
}

function localWeekday(value) {
  const [year, month, day] = dateOnly(value).split("-").map(Number);
  return new Date(year, month - 1, day).getDay();
}

function isServiceToday(job, today) {
  if (job.recurring_weekly && job.schedule_start_date && job.schedule_end_date) {
    const start = dateOnly(job.schedule_start_date);
    const end = dateOnly(job.schedule_end_date);
    return today >= start && today <= end && localWeekday(today) === localWeekday(start);
  }
  return dateOnly(job.scheduled_date) === today;
}

function localTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.hour}:${value.minute}`;
}

function requireSetup() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return "Supabase is not configured yet.";
  if (!pushReady()) return "App notification keys are not configured yet.";
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

function cleanupMessage(job) {
  const name = job.customer_name ? ` ${job.customer_name}` : "";
  const service = job.service_type || "yard service";
  return `Hi${name}, Green Grin is scheduled for your ${service} today. Please pick up toys, hoses, pet waste, and yard objects before we arrive.`;
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

exports.handler = async () => {
  const setupError = requireSetup();
  if (setupError) {
    return { statusCode: 500, body: setupError };
  }

  const today = localDate();
  const nowTime = localTime();
  const jobs = await supabase("green_grin_jobs?select=*&status=neq.Completed&limit=200");

  let sent = 0;
  let skipped = 0;

  for (const job of jobs || []) {
    if (!isServiceToday(job, today)) {
      skipped += 1;
      continue;
    }

    const reminderTime = String(job.cleanup_reminder_time || "08:00").slice(0, 5);
    if (reminderTime > nowTime) {
      skipped += 1;
      continue;
    }

    if (job.last_cleanup_reminder_sent_at && localDate(new Date(job.last_cleanup_reminder_sent_at)) === today) {
      skipped += 1;
      continue;
    }

    const message = cleanupMessage(job);
    const push = await sendPushToTarget(supabase, await customerPushTarget(job), {
      title: "Yard cleanup reminder",
      body: message,
      url: "/portal/",
      tag: `green-grin-${job.id}-morning-reminder-${today}`
    });

    await supabase(`green_grin_jobs?id=eq.${encodeURIComponent(job.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        last_message_template: "objects",
        last_message_sent_at: new Date().toISOString(),
        last_cleanup_reminder_sent_at: new Date().toISOString()
      })
    });

    await supabase("green_grin_message_log", {
      method: "POST",
      body: JSON.stringify({
        job_id: job.id,
        phone: job.phone,
        template: "objects",
        message,
        actor_type: "System",
        actor_name: push.sent ? `Morning app reminder ${reminderTime}` : `Morning app reminder attempted ${reminderTime}`,
        twilio_sid: null
      })
    });

    sent += 1;
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ date: today, time: nowTime, sent, skipped })
  };
};
