import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Neutral placeholder for HOLYVIEW subscription checkout.
// Keep all payment attempts disabled until the owner selects and configures
// their existing payment provider, credentials, and callback verification.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Méthode non autorisée." });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* report a neutral error below */ }

  if (body.action === "config") {
    return reply(200, {
      paymentsEnabled: false,
      configured: false,
      sandbox: true,
      provider: null,
    });
  }

  return reply(503, {
    ok: false,
    code: "PAYMENT_PROVIDER_NOT_CONFIGURED",
    error: "Les paiements HOLYVIEW restent désactivés. Configure d’abord le prestataire choisi par le propriétaire.",
  });
});
