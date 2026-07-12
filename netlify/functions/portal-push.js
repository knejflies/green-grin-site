const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_PIN = process.env.GREEN_GRIN_ADMIN_PIN;
const { pushReady, sendPushToAllCustomers, sendPushToSubscription, sendPushToTarget } = require("./push-helper");

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-pin, x-employee-pin, Authorization",
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS"
};

function json(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

function requireSetup() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return "Supabase is not configured yet.";
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

async function optionalUser(event) {
  const auth = event.headers.authorization || event.headers.Authorization || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`
    }
  });
  const user = await response.json().catch(() => null);
  return response.ok && user?.id ? user : null;
}

async function employeeByUser(user) {
  if (!user) return null;
  const email = encodeURIComponent((user.email || "").toLowerCase());
  let rows = await supabase(`green_grin_employees?select=*&user_id=eq.${encodeURIComponent(user.id)}&status=eq.Active&limit=1`);
  if (!rows?.length && email) rows = await supabase(`green_grin_employees?select=*&email=eq.${email}&status=eq.Active&limit=1`);
  return rows?.[0] || null;
}

async function employeeByPin(event) {
  const pin = event.headers["x-employee-pin"];
  if (!pin) return null;
  const rows = await supabase(`green_grin_employees?select=*&employee_pin=eq.${encodeURIComponent(pin)}&status=eq.Active&limit=1`);
  return rows?.[0] || null;
}

async function ownerContext(event) {
  if (event.headers["x-admin-pin"]) {
    if (!ADMIN_PIN) throw new Error("Admin PIN is not configured yet.");
    if (event.headers["x-admin-pin"] !== ADMIN_PIN) throw new Error("Wrong admin PIN.");
    return {
      owner_type: "admin",
      owner_email: "owner",
      customer_user_id: null,
      customer_code: "",
      employee_id: null,
      employee_code: ""
    };
  }

  const user = await optionalUser(event);
  const employee = await employeeByUser(user) || await employeeByPin(event);
  if (employee) {
    return {
      owner_type: "employee",
      owner_email: employee.email || user?.email || "",
      customer_user_id: null,
      customer_code: "",
      employee_id: employee.id,
      employee_code: employee.employee_code || ""
    };
  }

  if (!user) throw new Error("Please sign in before enabling notifications.");
  let customers = await supabase(`green_grin_customers?select=*&id=eq.${encodeURIComponent(user.id)}&limit=1`);
  if (!customers?.length && user.email) {
    customers = await supabase(`green_grin_customers?select=*&email=eq.${encodeURIComponent(String(user.email).toLowerCase())}&limit=1`);
  }
  const customer = customers?.[0] || {};
  return {
    owner_type: "customer",
    owner_email: user.email || customer.email || "",
    customer_user_id: user.id,
    customer_code: customer.customer_code || "",
    employee_id: null,
    employee_code: ""
  };
}

function subscriptionPayload(subscription, context, event) {
  const endpoint = subscription?.endpoint || "";
  const p256dh = subscription?.keys?.p256dh || "";
  const auth = subscription?.keys?.auth || "";
  if (!endpoint || !p256dh || !auth) throw new Error("Notification subscription is incomplete.");
  return {
    endpoint,
    p256dh,
    auth,
    owner_type: context.owner_type,
    owner_email: (context.owner_email || "").toLowerCase(),
    customer_user_id: context.customer_user_id,
    customer_code: context.customer_code,
    employee_id: context.employee_id,
    employee_code: context.employee_code,
    user_agent: event.headers["user-agent"] || "",
    active: true,
    updated_at: new Date().toISOString()
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  const setupError = requireSetup();
  if (setupError) return json(500, { error: setupError });

  try {
    const body = JSON.parse(event.body || "{}");
    const context = await ownerContext(event);

    if (event.httpMethod === "DELETE") {
      if (!body.endpoint) return json(400, { error: "Endpoint is required." });
      await supabase(`green_grin_push_subscriptions?endpoint=eq.${encodeURIComponent(body.endpoint)}`, {
        method: "PATCH",
        body: JSON.stringify({ active: false, updated_at: new Date().toISOString() })
      });
      return json(200, { ok: true });
    }

    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });

    if (body.broadcast) {
      if (context.owner_type !== "admin") return json(401, { error: "Admin access is required." });
      const title = String(body.title || "Green Grin update").trim().slice(0, 90);
      const message = String(body.message || "").trim().slice(0, 500);
      if (!message) return json(400, { error: "Message is required." });
      const push = await sendPushToAllCustomers(supabase, {
        title,
        body: message,
        url: "/portal/",
        tag: `green-grin-broadcast-${Date.now()}`
      });
      await supabase("green_grin_message_log", {
        method: "POST",
        body: JSON.stringify({
          job_id: null,
          phone: "",
          template: "broadcast",
          message,
          actor_type: "Owner",
          actor_name: "Owner",
          actor_employee_id: null,
          twilio_sid: null
        })
      });
      return json(200, { ok: true, push });
    }

    if (body.testCustomer) {
      if (context.owner_type !== "admin") return json(401, { error: "Admin access is required." });
      const customer = body.customer || {};
      const push = await sendPushToTarget(supabase, {
        customer_user_id: customer.customer_user_id || customer.id || null,
        customer_code: customer.customer_code || "",
        email: customer.email || ""
      }, {
        title: "Green Grin notification test",
        body: "Your Green Grin app notifications are connected.",
        url: "/portal/",
        tag: `green-grin-customer-test-${Date.now()}`
      });
      return json(200, { ok: true, push });
    }

    const payload = subscriptionPayload(body.subscription, context, event);
    const rows = await supabase("green_grin_push_subscriptions?on_conflict=endpoint", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(payload)
    });

    let push = null;
    if (body.test) {
      push = await sendPushToSubscription(supabase, rows?.[0], {
        title: "Green Grin notifications are on",
        body: "You will get app reminders here when Green Grin updates your service.",
        url: context.owner_type === "admin" ? "/admin/" : context.owner_type === "employee" ? "/employee/" : "/portal/",
        tag: `green-grin-test-${context.owner_type}-${Date.now()}`
      });
    }

    return json(200, { ok: true, subscription: rows?.[0] || null, push, context: { owner_type: context.owner_type, customer_code: context.customer_code, employee_code: context.employee_code } });
  } catch (error) {
    return json(500, { error: error.message });
  }
};
