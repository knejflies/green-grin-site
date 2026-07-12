let webpush = null;

try {
  webpush = require("web-push");
} catch (_error) {
  webpush = null;
}

const VAPID_PUBLIC_KEY = process.env.GREEN_GRIN_VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.GREEN_GRIN_VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.GREEN_GRIN_VAPID_SUBJECT || "mailto:notifications@greengrinlawns.com";

let configured = false;

function pushReady() {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

function configureWebPush() {
  if (!webpush || configured || !pushReady()) return;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
}

function pushSubscription(row) {
  return {
    endpoint: row.endpoint,
    keys: {
      p256dh: row.p256dh,
      auth: row.auth
    }
  };
}

async function sendWebPush(subscription, payload) {
  if (!pushReady()) {
    return { ok: false, skipped: true, status: 0, reason: "Notification keys are not configured." };
  }
  if (!webpush) {
    return { ok: false, skipped: true, status: 0, reason: "Push sender package is not installed yet. Redeploy Netlify after uploading package.json." };
  }

  configureWebPush();

  try {
    const response = await webpush.sendNotification(pushSubscription(subscription), JSON.stringify(payload), {
      TTL: 86400,
      urgency: "normal"
    });
    return { ok: true, status: response?.statusCode || 201 };
  } catch (error) {
    return {
      ok: false,
      status: error.statusCode || error.status || 0,
      reason: String(error.body || error.message || "Push service rejected the notification.").slice(0, 240)
    };
  }
}

async function subscriptionRows(supabase, target = {}) {
  const paths = [];
  const base = "green_grin_push_subscriptions?select=*&active=eq.true";
  if (target.customer_user_id) paths.push(`${base}&customer_user_id=eq.${encodeURIComponent(target.customer_user_id)}`);
  if (target.customer_code) paths.push(`${base}&customer_code=eq.${encodeURIComponent(target.customer_code)}`);
  if (target.email) paths.push(`${base}&owner_email=eq.${encodeURIComponent(String(target.email).toLowerCase())}`);
  if (target.employee_id) paths.push(`${base}&employee_id=eq.${encodeURIComponent(target.employee_id)}`);
  if (target.owner_type) paths.push(`${base}&owner_type=eq.${encodeURIComponent(target.owner_type)}`);

  const seen = new Map();
  for (const path of paths) {
    const rows = await supabase(path).catch(() => []);
    for (const row of rows || []) {
      if (row.endpoint) seen.set(row.endpoint, row);
    }
  }
  return [...seen.values()];
}

async function markSubscriptionInactive(supabase, endpoint) {
  await supabase(`green_grin_push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
    method: "PATCH",
    body: JSON.stringify({ active: false, updated_at: new Date().toISOString() })
  }).catch(() => null);
}

async function sendRows(supabase, rows, payload) {
  let sent = 0;
  let failed = 0;
  const errors = [];

  for (const row of rows) {
    const result = await sendWebPush(row, payload);
    if (result.ok) {
      sent += 1;
    } else {
      failed += 1;
      if (errors.length < 3) errors.push({ status: result.status, reason: result.reason || "Push failed." });
      if (result.status === 404 || result.status === 410) await markSubscriptionInactive(supabase, row.endpoint);
    }
  }

  return { enabled: pushReady(), sent, failed, total: rows.length, errors };
}

async function sendPushToTarget(supabase, target, payload) {
  if (!pushReady()) return { enabled: false, sent: 0, failed: 0, total: 0, errors: [] };
  const rows = await subscriptionRows(supabase, target);
  return await sendRows(supabase, rows, payload);
}

async function sendPushToSubscription(supabase, subscriptionRow, payload) {
  if (!pushReady()) return { enabled: false, sent: 0, failed: 0, total: 0, errors: [] };
  if (!subscriptionRow?.endpoint) return { enabled: true, sent: 0, failed: 0, total: 0, errors: [] };
  return await sendRows(supabase, [subscriptionRow], payload);
}

async function sendPushToAllCustomers(supabase, payload) {
  if (!pushReady()) return { enabled: false, sent: 0, failed: 0, total: 0, errors: [] };
  const rows = await supabase("green_grin_push_subscriptions?select=*&active=eq.true&owner_type=eq.customer&limit=1000").catch(() => []);
  const seen = new Map();
  for (const row of rows || []) {
    if (row.endpoint) seen.set(row.endpoint, row);
  }
  return await sendRows(supabase, [...seen.values()], payload);
}

module.exports = {
  pushReady,
  sendPushToAllCustomers,
  sendPushToSubscription,
  sendPushToTarget
};
