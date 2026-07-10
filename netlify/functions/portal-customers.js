const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_PIN = process.env.GREEN_GRIN_ADMIN_PIN;

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-pin",
  "Access-Control-Allow-Methods": "PATCH, DELETE, OPTIONS"
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

async function deleteAuthUser(userId) {
  if (!userId) return false;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  return response.ok;
}

async function archiveForCustomer({ customerUserId, phone, email }) {
  const archive = {
    archived_at: new Date().toISOString(),
    customer: null,
    properties: [],
    jobs: [],
    message_logs: []
  };

  if (customerUserId) {
    const customers = await supabase(`green_grin_customers?select=*&id=eq.${encodeURIComponent(customerUserId)}&limit=1`);
    archive.customer = customers?.[0] || null;
    archive.properties = await supabase(`green_grin_properties?select=*&customer_user_id=eq.${encodeURIComponent(customerUserId)}`);
  }

  const jobMatches = [];
  if (customerUserId) jobMatches.push(`customer_user_id.eq.${encodeURIComponent(customerUserId)}`);
  if (phone) jobMatches.push(`phone.eq.${encodeURIComponent(phone)}`);
  if (email) jobMatches.push(`email.eq.${encodeURIComponent(email)}`);
  if (jobMatches.length) {
    archive.jobs = await supabase(`green_grin_jobs?select=*&or=(${jobMatches.join(",")})&order=created_at.desc`);
  }

  const jobIds = archive.jobs.map((job) => job.id).filter(Boolean);
  if (jobIds.length) {
    archive.message_logs = await supabase(`green_grin_message_log?select=*&job_id=in.(${jobIds.join(",")})&order=created_at.desc`);
  }

  archive.customer_code = archive.customer?.customer_code || archive.jobs.find((job) => job.customer_code)?.customer_code || null;
  archive.name = archive.customer?.full_name || archive.jobs[0]?.customer_name || "";
  archive.phone = archive.customer?.phone || phone || archive.jobs[0]?.phone || "";
  archive.email = archive.customer?.email || email || archive.jobs[0]?.email || "";
  return archive;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});

  const setupError = requireSetup();
  if (setupError) return json(500, { error: setupError });

  const adminError = requireAdmin(event);
  if (adminError) return json(401, { error: adminError });

  try {
    const body = JSON.parse(event.body || "{}");
    const customerUserId = body.customer_user_id || null;
    const phone = body.phone || "";
    const email = body.email || "";

    if (!customerUserId && !phone && !email) {
      return json(400, { error: "Customer id, phone, or email is required." });
    }

    if (event.httpMethod === "PATCH") {
      if (!customerUserId) return json(400, { error: "Only account customers can be deactivated. Use Delete for request-only customers." });
      const rows = await supabase(`green_grin_customers?id=eq.${encodeURIComponent(customerUserId)}`, {
        method: "PATCH",
        body: JSON.stringify({ active: false })
      });
      return json(200, { customer: rows?.[0] || null });
    }

    if (event.httpMethod === "DELETE") {
      const archive = await archiveForCustomer({ customerUserId, phone, email });
      const jobIds = archive.jobs.map((job) => job.id).filter(Boolean);
      if (jobIds.length) {
        await supabase(`green_grin_message_log?job_id=in.(${jobIds.join(",")})`, { method: "DELETE" });
      }

      if (customerUserId) {
        await supabase(`green_grin_properties?customer_user_id=eq.${encodeURIComponent(customerUserId)}`, { method: "DELETE" });
        await supabase(`green_grin_jobs?customer_user_id=eq.${encodeURIComponent(customerUserId)}`, { method: "DELETE" });
        if (phone) await supabase(`green_grin_jobs?phone=eq.${encodeURIComponent(phone)}`, { method: "DELETE" });
        if (email) await supabase(`green_grin_jobs?email=eq.${encodeURIComponent(email)}`, { method: "DELETE" });
        await supabase(`green_grin_customers?id=eq.${encodeURIComponent(customerUserId)}`, { method: "DELETE" });
        const authDeleted = await deleteAuthUser(customerUserId);
        return json(200, { ok: true, authDeleted, archive });
      }

      if (phone) {
        await supabase(`green_grin_jobs?phone=eq.${encodeURIComponent(phone)}`, { method: "DELETE" });
      }
      if (email) {
        await supabase(`green_grin_jobs?email=eq.${encodeURIComponent(email)}`, { method: "DELETE" });
      }
      return json(200, { ok: true, authDeleted: false, archive });
    }

    return json(405, { error: "Method not allowed." });
  } catch (error) {
    return json(500, { error: error.message });
  }
};
