const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PAYMENT_LINKS = {
  "Bi-weekly Mowing": process.env.GREEN_GRIN_PAY_BIWEEKLY_URL,
  "Weekly Mowing": process.env.GREEN_GRIN_PAY_WEEKLY_URL,
  "Commercial Care": process.env.GREEN_GRIN_PAY_COMMERCIAL_URL,
  "August service plan": process.env.GREEN_GRIN_PAY_INVOICE_URL
};

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

async function invoicePayLink(invoiceId) {
  if (!invoiceId || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return "";
  const response = await fetch(`${SUPABASE_URL}/rest/v1/green_grin_invoices?select=payment_url&id=eq.${encodeURIComponent(invoiceId)}&limit=1`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  const data = await response.json().catch(() => null);
  return response.ok ? data?.[0]?.payment_url || "" : "";
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });

  try {
    const body = JSON.parse(event.body || "{}");
    const plan = body.plan || "";
    const paymentUrl = await invoicePayLink(body.invoice_id) || PAYMENT_LINKS[plan] || process.env.GREEN_GRIN_PAY_DEFAULT_URL || "";

    if (!paymentUrl) {
      return json(200, {
        configured: false,
        message: "Payment links are not configured yet. Add Green Grin payment links in Netlify environment variables."
      });
    }

    return json(200, { configured: true, paymentUrl });
  } catch (error) {
    return json(500, { error: error.message });
  }
};
