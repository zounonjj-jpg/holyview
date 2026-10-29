import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SASPAY_API_KEY = (Deno.env.get("SASPAY_API_KEY") ?? "").trim();
const SASPAY_WEBHOOK_SECRET = (Deno.env.get("SASPAY_WEBHOOK_SECRET") ?? "").trim();
const SASPAY_API = "https://api.saspay.me/api/v1";
const RETURN_URL = "https://holyview.vercel.app/";
const TEST_KEY = /^sk_test_/i.test(SASPAY_API_KEY);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-signature, x-webhook-timestamp, x-webhook-event",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: cors });
const admin = () => createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

async function paymentsEnabled(db: ReturnType<typeof admin>): Promise<boolean> {
  const { data, error } = await db.from("settings").select("value").eq("key", "payments_enabled").maybeSingle();
  if (error) throw new Error("Configuration des paiements indisponible.");
  const v = data?.value;
  return v === true || v === "true" || (typeof v === "object" && v !== null && (v as Record<string, unknown>).enabled === true);
}
function checkoutUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && (u.hostname === "saspay.me" || u.hostname.endsWith(".saspay.me")) ? u.toString() : null;
  } catch { return null; }
}
async function saspay(path: string, init: RequestInit = {}) {
  if (!SASPAY_API_KEY) throw new Error("La clé API SasPay manque dans les secrets Supabase.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(SASPAY_API + path, {
      ...init, signal: controller.signal,
      headers: { Authorization: "Bearer " + SASPAY_API_KEY, "Content-Type": "application/json", ...(init.headers || {}) },
    });
    const payload = await response.json().catch(() => ({})) as Record<string, any>;
    return { response, payload };
  } catch {
    throw new Error("SasPay ne répond pas. Vérifie le statut avant de créer une autre session.");
  } finally { clearTimeout(timeout); }
}
async function sessionStatus(id: string): Promise<Record<string, any>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Identifiant de session SasPay invalide.");
  const { response, payload } = await saspay("/checkout-sessions/" + encodeURIComponent(id) + "/status/", { method: "GET" });
  if (!response.ok || payload.success !== true || !payload.data || payload.data.id !== id) {
    throw new Error("Impossible de confirmer le paiement auprès de SasPay.");
  }
  return payload.data;
}
const paid = (s: Record<string, any>) =>
  String(s.status ?? "").toUpperCase() === "PAID" && String(s.transaction_status ?? "").toUpperCase() === "SUCCESS";
const terminal = (s: Record<string, any>) =>
  ["EXPIRED", "CANCELLED"].includes(String(s.status ?? "").toUpperCase())
  || ["FAILED", "CANCELLED"].includes(String(s.transaction_status ?? "").toUpperCase());

async function activate(db: ReturnType<typeof admin>, p: Record<string, any>) {
  const tier = String(p.metadata?.tier ?? "");
  const sid = String(p.provider_reference ?? "");
  if (!["pro", "elite"].includes(tier) || !sid || p.provider !== "saspay" || p.currency !== "XOF") {
    throw new Error("Références internes de paiement incohérentes.");
  }
  const { data, error } = await db.rpc("holyview_activate_saspay_payment", {
    p_payment_id: p.id, p_session_id: sid, p_tier: tier,
  });
  if (error || !data?.ok) {
    console.error("HOLYVIEW activation RPC error", error?.code ?? "unknown");
    throw new Error("Le paiement est confirmé, mais l’activation doit être relancée. Ne paie pas une deuxième fois.");
  }
  return data;
}
async function markFailed(db: ReturnType<typeof admin>, id: string, metadata: Record<string, unknown>) {
  await db.from("payments").update({ status: "failed", metadata }).eq("id", id).eq("status", "pending");
}
async function checkPayment(db: ReturnType<typeof admin>, userId: string, paymentId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) return reply(400, { ok: false, error: "Identifiant de paiement invalide." });
  const { data: p, error } = await db.from("payments")
    .select("id,user_id,provider,provider_reference,amount,currency,status,metadata,subscription_id")
    .eq("id", paymentId).eq("user_id", userId).eq("provider", "saspay").maybeSingle();
  if (error || !p) return reply(404, { ok: false, error: "Cette demande de paiement n’appartient pas à ce compte." });
  if (p.status === "succeeded") return reply(200, { ok: true, paid: true, paymentId, tier: p.metadata?.tier, alreadyProcessed: true });
  if (["failed", "refunded", "disabled"].includes(p.status)) return reply(200, { ok: true, paid: false, terminal: true, status: p.status });
  if (!p.provider_reference) return reply(409, { ok: false, error: "La session n’a pas d’identifiant confirmé. Ne relance pas le paiement ; une vérification est nécessaire." });
  let s: Record<string, any>;
  try { s = await sessionStatus(String(p.provider_reference)); }
  catch (e) { return reply(503, { ok: false, error: e instanceof Error ? e.message : "Vérification SasPay indisponible." }); }
  if (paid(s)) {
    try {
      const activated = await activate(db, p);
      return reply(200, { ok: true, paid: true, paymentId, tier: p.metadata?.tier, alreadyProcessed: !!activated.alreadyProcessed });
    } catch (e) {
      return reply(409, { ok: false, code: "PAYMENT_CONFIRMED_ACTIVATION_PENDING", error: e instanceof Error ? e.message : "Activation en attente." });
    }
  }
  if (terminal(s)) {
    await markFailed(db, paymentId, { ...(p.metadata ?? {}), failure_reason: "provider_terminal_status", provider_status: s.status, transaction_status: s.transaction_status });
    return reply(200, { ok: true, paid: false, terminal: true, status: "failed" });
  }
  return reply(200, { ok: true, paid: false, terminal: false, status: "pending", providerStatus: s.status ?? "PENDING" });
}

async function resumeOrExpirePending(db: ReturnType<typeof admin>, userId: string, tier: string) {
  const { data: p, error } = await db.from("payments")
    .select("id,user_id,provider,provider_reference,amount,currency,status,metadata,subscription_id")
    .eq("user_id", userId).eq("provider", "saspay").eq("status", "pending")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error || !p) return { response: reply(409, { ok: false, error: "Une demande de paiement est déjà en cours. Vérifie son état avant de recommencer." }) };
  if (String(p.metadata?.tier ?? "") !== tier) return { response: reply(409, { ok: false, error: "Une autre formule a déjà une session en cours. Termine ou vérifie cette session avant de changer de formule." }) };
  if (!p.provider_reference) return { response: reply(409, { ok: false, error: "La création précédente a eu une réponse incertaine. Vérifie les sessions SasPay avant une nouvelle tentative." }) };
  try {
    const s = await sessionStatus(String(p.provider_reference));
    if (paid(s)) {
      await activate(db, p);
      return { response: reply(200, { ok: true, paid: true, paymentId: p.id, tier }) };
    }
    if (terminal(s)) {
      await markFailed(db, String(p.id), { ...(p.metadata ?? {}), failure_reason: "provider_terminal_status", provider_status: s.status });
      return { retry: true };
    }
    const link = checkoutUrl(p.metadata?.checkout_url);
    if (link) return { response: reply(200, { ok: true, resumed: true, paymentId: p.id, tier, checkoutUrl: link, status: "pending" }) };
  } catch (e) {
    return { response: reply(503, { ok: false, error: e instanceof Error ? e.message : "Vérification SasPay indisponible." }) };
  }
  return { response: reply(409, { ok: false, error: "Session existante sans lien de paiement. Vérifie-la dans le tableau de bord SasPay." }) };
}

async function createCheckout(db: ReturnType<typeof admin>, user: Record<string, any>, tier: string) {
  if (!["pro", "elite"].includes(tier)) return reply(400, { ok: false, error: "Formule invalide." });
  if (!SASPAY_API_KEY) return reply(503, { ok: false, error: "La clé API SasPay manque dans les secrets Supabase." });
  let enabled = false;
  try { enabled = await paymentsEnabled(db); }
  catch { return reply(503, { ok: false, error: "Configuration des paiements indisponible." }); }
  if (!enabled && !TEST_KEY) {
    return reply(503, { ok: false, code: "PAYMENTS_DISABLED", error: "La production est protégée. Configure une clé SasPay de test pour valider le parcours avant d’ouvrir les paiements aux membres." });
  }
  const { data: offer, error: offerError } = await db.from("subscription_offers")
    .select("tier,monthly_price_xof,is_listed").eq("tier", tier).eq("is_listed", true).maybeSingle();
  if (offerError || !offer || !Number.isSafeInteger(Number(offer.monthly_price_xof)) || Number(offer.monthly_price_xof) <= 0) {
    return reply(409, { ok: false, error: "Le tarif de cette formule n’est pas disponible." });
  }
  const { data: activeRows } = await db.from("subscriptions")
    .select("tier,starts_at,ends_at,status").eq("user_id", user.id).eq("status", "active");
  const now = Date.now();
  const active = (activeRows ?? []).filter((x: any) => x.starts_at && x.ends_at && Date.parse(x.starts_at) <= now && Date.parse(x.ends_at) > now)
    .sort((a: any, b: any) => ({ free: 0, pro: 1, elite: 2 }[b.tier as string] ?? 0) - ({ free: 0, pro: 1, elite: 2 }[a.tier as string] ?? 0))[0];
  if (active?.tier === "elite" && tier === "pro") {
    return reply(409, { ok: false, error: "Ton abonnement ELITE est encore actif. Tu pourras choisir PRO après son expiration." });
  }

  const email = String(user.email ?? "").trim();
  if (!email) return reply(400, { ok: false, error: "Une adresse e-mail valide est nécessaire." });
  const { data: profile } = await db.from("profiles").select("full_name,display_name,email,phone_number").eq("id", user.id).maybeSingle();
  const name = String(profile?.full_name || profile?.display_name || user.user_metadata?.full_name || email.split("@")[0] || "Membre HOLYVIEW").trim().slice(0, 120);
  const phone = String(profile?.phone_number ?? "").trim();
  const baseMeta = { tier, source: "HOLYVIEW", created_at: new Date().toISOString() };

  let p: Record<string, any> | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const inserted = await db.from("payments").insert({
      user_id: user.id, provider: "saspay", amount: Number(offer.monthly_price_xof),
      currency: "XOF", status: "pending", metadata: baseMeta,
    }).select("id,user_id,provider,provider_reference,amount,currency,status,metadata,subscription_id").single();
    if (!inserted.error && inserted.data) { p = inserted.data; break; }
    if (inserted.error?.code === "23505") {
      const resumed = await resumeOrExpirePending(db, String(user.id), tier);
      if ("response" in resumed) return resumed.response;
      if (resumed.retry && attempt === 0) continue;
    }
    console.error("HOLYVIEW payment reservation failed", inserted.error?.code ?? "unknown");
    return reply(500, { ok: false, error: "Impossible de réserver cette demande de paiement." });
  }
  if (!p) return reply(409, { ok: false, error: "Impossible de créer une nouvelle session pour le moment." });

  const back = new URL(RETURN_URL);
  back.searchParams.set("hv_payment_id", String(p.id));
  back.searchParams.set("hv_payment_return", "1");
  back.hash = "plans";
  const requestBody: Record<string, unknown> = {
    amount: Number(offer.monthly_price_xof).toFixed(2),
    currency: "XOF", country: "BJ", customer_name: name, customer_email: email,
    description: "HOLYVIEW " + tier.toUpperCase() + " - abonnement mensuel",
    return_url: back.toString(),
    metadata: { holyview_payment_id: p.id, tier, product: "HOLYVIEW" },
  };
  if (phone) requestBody.customer_phone = phone;

  let result: { response: Response; payload: Record<string, any> };
  try { result = await saspay("/checkout-sessions/", { method: "POST", body: JSON.stringify(requestBody) }); }
  catch (e) {
    await db.from("payments").update({ metadata: { ...baseMeta, checkout_creation_uncertain: true } }).eq("id", p.id).eq("status", "pending");
    return reply(503, { ok: false, paymentId: p.id, error: e instanceof Error ? e.message : "Réponse SasPay incertaine. Ne relance pas le paiement." });
  }

  const { response, payload } = result;
  if (!response.ok || payload.success !== true) {
    const definitive = (response.status >= 400 && response.status < 500 && response.status !== 429) || response.ok;
    if (definitive) await markFailed(db, String(p.id), { ...baseMeta, failure_reason: "saspay_rejected", http_status: response.status });
    else await db.from("payments").update({ metadata: { ...baseMeta, checkout_creation_uncertain: true, provider_http_status: response.status } }).eq("id", p.id).eq("status", "pending");
    console.warn("SasPay checkout rejected", response.status, payload.error?.code ?? "no_provider_code");
    return reply(response.status === 401 || response.status === 403 ? 502 : 400, {
      ok: false,
      error: response.status === 401 || response.status === 403
        ? "SasPay a refusé la clé API ou sa portée. Vérifie qu’elle autorise l’encaissement (PAYIN)."
        : definitive ? "SasPay n’a pas accepté la session. Vérifie le compte marchand et les champs requis."
        : "La réponse SasPay est incertaine. Ne relance pas le paiement avant vérification.",
    });
  }

  const sid = String(payload.data?.id ?? "");
  const link = checkoutUrl(payload.data?.checkout_url);
  if (!/^[0-9a-f-]{36}$/i.test(sid) || !link || Number(payload.data?.amount) !== Number(offer.monthly_price_xof)
      || String(payload.data?.currency ?? "").toUpperCase() !== "XOF") {
    await db.from("payments").update({ metadata: { ...baseMeta, checkout_creation_uncertain: true } }).eq("id", p.id).eq("status", "pending");
    return reply(502, { ok: false, paymentId: p.id, error: "Session SasPay incomplète ou montant inattendu. Aucun lien n’a été ouvert ; vérification requise." });
  }

  const { error: saveError } = await db.from("payments").update({
    provider_reference: sid,
    metadata: { ...baseMeta, checkout_url: link, checkout_expires_at: payload.data?.expires_at ?? null },
  }).eq("id", p.id).eq("status", "pending");
  if (saveError) {
    console.error("HOLYVIEW could not save checkout session", saveError.code);
    return reply(500, { ok: false, paymentId: p.id, error: "La session a été créée mais son enregistrement a échoué. Ne paie pas une deuxième fois ; contacte l’assistance." });
  }
  return reply(200, { ok: true, paymentId: p.id, tier, amount: Number(offer.monthly_price_xof), currency: "XOF", checkoutUrl: link, testMode: TEST_KEY });
}

function constantTimeHexEqual(a: string, b: string) {
  if (!/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b)) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function validWebhook(raw: string, signature: string, timestamp: string) {
  if (!SASPAY_WEBHOOK_SECRET || !/^\d{10}$/.test(timestamp) || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SASPAY_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp + "." + raw));
  const expected = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  return constantTimeHexEqual(signature.toLowerCase(), expected);
}
async function webhook(req: Request, raw: string) {
  if (!SASPAY_WEBHOOK_SECRET) return reply(503, { ok: false, error: "Le secret de signature SasPay n’est pas encore configuré dans Supabase." });
  if (!await validWebhook(raw, req.headers.get("X-Webhook-Signature") ?? "", req.headers.get("X-Webhook-Timestamp") ?? "")) {
    return reply(401, { ok: false, error: "Signature webhook invalide ou expirée." });
  }
  let event: Record<string, any>;
  try { event = JSON.parse(raw); } catch { return reply(400, { ok: false, error: "Corps webhook invalide." }); }
  if (event.event === "webhook.test") return reply(200, { ok: true });
  if (event.event !== "transaction.success" || String(event.data?.status ?? "").toUpperCase() !== "SUCCESS") {
    return reply(200, { ok: true, ignored: true });
  }
  const d = event.data ?? {};
  if (d.currency && String(d.currency).toUpperCase() !== "XOF") return reply(200, { ok: true, ignored: true });

  // A webhook only triggers activation when reference exactly matches a stored session UUID.
  // Otherwise, the authenticated status-check flow reconciles it after return.
  const ref = String(d.reference ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(ref)) return reply(200, { ok: true, ignored: true });
  const db = admin();
  const { data: p, error } = await db.from("payments")
    .select("id,user_id,provider,provider_reference,amount,currency,status,metadata,subscription_id")
    .eq("provider", "saspay").eq("provider_reference", ref).maybeSingle();
  if (error || !p || (d.amount !== undefined && Number(d.amount) !== Number(p.amount)) || p.currency !== "XOF") {
    return reply(200, { ok: true, ignored: true });
  }
  if (p.status === "succeeded") return reply(200, { ok: true, alreadyProcessed: true });
  try {
    const s = await sessionStatus(String(p.provider_reference));
    if (!paid(s)) return reply(200, { ok: true, awaitingConfirmation: true });
    await activate(db, p);
    return reply(200, { ok: true });
  } catch {
    return reply(503, { ok: false, error: "Confirmation différée ; SasPay peut réessayer le webhook." });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { ok: false, error: "Méthode non autorisée." });
  if (!URL || !ANON || !SERVICE) return reply(500, { ok: false, error: "Configuration serveur Supabase incomplète." });

  let raw = "";
  try { raw = await req.text(); } catch { return reply(400, { ok: false, error: "Impossible de lire la requête." }); }
  if (req.headers.has("X-Webhook-Signature") || req.headers.has("X-Webhook-Timestamp")) return await webhook(req, raw);

  let body: Record<string, any>;
  try { body = JSON.parse(raw); } catch { return reply(400, { ok: false, error: "Corps JSON invalide." }); }
  const action = String(body.action ?? "");
  const db = admin();

  if (action === "config") {
    let enabled = false;
    try { enabled = await paymentsEnabled(db); } catch { /* keep closed */ }
    return reply(200, { ok: true, provider: "saspay", configured: !!SASPAY_API_KEY, paymentsEnabled: enabled || TEST_KEY, productionEnabled: enabled, testMode: TEST_KEY, webhookConfigured: !!SASPAY_WEBHOOK_SECRET });
  }
  if (!["create_checkout", "check_payment"].includes(action)) {
    return body.event ? await webhook(req, raw) : reply(400, { ok: false, error: "Action de paiement inconnue." });
  }

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return reply(401, { ok: false, error: "Connecte-toi pour gérer un abonnement." });
  const authClient = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return reply(401, { ok: false, error: "Session invalide. Reconnecte-toi." });

  if (action === "create_checkout") return await createCheckout(db, data.user, String(body.tier ?? "").toLowerCase());
  return await checkPayment(db, data.user.id, String(body.paymentId ?? ""));
});
