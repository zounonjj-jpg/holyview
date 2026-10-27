import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { parsePhoneNumberFromString } from "npm:libphonenumber-js@1.12.12/max";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { valid: false, error: "Méthode non autorisée." });

  try {
    const body = await req.json();
    const country = String(body?.country ?? "").trim().toUpperCase();
    const phone = String(body?.phone ?? "").trim();

    if (!/^[A-Z]{2}$/.test(country) || !phone) {
      return json(400, { valid: false, error: "Pays et numéro obligatoires." });
    }

    const parsed = parsePhoneNumberFromString(phone, country as never);
    if (!parsed || !parsed.isValid() || (parsed.country && parsed.country !== country)) {
      return json(422, {
        valid: false,
        error: "Ce numéro ne correspond pas à un numéro valide pour le pays sélectionné.",
      });
    }

    return json(200, {
      valid: true,
      country: parsed.country ?? country,
      e164: parsed.number,
      national: parsed.formatNational(),
      international: parsed.formatInternational(),
    });
  } catch {
    return json(400, { valid: false, error: "Données invalides. Vérifie le pays et le numéro." });
  }
});
