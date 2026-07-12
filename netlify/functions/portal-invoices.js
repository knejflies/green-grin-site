const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_PIN = process.env.GREEN_GRIN_ADMIN_PIN;
const { sendPushToTarget } = require("./push-helper");

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-pin",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS"
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

function invoicePayload(body) {
  const amount = Number(body.amount);
  return {
    customer_user_id: body.customer_user_id || null,
    customer_code: body.customer_code || "",
    customer_name: body.customer_name || "Customer",
    phone: body.phone || "",
    email: body.email || "",
    amount: Number.isFinite(amount) ? amount : 0,
    due_date: body.due_date || null,
    status: body.status || "Draft",
    service_line: body.service_line || "",
    notes: body.notes || "",
    payment_url: "",
    active: true
  };
}

async function notifyInvoice(invoice) {
  if (!invoice || invoice.status !== "Sent") return null;
  const customer = await sendPushToTarget(supabase, {
    customer_user_id: invoice.customer_user_id || null,
    customer_code: invoice.customer_code || "",
    email: invoice.email || ""
  }, {
    title: "New Green Grin invoice",
    body: `${invoice.service_line || invoice.notes || "Monthly service"} - $${Number(invoice.amount || 0).toFixed(2)}`,
    url: "/portal/",
    tag: `green-grin-invoice-${invoice.id}`
  });
  const owner = await sendPushToTarget(supabase, { owner_type: "admin" }, {
    title: "Invoice sent",
    body: `${invoice.customer_name || "Customer"} - $${Number(invoice.amount || 0).toFixed(2)}`,
    url: "/admin/",
    tag: `green-grin-owner-invoice-${invoice.id}`
  });
  return {
    customer,
    owner,
    sent: Number(customer?.sent || 0) + Number(owner?.sent || 0),
    failed: Number(customer?.failed || 0) + Number(owner?.failed || 0),
    total: Number(customer?.total || 0) + Number(owner?.total || 0),
    enabled: customer?.enabled !== false || owner?.enabled !== false
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});

  const setupError = requireSetup();
  if (setupError) return json(500, { error: setupError });

  const adminError = requireAdmin(event);
  if (adminError) return json(401, { error: adminError });

  try {
    if (event.httpMethod === "GET") {
      const invoices = await supabase("green_grin_invoices?select=*&active=eq.true&order=created_at.desc&limit=500");
      return json(200, { invoices });
    }

    const body = JSON.parse(event.body || "{}");

    if (event.httpMethod === "POST") {
      const rows = await supabase("green_grin_invoices", {
        method: "POST",
        body: JSON.stringify(invoicePayload(body))
      });
      const invoice = rows?.[0] || null;
      const push = body.notify_customer === true ? await notifyInvoice(invoice) : null;
      return json(200, { invoice, push });
    }

    if (event.httpMethod === "PATCH") {
      if (!body.id) return json(400, { error: "Invoice id is required." });
      const rows = await supabase(`green_grin_invoices?id=eq.${encodeURIComponent(body.id)}`, {
        method: "PATCH",
        body: JSON.stringify(invoicePayload(body))
      });
      const invoice = rows?.[0] || null;
      const push = body.notify_customer === true ? await notifyInvoice(invoice) : null;
      return json(200, { invoice, push });
    }

    if (event.httpMethod === "DELETE") {
      if (!body.id) return json(400, { error: "Invoice id is required." });
      await supabase(`green_grin_invoices?id=eq.${encodeURIComponent(body.id)}`, { method: "DELETE" });
      return json(200, { ok: true });
    }

    return json(405, { error: "Method not allowed." });
  } catch (error) {
    return json(500, { error: error.message });
  }
};
