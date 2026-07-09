const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
const TIME_ZONE = process.env.GREEN_GRIN_TIMEZONE || "America/Denver";

exports.config = {
  schedule: "0 13 * * *"
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

function requireSetup() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return "Supabase is not configured yet.";
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) return "Twilio is not configured yet.";
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

exports.handler = async () => {
  const setupError = requireSetup();
  if (setupError) {
    return { statusCode: 500, body: setupError };
  }

  const today = localDate();
  const start = encodeURIComponent(`${today}T00:00:00`);
  const end = encodeURIComponent(`${today}T23:59:59`);
  const jobs = await supabase(
    `green_grin_jobs?select=*&scheduled_date=gte.${start}&scheduled_date=lte.${end}&status=neq.Completed&limit=100`
  );

  let sent = 0;
  let skipped = 0;

  for (const job of jobs || []) {
    if (!job.phone) {
      skipped += 1;
      continue;
    }

    if (job.last_cleanup_reminder_sent_at && localDate(new Date(job.last_cleanup_reminder_sent_at)) === today) {
      skipped += 1;
      continue;
    }

    const message = cleanupMessage(job);
    const sms = await sendSms(job.phone, message);

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
        twilio_sid: sms.sid || null
      })
    });

    sent += 1;
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ date: today, sent, skipped })
  };
};
