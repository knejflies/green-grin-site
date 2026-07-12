const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_PIN = process.env.GREEN_GRIN_ADMIN_PIN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_RECEIPT_MODEL = ["gpt", "4o", "mini"].join("-");
const OPENAI_RECEIPT_MODEL = process.env.OPENAI_RECEIPT_MODEL || DEFAULT_RECEIPT_MODEL;
const DEFAULT_MILEAGE_RATE = 0.76;

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

function moneyNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

function cleanDate(value) {
  const raw = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 10);
}

function expensePayload(body) {
  const amount = moneyNumber(body.amount ?? body.total);
  return {
    expense_type: String(body.expense_type || "receipt").trim().slice(0, 40),
    expense_date: cleanDate(body.expense_date || body.date),
    vendor: String(body.vendor || "").trim().slice(0, 120),
    category: String(body.category || "Other").trim().slice(0, 80),
    amount: amount ?? 0,
    subtotal: moneyNumber(body.subtotal),
    tax: moneyNumber(body.tax),
    payment_method: String(body.payment_method || "").trim().slice(0, 80),
    notes: String(body.notes || "").trim().slice(0, 800),
    receipt_filename: String(body.receipt_filename || "").trim().slice(0, 180),
    mileage_start: moneyNumber(body.mileage_start),
    mileage_end: moneyNumber(body.mileage_end),
    mileage_miles: moneyNumber(body.mileage_miles),
    mileage_rate: moneyNumber(body.mileage_rate),
    ai_confidence: moneyNumber(body.ai_confidence ?? body.confidence),
    ai_raw: body.ai_raw || null,
    active: true
  };
}

function mileagePayload(body) {
  const start = moneyNumber(body.mileage_start);
  const end = moneyNumber(body.mileage_end);
  let miles = moneyNumber(body.mileage_miles ?? body.miles) || 0;
  if (start !== null || end !== null) {
    if (start === null || end === null) throw new Error("Enter both start mileage and end mileage.");
    if (end <= start) throw new Error("End mileage must be higher than start mileage.");
    miles = Math.round((end - start) * 100) / 100;
  }
  if (miles <= 0) throw new Error("Enter mileage before saving.");
  const rate = moneyNumber(body.mileage_rate ?? body.rate) || DEFAULT_MILEAGE_RATE;
  const route = String(body.route || body.vendor || "").trim();
  const purpose = String(body.purpose || body.notes || "").trim();
  const amount = Math.round(miles * rate * 100) / 100;
  return {
    expense_type: "mileage",
    expense_date: cleanDate(body.expense_date || body.date),
    vendor: route ? `Mileage - ${route}`.slice(0, 120) : "Mileage",
    category: "Vehicle",
    amount,
    subtotal: null,
    tax: null,
    payment_method: "Mileage",
    notes: purpose.slice(0, 800),
    receipt_filename: "",
    mileage_start: start,
    mileage_end: end,
    mileage_miles: miles,
    mileage_rate: rate,
    ai_confidence: null,
    ai_raw: null,
    active: true
  };
}

async function activeExpenses() {
  return await supabase("green_grin_expenses?select=*&active=eq.true&order=expense_date.desc,created_at.desc&limit=1000");
}

function totalsFor(expenses) {
  const now = new Date();
  const monthKey = now.toISOString().slice(0, 7);
  const yearKey = now.getFullYear().toString();
  const categoryTotals = {};
  let monthTotal = 0;
  let yearTotal = 0;
  let allTotal = 0;

  for (const expense of expenses || []) {
    const amount = Number(expense.amount || 0);
    const date = String(expense.expense_date || expense.created_at || "");
    allTotal += amount;
    if (date.startsWith(monthKey)) monthTotal += amount;
    if (date.startsWith(yearKey)) yearTotal += amount;
    const category = expense.category || "Other";
    categoryTotals[category] = (categoryTotals[category] || 0) + amount;
  }

  return { monthTotal, yearTotal, allTotal, categoryTotals };
}

function extractJsonText(data) {
  const direct = data?.choices?.[0]?.message?.content;
  if (typeof direct === "string") return direct;
  if (Array.isArray(direct)) {
    const textPart = direct.find((item) => item?.text || item?.type === "text");
    return textPart?.text || "";
  }
  return "";
}

function parseAiJson(text) {
  const trimmed = String(text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI did not return receipt details. Try a clearer receipt photo.");
    return JSON.parse(match[0]);
  }
}

async function scanReceipt(body) {
  if (!OPENAI_API_KEY) throw new Error("AI receipt scanning needs OPENAI_API_KEY added in Netlify.");
  const image = String(body.image_data_url || "");
  if (!image.startsWith("data:image/")) throw new Error("Upload a receipt photo before scanning.");
  if (image.length > 7500000) throw new Error("Receipt photo is too large. Retake it closer/cropped and try again.");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_RECEIPT_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Read this lawn business receipt. Return JSON only with keys vendor, date, total, subtotal, tax, category, payment_method, notes, confidence. Use date as YYYY-MM-DD when visible. total/subtotal/tax/confidence must be numbers or null. Choose category from Fuel, Equipment, Repairs, Materials, Office, Vehicle, Insurance, Meals, Other. If uncertain, use Other and note what was uncertain."
            },
            {
              type: "image_url",
              image_url: { url: image }
            }
          ]
        }
      ]
    })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || "AI receipt scan failed.");
  const parsed = parseAiJson(extractJsonText(data));
  const payload = expensePayload({
    vendor: parsed.vendor || "",
    date: parsed.date || new Date().toISOString().slice(0, 10),
    total: parsed.total,
    subtotal: parsed.subtotal,
    tax: parsed.tax,
    category: parsed.category || "Other",
    payment_method: parsed.payment_method || "",
    notes: parsed.notes || "",
    receipt_filename: body.receipt_filename || "",
    confidence: parsed.confidence,
    ai_raw: parsed
  });
  return { ...payload, ai_raw: parsed };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});

  const setupError = requireSetup();
  if (setupError) return json(500, { error: setupError });

  const adminError = requireAdmin(event);
  if (adminError) return json(401, { error: adminError });

  try {
    if (event.httpMethod === "GET") {
      const expenses = await activeExpenses();
      return json(200, { expenses, totals: totalsFor(expenses) });
    }

    const body = JSON.parse(event.body || "{}");

    if (event.httpMethod === "POST" && body.action === "scan") {
      const expense = await scanReceipt(body);
      return json(200, { expense });
    }

    if (event.httpMethod === "POST" && body.action === "mileage") {
      const rows = await supabase("green_grin_expenses", {
        method: "POST",
        body: JSON.stringify(mileagePayload(body))
      });
      const expenses = await activeExpenses();
      return json(200, { expense: rows?.[0] || null, expenses, totals: totalsFor(expenses) });
    }

    if (event.httpMethod === "POST") {
      const rows = await supabase("green_grin_expenses", {
        method: "POST",
        body: JSON.stringify(expensePayload(body))
      });
      const expenses = await activeExpenses();
      return json(200, { expense: rows?.[0] || null, expenses, totals: totalsFor(expenses) });
    }

    if (event.httpMethod === "PATCH") {
      if (!body.id) return json(400, { error: "Expense id is required." });
      const rows = await supabase(`green_grin_expenses?id=eq.${encodeURIComponent(body.id)}`, {
        method: "PATCH",
        body: JSON.stringify(body.expense_type === "mileage" || body.action === "mileage" ? mileagePayload(body) : expensePayload(body))
      });
      const expenses = await activeExpenses();
      return json(200, { expense: rows?.[0] || null, expenses, totals: totalsFor(expenses) });
    }

    if (event.httpMethod === "DELETE") {
      if (!body.id) return json(400, { error: "Expense id is required." });
      await supabase(`green_grin_expenses?id=eq.${encodeURIComponent(body.id)}`, { method: "DELETE" });
      const expenses = await activeExpenses();
      return json(200, { ok: true, expenses, totals: totalsFor(expenses) });
    }

    return json(405, { error: "Method not allowed." });
  } catch (error) {
    return json(500, { error: error.message });
  }
};
