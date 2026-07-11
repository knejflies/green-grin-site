const crypto = require("crypto");

const VAPID_PUBLIC_KEY = process.env.GREEN_GRIN_VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.GREEN_GRIN_VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.GREEN_GRIN_VAPID_SUBJECT || "mailto:notifications@greengrinlawns.com";

function base64UrlToBuffer(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(normalized + padding, "base64");
}

function bufferToBase64Url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function hkdfExpand(prk, info, length) {
  const blocks = [];
  let previous = Buffer.alloc(0);
  let counter = 1;
  while (Buffer.concat(blocks).length < length) {
    previous = crypto
      .createHmac("sha256", prk)
      .update(previous)
      .update(info)
      .update(Buffer.from([counter]))
      .digest();
    blocks.push(previous);
    counter += 1;
  }
  return Buffer.concat(blocks).subarray(0, length);
}

function hmac(key, value) {
  return crypto.createHmac("sha256", key).update(value).digest();
}

function derToJose(signature) {
  let offset = 0;
  if (signature[offset++] !== 0x30) throw new Error("Invalid signature.");
  let sequenceLength = signature[offset++];
  if (sequenceLength & 0x80) offset += sequenceLength & 0x7f;
  if (signature[offset++] !== 0x02) throw new Error("Invalid signature.");
  let rLength = signature[offset++];
  let r = signature.subarray(offset, offset + rLength);
  offset += rLength;
  if (signature[offset++] !== 0x02) throw new Error("Invalid signature.");
  let sLength = signature[offset++];
  let s = signature.subarray(offset, offset + sLength);
  while (r.length > 32 && r[0] === 0) r = r.subarray(1);
  while (s.length > 32 && s[0] === 0) s = s.subarray(1);
  return Buffer.concat([
    Buffer.concat([Buffer.alloc(32 - r.length), r]),
    Buffer.concat([Buffer.alloc(32 - s.length), s])
  ]);
}

function vapidToken(endpoint) {
  const publicKey = base64UrlToBuffer(VAPID_PUBLIC_KEY);
  const privateKey = base64UrlToBuffer(VAPID_PRIVATE_KEY);
  if (publicKey.length !== 65 || privateKey.length !== 32) throw new Error("VAPID keys are not valid.");

  const key = crypto.createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: bufferToBase64Url(privateKey),
      x: bufferToBase64Url(publicKey.subarray(1, 33)),
      y: bufferToBase64Url(publicKey.subarray(33, 65))
    },
    format: "jwk"
  });
  const header = bufferToBase64Url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = bufferToBase64Url(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: VAPID_SUBJECT
  }));
  const input = `${header}.${payload}`;
  const der = crypto.sign("sha256", Buffer.from(input), key);
  return `${input}.${bufferToBase64Url(derToJose(der))}`;
}

function encryptedPushBody(subscription, payload) {
  const receiverPublicKey = base64UrlToBuffer(subscription.p256dh);
  const authSecret = base64UrlToBuffer(subscription.auth);
  const salt = crypto.randomBytes(16);
  const local = crypto.createECDH("prime256v1");
  const senderPublicKey = local.generateKeys();
  const sharedSecret = local.computeSecret(receiverPublicKey);
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0"),
    receiverPublicKey,
    senderPublicKey
  ]);
  const ikm = hkdfExpand(hmac(authSecret, sharedSecret), keyInfo, 32);
  const prk = hmac(salt, ikm);
  const cek = hkdfExpand(prk, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdfExpand(prk, Buffer.from("Content-Encoding: nonce\0"), 12);
  const record = Buffer.concat([Buffer.from(JSON.stringify(payload)), Buffer.from([0x02])]);
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const encrypted = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21 + senderPublicKey.length);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header[20] = senderPublicKey.length;
  senderPublicKey.copy(header, 21);
  return Buffer.concat([header, encrypted]);
}

async function sendWebPush(subscription, payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return { ok: false, skipped: true, reason: "Push keys are not configured." };
  }
  const body = encryptedPushBody(subscription, payload);
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      TTL: "86400",
      Urgency: "normal",
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      Authorization: `vapid t=${vapidToken(subscription.endpoint)}, k=${VAPID_PUBLIC_KEY}`
    },
    body
  });
  return { ok: response.ok, status: response.status };
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

async function sendPushToTarget(supabase, target, payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return { enabled: false, sent: 0, failed: 0, total: 0 };
  const rows = await subscriptionRows(supabase, target);
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const result = await sendWebPush({
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth
    }, payload).catch(() => ({ ok: false, status: 0 }));
    if (result.ok) {
      sent += 1;
    } else {
      failed += 1;
      if (result.status === 404 || result.status === 410) await markSubscriptionInactive(supabase, row.endpoint);
    }
  }
  return { enabled: true, sent, failed, total: rows.length };
}

async function sendPushToAllCustomers(supabase, payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return { enabled: false, sent: 0, failed: 0, total: 0 };
  const rows = await supabase("green_grin_push_subscriptions?select=*&active=eq.true&owner_type=eq.customer&limit=1000").catch(() => []);
  const seen = new Map();
  for (const row of rows || []) {
    if (row.endpoint) seen.set(row.endpoint, row);
  }
  let sent = 0;
  let failed = 0;
  for (const row of seen.values()) {
    const result = await sendWebPush({
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth
    }, payload).catch(() => ({ ok: false, status: 0 }));
    if (result.ok) {
      sent += 1;
    } else {
      failed += 1;
      if (result.status === 404 || result.status === 410) await markSubscriptionInactive(supabase, row.endpoint);
    }
  }
  return { enabled: true, sent, failed, total: seen.size };
}

function pushReady() {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

module.exports = {
  pushReady,
  sendPushToAllCustomers,
  sendPushToTarget
};
