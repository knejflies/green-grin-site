const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS"
};

function json(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

function requireSetup() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return "Supabase account login is not fully configured yet.";
  }
  return null;
}

async function verifyUser(event) {
  const auth = event.headers.authorization || event.headers.Authorization || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Please sign in again.");

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`
    }
  });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id) throw new Error("Your sign-in expired. Please sign in again.");
  return user;
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

async function ensureCustomer(user) {
  const profile = {
    id: user.id,
    email: user.email || "",
    full_name: user.user_metadata?.name || user.email?.split("@")[0] || "",
    billing_status: "Not connected"
  };

  const rows = await supabase("green_grin_customers?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(profile)
  });
  return rows?.[0] || profile;
}

async function loadAccount(user) {
  const customer = await ensureCustomer(user);
  let properties = await supabase(`green_grin_properties?select=*&customer_user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&order=created_at.asc&limit=1`);

  if (!properties?.length) {
    properties = await supabase("green_grin_properties", {
      method: "POST",
      body: JSON.stringify({
        customer_user_id: user.id,
        address: "",
        gate_code: "",
        pets: "",
        yard_notes: "",
        service_preferences: ""
      })
    });
  }

  const jobs = await supabase(`green_grin_jobs?select=*&customer_user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=20`);
  return { user: { id: user.id, email: user.email }, customer, property: properties?.[0] || null, jobs };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});

  const setupError = requireSetup();
  if (setupError) return json(500, { error: setupError });

  try {
    const user = await verifyUser(event);

    if (event.httpMethod === "GET") {
      return json(200, await loadAccount(user));
    }

    if (event.httpMethod === "PATCH") {
      const body = JSON.parse(event.body || "{}");

      if (body.profile) {
        await supabase(`green_grin_customers?id=eq.${encodeURIComponent(user.id)}`, {
          method: "PATCH",
          body: JSON.stringify({
            full_name: body.profile.full_name || "",
            phone: body.profile.phone || "",
            billing_plan: body.profile.billing_plan || null
          })
        });
      }

      if (body.property) {
        const property = {
          customer_user_id: user.id,
          address: body.property.address || "",
          gate_code: body.property.gate_code || "",
          pets: body.property.pets || "",
          yard_notes: body.property.yard_notes || "",
          service_preferences: body.property.service_preferences || "",
          active: true
        };

        if (body.property.id) {
          await supabase(`green_grin_properties?id=eq.${encodeURIComponent(body.property.id)}&customer_user_id=eq.${encodeURIComponent(user.id)}`, {
            method: "PATCH",
            body: JSON.stringify(property)
          });
        } else {
          await supabase("green_grin_properties", {
            method: "POST",
            body: JSON.stringify(property)
          });
        }
      }

      return json(200, await loadAccount(user));
    }

    return json(405, { error: "Method not allowed." });
  } catch (error) {
    return json(500, { error: error.message });
  }
};
