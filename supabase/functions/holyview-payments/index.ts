import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import kkiapay from "npm:@kkiapay-org/nodejs-sdk@1.0.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kkiapay-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: cors });
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const authClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
type AnyRecord = Record<string, any>;

function settingText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  return String(value);
}
function settingBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return fallback;
}
function equalSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function readSettings(keys: string[]) {
  const { data, error } = await admin.from("settings").select("key,value").in("key", keys);
  if (error) throw new Error("Impossible de lire la configuration de paiement.");
  return Object.fromEntries((data || []).map((row: AnyRecord) => [row.key, row.value]));
}
async function paymentConfig() {
  const settings = await readSettings(["payments_enabled", "kkiapay_public_key", "kkiapay_sandbox"]);
  const publicKey = settingText(settings.kkiapay_public_key) || settingText(Deno.env.get("KKIAPAY_PUBLIC_KEY"));
  const sandbox = settingBool(settings.kkiapay_sandbox, true);
  const privateKey = settingText(Deno.env.get("KKIAPAY_PRIVATE_KEY"));
  const secretKey = settingText(Deno.env.get("KKIAPAY_SECRET_KEY"));
  const webhookSecret = settingText(Deno.env.get("KKIAPAY_WEBHOOK_SECRET"));
  return {
    enabled: settingBool(settings.payments_enabled, false),
    publicKey,
    sandbox,
    privateKey,
    secretKey,
    webhookSecret,
    configured: !!(publicKey && privateKey && secretKey && webhookSecret),
  };
}
async function getAuthenticatedUser(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}
function createGateway(config: AnyRecord) {
  return kkiapay({
    privatekey: config.privateKey,
    publickey: config.publicKey,
    secretkey: config.secretKey,
    sandbox: config.sandbox,
  });
}
function txObject(response: AnyRecord): AnyRecord {
  return response?.data && typeof response.data === "object" ? response.data : response;
}
function transactionIdOf(value: unknown): string {
  return String(value || "").trim();
}
function verifiedReference(tx: AnyRecord): string {
  return transactionIdOf(tx.externalTransactionId || tx.partnerId || tx.external_transaction_id || "");
}
function transactionSucceeded(tx: AnyRecord): boolean {
  return String(tx.status || tx.state || "").toUpperCase() === "SUCCESS";
}
async function lookupPayment(paymentId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(paymentId)) return null;
  const { data, error } = await admin.from("payments")
    .select("id,user_id,subscription_id,provider,provider_reference,amount,currency,status,metadata")
    .eq("id", paymentId).eq("provider", "kkiapay").maybeSingle();
  if (error) throw new Error("Impossible de retrouver cette demande de paiement.");
  return data as AnyRecord | null;
}
async function markFailed(payment: AnyRecord, transactionId: string, reason: string) {
  const meta = { ...(payment.metadata || {}), last_provider_status: reason, checked_at: new Date().toISOString() };
  await admin.from("payments").update({
    provider_reference: transactionId || payment.provider_reference,
    status: "failed",
    metadata: meta,
  }).eq("id", payment.id);
  if (payment.subscription_id) {
    await admin.from("subscriptions").update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", payment.subscription_id).eq("status", "pending");
  }
}
async function activateVerifiedPayment(payment: AnyRecord, tx: AnyRecord, transactionId: string) {
  const expectedPartner = String(payment.metadata?.partner_id || payment.id);
  const actualPartner = verifiedReference(tx);
  if (actualPartner !== expectedPartner) {
    return reply(409, { ok: false, code: "PAYMENT_REFERENCE_MISMATCH", error: "Le fournisseur n’a pas confirmé la référence de cette demande. Attends la notification sécurisée ou contacte le support." });
  }
  if (!transactionSucceeded(tx)) {
    const status = String(tx.status || tx.state || "PENDING").toUpperCase();
    if (status === "FAILED" || status === "REVERTED") await markFailed(payment, transactionId, status);
    return reply(202, { ok: false, pending: true, code: "PAYMENT_NOT_CONFIRMED", error: "Le paiement n’est pas encore confirmé. N’effectue pas un second paiement ; attends quelques instants et actualise ton espace." });
  }
  const confirmedAmount = Number(tx.amount);
  if (!Number.isFinite(confirmedAmount) || confirmedAmount !== Number(payment.amount)) {
    return reply(409, { ok: false, code: "PAYMENT_AMOUNT_MISMATCH", error: "Le montant confirmé ne correspond pas au tarif attendu. L’abonnement n’a pas été activé." });
  }
  const { data: existing, error: existingError } = await admin.from("payments")
    .select("id").eq("provider_reference", transactionId).maybeSingle();
  if (existingError) return reply(500, { error: "Impossible de vérifier l’unicité de la transaction." });
  if (existing && existing.id !== payment.id) {
    return reply(409, { ok: false, code: "TRANSACTION_ALREADY_USED", error: "Cette transaction est déjà associée à une autre demande." });
  }
  const now = new Date();
  const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const metadata = {
    ...(payment.metadata || {}),
    verified_by_server: true,
    verified_status: String(tx.status || ""),
    payment_method: tx.source || tx.method || null,
    verified_at: now.toISOString(),
  };
  const { error: paymentError } = await admin.from("payments").update({
    provider_reference: transactionId,
    status: "succeeded",
    metadata,
  }).eq("id", payment.id);
  if (paymentError) return reply(500, { error: "Paiement confirmé, mais son enregistrement a échoué. Le webhook va réessayer ; ne repaie pas." });
  if (payment.subscription_id) {
    await admin.from("subscriptions").update({ status: "expired", updated_at: now.toISOString() })
      .eq("user_id", payment.user_id).eq("status", "active").neq("id", payment.subscription_id);
    const { error: subError } = await admin.from("subscriptions").update({
      status: "active",
      starts_at: now.toISOString(),
      ends_at: end.toISOString(),
      updated_at: now.toISOString(),
    }).eq("id", payment.subscription_id).eq("user_id", payment.user_id);
    if (subError) return reply(500, { error: "Paiement confirmé, mais l’activation doit être reprise. Le webhook va réessayer ; ne repaie pas." });
  }
  return reply(200, { ok: true, verified: true, tier: String(payment.metadata?.plan_tier || ""), startsAt: now.toISOString(), endsAt: end.toISOString() });
}
async function verifyProviderTransaction(config: AnyRecord, txId: string) {
  const gateway = createGateway(config);
  const result = await gateway.verify(txId);
  return txObject(result as AnyRecord);
}
async function startPayment(user: AnyRecord, reqBody: AnyRecord) {
  const config = await paymentConfig();
  if (!config.enabled) return reply(503, { ok: false, code: "PAYMENTS_DISABLED", error: "Le paiement en ligne n’est pas encore activé par HOLYVIEW." });
  if (!config.configured) return reply(503, { ok: false, code: "PAYMENTS_NOT_CONFIGURED", error: "Le compte marchand n’est pas encore entièrement configuré. Aucun paiement n’a été lancé." });
  const tier = String(reqBody.tier || "").toLowerCase();
  if (!["pro", "elite"].includes(tier)) return reply(400, { error: "Choisis la formule PRO ou ELITE." });
  const { data: offer, error: offerError } = await admin.from("subscription_offers")
    .select("tier,monthly_price_xof,is_listed").eq("tier", tier).eq("is_listed", true).maybeSingle();
  if (offerError || !offer) return reply(404, { error: "Cette formule n’est pas disponible." });
  const amount = Number(offer.monthly_price_xof);
  if (!Number.isSafeInteger(amount) || amount < 1) return reply(409, { code: "PLAN_PRICE_NOT_SET", error: "Le tarif mensuel de cette formule n’a pas encore été fixé par HOLYVIEW." });
  const { data: currentSubs, error: subReadError } = await admin.from("subscriptions")
    .select("tier,status,starts_at,ends_at").eq("user_id", user.id).eq("status", "active");
  if (subReadError) return reply(500, { error: "Impossible de vérifier l’abonnement actuel." });
  const now = new Date();
  const current = (currentSubs || []).find((s: AnyRecord) =>
    ["pro", "elite"].includes(s.tier) &&
    (!s.starts_at || new Date(s.starts_at) <= now) &&
    (!s.ends_at || new Date(s.ends_at) > now)
  );
  if (current?.tier === tier) return reply(409, { code: "PLAN_ALREADY_ACTIVE", error: "Cette formule est déjà active sur ton compte. Consulte ton espace avant de renouveler." });
  if (current?.tier === "elite" && tier === "pro") return reply(409, { code: "ELITE_ALREADY_ACTIVE", error: "Ta formule ELITE est déjà active. Tu pourras choisir PRO à son expiration." });
  const { data: subscription, error: newSubError } = await admin.from("subscriptions")
    .insert({ user_id: user.id, tier, status: "pending", starts_at: null, ends_at: null })
    .select("id").single();
  if (newSubError || !subscription) return reply(500, { error: "Impossible de préparer l’abonnement." });
  const { data: payment, error: newPaymentError } = await admin.from("payments")
    .insert({
      user_id: user.id,
      subscription_id: subscription.id,
      provider: "kkiapay",
      amount,
      currency: "XOF",
      status: "pending",
      metadata: { plan_tier: tier, subscription_id: subscription.id },
    })
    .select("id").single();
  if (newPaymentError || !payment) {
    await admin.from("subscriptions").update({ status: "expired" }).eq("id", subscription.id);
    return reply(500, { error: "Impossible d’enregistrer la demande de paiement." });
  }
  const metadata = { plan_tier: tier, subscription_id: subscription.id, partner_id: payment.id };
  const { error: metaError } = await admin.from("payments").update({ metadata }).eq("id", payment.id);
  if (metaError) return reply(500, { error: "La demande a été créée, mais la référence de paiement n’a pas pu être préparée." });
  return reply(200, {
    ok: true,
    paymentId: payment.id,
    partnerId: payment.id,
    tier,
    amount,
    currency: "XOF",
    publicKey: config.publicKey,
    sandbox: config.sandbox,
  });
}
async function clientVerify(user: AnyRecord, body: AnyRecord) {
  const paymentId = String(body.paymentId || "");
  const transactionId = transactionIdOf(body.transactionId);
  if (!/^[0-9a-f-]{36}$/i.test(paymentId) || !transactionId || transactionId.length > 180) {
    return reply(400, { error: "Référence du paiement invalide." });
  }
  const payment = await lookupPayment(paymentId);
  if (!payment || payment.user_id !== user.id) return reply(404, { error: "Cette demande de paiement ne t’appartient pas." });
  if (payment.status === "succeeded" && payment.provider_reference === transactionId) {
    const { data: sub } = await admin.from("subscriptions").select("tier,starts_at,ends_at").eq("id", payment.subscription_id).maybeSingle();
    if (sub?.ends_at && new Date(sub.ends_at) > new Date()) return reply(200, { ok: true, verified: true, tier: sub.tier, startsAt: sub.starts_at, endsAt: sub.ends_at });
  }
  const config = await paymentConfig();
  if (!config.configured) return reply(503, { error: "La vérification du compte marchand n’est pas configurée." });
  let tx: AnyRecord;
  try {
    tx = await verifyProviderTransaction(config, transactionId);
  } catch (error) {
    console.error("KKiaPay transaction verification failed", error);
    return reply(502, { ok: false, pending: true, error: "La vérification KKiaPay est momentanément indisponible. Ne repaie pas ; attends la notification sécurisée." });
  }
  return await activateVerifiedPayment(payment, tx, transactionId);
}
async function handleWebhook(req: Request) {
  const config = await paymentConfig();
  const incomingSecret = req.headers.get("x-kkiapay-secret") || "";
  if (!config.webhookSecret || !equalSecret(incomingSecret, config.webhookSecret)) {
    return reply(401, { error: "Signature webhook invalide." });
  }
  let event: AnyRecord;
  try { event = await req.json(); } catch { return reply(400, { error: "Événement webhook invalide." }); }
  const partnerId = String(event.partnerId || "");
  const transactionId = transactionIdOf(event.transactionId);
  if (!/^[0-9a-f-]{36}$/i.test(partnerId) || !transactionId) return reply(400, { error: "Référence webhook invalide." });
  const payment = await lookupPayment(partnerId);
  if (!payment) return reply(404, { error: "Demande de paiement introuvable." });
  if (payment.status === "succeeded" && payment.provider_reference === transactionId) return reply(200, { ok: true, duplicate: true });
  if (Number(event.amount) !== Number(payment.amount)) return reply(409, { error: "Montant webhook différent du montant attendu." });
  const success = event.isPaymentSucces === true || String(event.event || "").toLowerCase() === "transaction.success";
  if (!success) {
    await markFailed(payment, transactionId, String(event.event || event.failureCode || "FAILED"));
    return reply(200, { ok: true, processed: "failed" });
  }
  if (!config.configured) return reply(503, { error: "La vérification serveur de KKiaPay n’est pas configurée." });
  let tx: AnyRecord;
  try { tx = await verifyProviderTransaction(config, transactionId); }
  catch (error) {
    console.error("KKiaPay webhook verification failed", error);
    return reply(502, { error: "Impossible de confirmer la transaction auprès de KKiaPay." });
  }
  return await activateVerifiedPayment(payment, tx, transactionId);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Méthode non autorisée." });
  try {
    if (req.headers.has("x-kkiapay-secret")) return await handleWebhook(req);
    let body: AnyRecord;
    try { body = await req.json(); } catch { return reply(400, { error: "Requête invalide." }); }
    const action = String(body.action || "");
    if (action === "config") {
      const config = await paymentConfig();
      return reply(200, { paymentsEnabled: config.enabled, configured: config.configured, sandbox: config.sandbox });
    }
    const user = await getAuthenticatedUser(req);
    if (!user) return reply(401, { error: "Connecte-toi avant de choisir un abonnement." });
    if (action === "start") return await startPayment(user, body);
    if (action === "verify") return await clientVerify(user, body);
    return reply(400, { error: "Action de paiement non prise en charge." });
  } catch (error) {
    console.error("holyview-payments", error);
    return reply(500, { error: "Une erreur interne a empêché le traitement du paiement." });
  }
});
