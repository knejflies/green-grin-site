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

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });

  try {
    const body = JSON.parse(event.body || "{}");
    const plan = body.plan || "";
    const paymentUrl = PAYMENT_LINKS[plan] || process.env.GREEN_GRIN_PAY_DEFAULT_URL || "";

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
