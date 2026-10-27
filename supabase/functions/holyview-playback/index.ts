import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "holyview-private";
const TRIAL_SECONDS = 5 * 60 * 60;
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

  try {
    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) return reply(401, { error: "Connecte-toi pour lire ce contenu." });
    const authClient = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return reply(401, { error: "Session invalide. Reconnecte-toi." });
    const user = authData.user;
    const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await req.json();
    const action = String(body?.action || "");

    const { data: adminRole } = await admin.from("admin_users").select("role").eq("user_id", user.id).maybeSingle();
    const isAdmin = !!adminRole;

    const { data: activeSubs, error: subError } = await admin.from("subscriptions")
      .select("tier,status,starts_at,ends_at").eq("user_id", user.id).eq("status", "active");
    if (subError) return reply(500, { error: "Impossible de vérifier l’abonnement." });
    const now = new Date();
    const activeSub = (activeSubs || []).find((s: any) =>
      (!s.starts_at || new Date(s.starts_at) <= now) && (!s.ends_at || new Date(s.ends_at) > now)
    );
    const paidTier = activeSub && ["pro", "elite"].includes(activeSub.tier) ? activeSub.tier : null;
    const { data: trial } = await admin.from("trial_usage").select("used_seconds").eq("user_id", user.id).maybeSingle();
    const usedSeconds = Number(trial?.used_seconds || 0);
    const remaining = Math.max(0, TRIAL_SECONDS - usedSeconds);

    if (action === "authorize") {
      const mediaType = String(body?.mediaType || "");
      const mediaId = String(body?.mediaId || "");
      if (!["movie", "track"].includes(mediaType) || !/^[0-9a-f-]{36}$/i.test(mediaId)) {
        return reply(400, { error: "Référence de média invalide." });
      }
      if (!isAdmin && !paidTier && remaining <= 0) {
        return reply(403, { code: "TRIAL_EXHAUSTED", error: "Tes cinq heures d’essai sont terminées. Choisis PRO ou ELITE pour continuer." });
      }
      const table = mediaType === "movie" ? "movies" : "music_tracks";
      const pathColumn = mediaType === "movie" ? "video_asset_path" : "audio_asset_path";
      const { data: media, error: mediaError } = await admin.from(table).select("id,title,status,allow_offline_download," + pathColumn).eq("id", mediaId).maybeSingle();
      if (mediaError || !media) return reply(404, { error: "Ce contenu est introuvable." });
      if (!isAdmin && media.status !== "published") return reply(404, { error: "Ce contenu n’est pas disponible." });
      const storagePath = (media as any)[pathColumn];
      if (!storagePath) return reply(409, { error: "Aucun fichier média n’est associé à ce contenu." });
      const { data: signed, error: signedError } = await admin.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
      if (signedError || !signed?.signedUrl) return reply(502, { error: "Impossible de préparer la lecture sécurisée." });

      await admin.from("playback_sessions").update({ status: "stopped" }).eq("user_id", user.id).eq("status", "active");
      const { data: session, error: sessionError } = await admin.from("playback_sessions").insert({
        user_id: user.id, media_type: mediaType, media_id: mediaId, started_at: now.toISOString(),
        last_heartbeat_at: now.toISOString(), used_seconds: 0, status: "active",
      }).select("id").single();
      if (sessionError || !session) return reply(500, { error: "Impossible d’ouvrir la session de lecture." });
      return reply(200, {
        url: signed.signedUrl, sessionId: session.id, title: media.title, mediaType,
        tier: isAdmin ? "admin" : paidTier || "free", trialRemainingSeconds: isAdmin || paidTier ? null : remaining,
        offlineAllowed: isAdmin || (activeSub?.tier === "elite" && media.allow_offline_download === true),
        expiresIn: 3600,
      });
    }

    if (action === "heartbeat" || action === "stop") {
      const sessionId = String(body?.sessionId || "");
      if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return reply(400, { error: "Session de lecture invalide." });
      const { data: session, error: sessionError } = await admin.from("playback_sessions").select("*").eq("id", sessionId).eq("user_id", user.id).maybeSingle();
      if (sessionError || !session) return reply(404, { error: "Session de lecture introuvable." });
      if (action === "stop") {
        await admin.from("playback_sessions").update({ status: "stopped", last_heartbeat_at: now.toISOString() }).eq("id", sessionId).eq("user_id", user.id);
        return reply(200, { ok: true });
      }
      if (session.status !== "active") return reply(409, { stopped: true, error: "Cette session de lecture est terminée." });
      const elapsed = Math.max(0, Math.min(45, Math.floor((now.getTime() - new Date(session.last_heartbeat_at).getTime()) / 1000)));
      let newUsed = usedSeconds;
      if (!isAdmin && !paidTier && elapsed > 0) {
        newUsed = Math.min(TRIAL_SECONDS, usedSeconds + elapsed);
        const { error: trialUpdateError } = await admin.from("trial_usage").update({
          used_seconds: newUsed, exhausted_at: newUsed >= TRIAL_SECONDS ? now.toISOString() : null, updated_at: now.toISOString()
        }).eq("user_id", user.id);
        if (trialUpdateError) return reply(500, { error: "Impossible d’actualiser le compteur d’essai." });
      }
      const { error: sessionUpdateError } = await admin.from("playback_sessions").update({
        used_seconds: Number(session.used_seconds || 0) + elapsed, last_heartbeat_at: now.toISOString(),
        status: (!isAdmin && !paidTier && newUsed >= TRIAL_SECONDS) ? "stopped" : "active",
      }).eq("id", sessionId).eq("user_id", user.id);
      if (sessionUpdateError) return reply(500, { error: "Impossible d’actualiser la session." });
      const trialRemainingSeconds = isAdmin || paidTier ? null : Math.max(0, TRIAL_SECONDS - newUsed);
      if (!isAdmin && !paidTier && newUsed >= TRIAL_SECONDS) {
        return reply(200, { stopped: true, trialRemainingSeconds: 0, error: "Ton essai gratuit est terminé. Passe à PRO ou ELITE pour continuer." });
      }
      return reply(200, { ok: true, trialRemainingSeconds, elapsedSeconds: elapsed, tier: isAdmin ? "admin" : paidTier || "free" });
    }

    return reply(400, { error: "Action non prise en charge." });
  } catch (error) {
    console.error("holyview-playback", error);
    return reply(500, { error: "Une erreur interne est survenue pendant le contrôle de lecture." });
  }
});
