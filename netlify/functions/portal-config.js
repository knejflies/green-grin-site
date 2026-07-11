const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*"
};

exports.handler = async () => {
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      supabaseUrl: process.env.SUPABASE_URL || "",
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
      vapidPublicKey: process.env.GREEN_GRIN_VAPID_PUBLIC_KEY || ""
    })
  };
};
