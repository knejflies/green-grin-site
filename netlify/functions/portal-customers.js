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
      if (customerUserId) {
        await supabase(`green_grin_properties?customer_user_id=eq.${encodeURIComponent(customerUserId)}`, { method: "DELETE" });
        await supabase(`green_grin_customers?id=eq.${encodeURIComponent(customerUserId)}`, { method: "DELETE" });
        await supabase(`green_grin_jobs?customer_user_id=eq.${encodeURIComponent(customerUserId)}`, { method: "DELETE" });
        const authDeleted = await deleteAuthUser(customerUserId);
        return json(200, { ok: true, authDeleted });
      }

      if (phone) {
        await supabase(`green_grin_jobs?phone=eq.${encodeURIComponent(phone)}`, { method: "DELETE" });
      }
      if (email) {
        await supabase(`green_grin_jobs?email=eq.${encodeURIComponent(email)}`, { method: "DELETE" });
      }
      return json(200, { ok: true, authDeleted: false });
    }

    return json(405, { error: "Method not allowed." });
  } catch (error) {
    return json(500, { error: error.message });
  }
};
