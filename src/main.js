import { createClient } from '@supabase/supabase-js';
import { getCountries, getCountryCallingCode, isValidPhoneNumber, parsePhoneNumber } from 'libphonenumber-js';
import './style.css';
import { attachAdminDashboard } from './admin.js';
import { attachPlayer } from './player.js';

const SUPABASE_URL = 'https://rewzjcmaexthotbimacu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_SWMO0_i6w4hNMfO5O_0vJg_A2qwvhTF';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const $ = (id) => document.getElementById(id);
const regionNames = new Intl.DisplayNames(['fr'], { type: 'region' });
const countryOptions = getCountries().map(code => ({ code, name: regionNames.of(code) || code, dial: '+' + getCountryCallingCode(code) }))
  .sort((a,b) => a.name.localeCompare(b.name, 'fr'));
let movies=[], tracks=[], currentUser=null, authMode='login', subscriptionOffers=[];
const esc = (s='') => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.remove('show'),3600)}
function logo(){return '<a class="brand" href="#home" aria-label="HOLYVIEW accueil"><img src="/holyview-logo.svg" alt=""><span>HOLY<b>VIEW</b></span></a>'}
function card(item,kind){const title=esc(item.title),img=esc(item.poster_path||item.image_path||'/holyview-logo.svg'),tier=item.required_tier||'free',access=tier!=='free'?'<span class="access-badge '+esc(tier)+'">'+esc(tier.toUpperCase())+'</span>':'';return '<article class="card" role="button" tabindex="0" data-id="'+esc(item.id)+'" data-kind="'+kind+'"><div class="poster"><img loading="lazy" src="'+img+'" alt="'+title+'" onerror="this.hidden=true"><span class="poster-label">'+esc(item.tag||(kind==='track'?'MUSIQUE':'FILM'))+'</span>'+access+'<span class="poster-play">▶</span></div><h3>'+title+'</h3><p>'+(kind==='track'?esc(item.artist_name||item.artists?.name||'Musique chrétienne'):esc(item.release_year||'Film chrétien'))+'</p></article>'}
function render(){
 const q=($('searchInput')?.value||'').trim().toLocaleLowerCase('fr');
 const filteredMovies=movies.filter(x=>(x.title+' '+(x.synopsis||'')).toLocaleLowerCase('fr').includes(q));
 const filteredTracks=tracks.filter(x=>(x.title+' '+(x.artist_name||x.artists?.name||'')).toLocaleLowerCase('fr').includes(q));
 $('videoCards').innerHTML=filteredMovies.filter(x=>x.display_format!=='short').slice(0,30).map(x=>card(x,'movie')).join('')||'<div class="empty">Aucune vidéo classique publiée pour le moment.</div>';
 $('shortCards').innerHTML=filteredMovies.filter(x=>x.display_format==='short').slice(0,30).map(x=>card(x,'movie')).join('')||'<div class="empty">Aucun Short publié pour le moment.</div>';
 $('musicCards').innerHTML=filteredTracks.slice(0,5).map(x=>card(x,'track')).join('')||'<div class="empty">La sélection musicale apparaîtra ici après publication des pistes.</div>';
 $('catalogue').innerHTML=[...filteredMovies.map(x=>card(x,'movie')),...filteredTracks.map(x=>card(x,'track'))].join('')||'<div class="empty">Aucun résultat. Essaie une autre recherche.</div>';
}
async function loadCatalog(){
 const [m,t]=await Promise.all([
  supabase.from('movies').select('id,title,slug,synopsis,poster_path,preview_asset_path,duration_seconds,release_year,status,is_featured,display_format,preview_duration_seconds,clip_start_seconds,clip_end_seconds,subtitles,required_tier').eq('status','published').order('is_featured',{ascending:false}).limit(100),
  supabase.from('music_tracks').select('id,title,duration_seconds,artist_id,required_tier,artists(name,image_path)').eq('status','published').limit(30)
 ]);
 const {data:stats}=await supabase.from('movie_stats').select('movie_id,view_count,like_count,comment_count,share_count');
 const statsById=new Map((stats||[]).map(x=>[x.movie_id,x]));
 movies=(m.data||[]).map(x=>({...x,stats:statsById.get(x.id)||{},required_tier:x.required_tier||'free',tag:x.display_format==='short'?'SHORT':x.is_featured?'À LA UNE':'VIDÉO'}));
 tracks=(t.data||[]).map(x=>({...x,required_tier:x.required_tier||'free',artist_name:x.artists?.name,poster_path:x.artists?.image_path,tag:'MUSIQUE'}));
 render();
}

let activeDetailMovie=null, detailPreviewUrl=null;
async function openVideoDetails(item){
 activeDetailMovie=item;
 const modal=$('videoDetailModal'),video=$('detailPreview');
 $('detailTitle').textContent=item.title||'Vidéo HOLYVIEW';
 $('detailFormat').textContent=item.display_format==='short'?'SHORT · format vertical':'VIDÉO · cadrage préservé';
 $('detailSynopsis').textContent=item.synopsis||'Un contenu vidéo de HOLYVIEW.';
 $('detailPreviewMessage').textContent='Chargement de l’aperçu…';
 $('detailFullWatch').hidden=!currentUser;
 $('detailLike').disabled=false;$('detailLike').textContent=currentUser?'♡ J’aime':'♡ J’aime · se connecter';
 $('detailCommentForm').hidden=!currentUser;
 $('detailJoin').hidden=!!currentUser;
 $('detailJoin').onclick=()=>openAuth('signup');
 $('detailPreview').classList.toggle('detail-short',item.display_format==='short');
 $('detailVideoStage').classList.toggle('detail-short-stage',item.display_format==='short');
 modal.hidden=false; document.body.classList.add('modal-open');
 if(detailPreviewUrl){URL.revokeObjectURL(detailPreviewUrl);detailPreviewUrl=null}
 video.pause();video.removeAttribute('src');video.load();
 if(!item.preview_asset_path){
   $('detailPreviewMessage').textContent=currentUser?'Aperçu non ajouté pour le moment. Tu peux lancer la vidéo complète avec le bouton ci-dessous.':'L’aperçu de ce contenu est en préparation. Crée un compte pour accéder à la lecture complète selon les droits de HOLYVIEW.';
 }else try{
   const result=await supabase.functions.invoke('holyview-preview',{body:{movieId:item.id}});
   if(result.error||!result.data?.url)throw new Error(result.data?.error||'Aucun aperçu disponible pour cette vidéo.');
   video.src=result.data.url;video.load();
   $('detailPreviewMessage').textContent='Aperçu public · '+Math.round(result.data.previewDurationSeconds||30)+' secondes maximum.';
   video.ontimeupdate=()=>{if(video.currentTime>=Number(result.data.previewDurationSeconds||30)){video.pause();video.currentTime=0}};
   video.play().catch(()=>{});
 }catch(err){$('detailPreviewMessage').textContent=err.message||'Aperçu indisponible. Connecte-toi pour découvrir les contenus disponibles.'}
 await refreshDetailStats();
 if(currentUser)await loadDetailComments();else{$('detailCommentsList').innerHTML='<p class="detail-muted">Inscris-toi ou connecte-toi pour voir et publier les commentaires.</p>'}
}
async function refreshDetailStats(){
 if(!activeDetailMovie)return;
 const {data}=await supabase.from('movie_stats').select('view_count,like_count,comment_count,share_count').eq('movie_id',activeDetailMovie.id).maybeSingle();
 const st=data||{};
 $('detailLikes').textContent=Number(st.like_count||0)+' likes';
 $('detailCommentCount').textContent=Number(st.comment_count||0);
 $('detailShares').textContent=Number(st.share_count||0)+' partages';
 const likeBtn=$('detailLike');
 if(!currentUser)likeBtn.textContent='♡ J’aime · se connecter';
 if(currentUser){
   const {data:like}=await supabase.from('video_likes').select('id').eq('movie_id',activeDetailMovie.id).eq('user_id',currentUser.id).maybeSingle();
   likeBtn.textContent=like?'♥ Aimé':'♡ J’aime';
 }
}
async function loadDetailComments(){
 if(!activeDetailMovie||!currentUser)return;
 const {data,error}=await supabase.from('video_comments').select('id,body,created_at,user_id').eq('movie_id',activeDetailMovie.id).eq('is_hidden',false).order('created_at',{ascending:false}).limit(100);
 if(error){$('detailCommentsList').innerHTML='<p class="detail-muted">Impossible de charger les commentaires.</p>';return}
 $('detailCommentsList').innerHTML=(data||[]).map(c=>'<article class="detail-comment"><small>Membre · '+esc(new Date(c.created_at).toLocaleDateString('fr-FR'))+'</small><p>'+esc(c.body)+'</p></article>').join('')||'<p class="detail-muted">Sois le premier à commenter cette vidéo.</p>';
}

function moneyXof(value){return new Intl.NumberFormat('fr-FR',{style:'currency',currency:'XOF',maximumFractionDigits:0}).format(Number(value||0))}
async function loadOffers(){
 const {data,error}=await supabase.from('subscription_offers').select('tier,monthly_price_xof,headline,description,features,is_listed').eq('is_listed',true);
 if(error)console.warn('HOLYVIEW subscription offers',error);
 const fallback=[
  {tier:'free',monthly_price_xof:0,headline:'Découvrir HOLYVIEW',description:'Une enveloppe de 5 heures de lecture offerte par compte.',features:['5 heures gratuites de visionnage et d’écoute','Aperçus des films et vidéos','Accès aux contenus classés Gratuit']},
  {tier:'pro',monthly_price_xof:1000,headline:'Profiter sans limite',description:'La formule pour regarder et écouter le catalogue courant sans compteur d’essai.',features:['Lecture illimitée des contenus Gratuit et PRO','Films, Shorts et musique disponibles','Plus de limite de 5 heures pendant l’abonnement']},
  {tier:'elite',monthly_price_xof:2000,headline:'Soutenir et tout découvrir',description:'Tout PRO, avec en plus les contenus réservés à ELITE.',features:['Tous les avantages PRO','Accès aux contenus marqués ELITE','Un accès premium aux nouveautés désignées par HOLYVIEW']}
 ];
 const rank={free:0,pro:1,elite:2};
 subscriptionOffers=(data?.length?data:fallback).sort((a,b)=>(rank[a.tier]??9)-(rank[b.tier]??9));
 renderOffers();
}
function renderOffers(){
 const grid=$('plansGrid');if(!grid)return;
 grid.innerHTML=subscriptionOffers.map(offer=>{
   const tier=offer.tier||'free';
   const price=tier==='free'?'Gratuit':offer.monthly_price_xof==null?'Tarif bientôt annoncé':moneyXof(offer.monthly_price_xof)+' / mois';
   const features=(offer.features||[]).map(feature=>'<li>'+esc(feature)+'</li>').join('');
   const action=tier==='free'?'Créer mon compte':'Choisir '+tier.toUpperCase();
   return '<article class="plan-card plan-'+esc(tier)+(tier==='elite'?' plan-featured':'')+'"><div class="plan-tier">'+esc(tier.toUpperCase())+'</div><h3>'+esc(offer.headline||tier.toUpperCase())+'</h3><p>'+esc(offer.description||'Formule HOLYVIEW')+'</p><div class="plan-price">'+esc(price)+'</div><ul>'+features+'</ul><button type="button" class="btn '+(tier==='elite'?'btn-pink':tier==='pro'?'btn-green':'btn-glass')+'" data-plan-select="'+esc(tier)+'">'+esc(action)+'</button></article>';
 }).join('');
}
function shouldShowEliteUpsell(userId, active){
 const key='holyview:eliteUpsell:last:'+userId;
 const now=Date.now();
 const started=Date.parse(active.starts_at||active.created_at||new Date(now).toISOString());
 try{
  const last=Number(localStorage.getItem(key)||0);
  const reference=last>0?last:started;
  if(!Number.isFinite(reference)||now-reference<14*24*60*60*1000)return false;
  localStorage.setItem(key,String(now));
  return true;
 }catch{
  return Number.isFinite(started)&&now-started>=14*24*60*60*1000;
 }
}
function renderTrialMembershipStatus(remainingSeconds){
 const panel=$('memberPlanBanner');if(!panel||!currentUser)return;
 const rem=Math.max(0,Number(remainingSeconds)||0);
 const hours=Math.floor(rem/3600),minutes=Math.floor((rem%3600)/60);
 if(rem<=0){
  panel.hidden=false;
  panel.innerHTML='<div><strong>Tes 5 heures gratuites sont terminées</strong><span>Choisis PRO à 1 000 FCFA/mois ou ELITE à 2 000 FCFA/mois pour continuer la lecture.</span></div><a href="#plans" class="member-status-action">Choisir mon abonnement</a>';
  return;
 }
 let advice='Compare PRO et ELITE pour continuer après ton essai gratuit.';
 if(rem<=1800)advice='Il te reste moins de 30 minutes. Prépare ton abonnement pour continuer sans interruption.';
 else if(rem<=3600)advice='Il te reste environ 1 heure. Passe à PRO ou ELITE pour poursuivre la lecture après l’essai.';
 else if(rem<=7200)advice='Il te reste environ 2 heures. Découvre PRO et ELITE avant la fin de ton essai.';
 else if(rem<=14400)advice='Il te reste environ 4 heures. Tu peux déjà comparer les abonnements.';
 panel.hidden=false;
 panel.innerHTML='<div><strong>Temps gratuit restant : '+hours+' h '+minutes+' min 🎬</strong><span>'+esc(advice)+'</span></div><a href="#plans" class="member-status-action">Voir les abonnements</a>';
}
async function updateMembershipStatus(user){
 const panel=$('memberPlanBanner');if(!panel)return;
 if(!user){panel.hidden=true;panel.innerHTML='';return}
 panel.hidden=false;panel.innerHTML='<strong>Ton espace HOLYVIEW</strong><span>Vérification de ta formule…</span>';
 try{
  const [subsResult,trialResult]=await Promise.all([
   supabase.from('subscriptions').select('tier,status,starts_at,ends_at,created_at').eq('user_id',user.id).eq('status','active'),
   supabase.from('trial_usage').select('used_seconds').eq('user_id',user.id).maybeSingle()
  ]);
  if(subsResult.error)throw subsResult.error;
  if(trialResult.error)throw trialResult.error;
  const now=new Date();
  const active=(subsResult.data||[])
   .filter(s=>!!s.starts_at&&!!s.ends_at&&new Date(s.starts_at)<=now&&new Date(s.ends_at)>now)
   .sort((a,b)=>({free:0,pro:1,elite:2}[b.tier]||0)-({free:0,pro:1,elite:2}[a.tier]||0))[0]||null;
  const tier=active&&['pro','elite'].includes(active.tier)?active.tier:'free';
  const used=Number(trialResult.data?.used_seconds||0);
  const rem=Math.max(0,18000-used);
  if(tier==='free'){renderTrialMembershipStatus(rem);return}
  const dateLabel=active.ends_at?new Date(active.ends_at).toLocaleDateString('fr-FR'):'';
  const daysToEnd=active.ends_at?Math.ceil((new Date(active.ends_at).getTime()-now.getTime())/86400000):null;
  if(daysToEnd!==null&&daysToEnd<=7&&daysToEnd>=0){
   panel.innerHTML='<div><strong>Attention : ton abonnement '+esc(tier.toUpperCase())+' se termine dans '+daysToEnd+' jour'+(daysToEnd>1?'s':'')+' ⏳</strong><span>Fin prévue le '+esc(dateLabel)+'. Prépare le renouvellement pour conserver tes avantages.</span></div><a href="#plans" class="member-status-action">Voir les abonnements</a>';
   return;
  }
  if(tier==='pro'&&shouldShowEliteUpsell(user.id,active)){
   panel.innerHTML='<div><strong>Découvre l’expérience ELITE ✨</strong><span>HOLYVIEW te propose de passer à ELITE pour accéder aussi aux contenus réservés à cette formule. Tarif : 2 000 FCFA/mois.</span></div><a href="#plans" class="member-status-action">Comparer avec ELITE</a>';
   return;
  }
  const end=active.ends_at?' · valable jusqu’au '+dateLabel:'';
  panel.innerHTML='<div><strong>Formule '+esc(tier.toUpperCase())+'</strong><span>Lecture sans compteur d’essai pour les contenus inclus dans ton abonnement'+esc(end)+'</span></div><a href="#plans" class="member-status-action">Gérer ma formule</a>';
 }catch(error){
  console.warn('HOLYVIEW membership status',error);
  panel.innerHTML='<div><strong>Ton espace HOLYVIEW</strong><span>Impossible de vérifier ta formule maintenant. Réessaie dans un instant.</span></div><a href="#plans" class="member-status-action">Voir les formules</a>';
 }
}

let paymentReturnInFlight = false;
let completedPaymentReturnId = null;

async function invokeSasPayAction(payload) {
 const result = await supabase.functions.invoke('holyview-payments', { body: payload });
 if(result.error) {
  let message = result.error.message || 'Le service de paiement est indisponible.';
  try {
   const ctx = result.error.context;
   const details = ctx?.clone ? await ctx.clone().json() : (ctx?.json ? await ctx.json() : null);
   if(details?.error) message = details.error;
  } catch {}
  throw new Error(message);
 }
 if(result.data?.ok === false && result.data?.error) throw new Error(result.data.error);
 return result.data || {};
}

function clearPaymentReturnParams(paymentId) {
 const url = new URL(location.href);
 if(url.searchParams.get('hv_payment_id') === paymentId) url.searchParams.delete('hv_payment_id');
 url.searchParams.delete('hv_payment_return');
 history.replaceState(history.state, '', url.pathname + url.search + url.hash);
}

function showPaymentPending(paymentId, message) {
 const panel = $('memberPlanBanner');
 if(!panel) return;
 panel.hidden = false;
 panel.innerHTML = '<div><strong>Paiement en cours de confirmation</strong><span>' + esc(message) + '</span></div><button type="button" class="btn btn-green" data-check-payment="' + esc(paymentId) + '">Vérifier le paiement</button>';
}

async function checkSasPayPayment(paymentId, fromReturn = false) {
 if(!/^[0-9a-f-]{36}$/i.test(paymentId)) {
  toast('La référence de paiement est invalide.');
  return;
 }
 if(!currentUser) {
  toast('Connecte-toi pour vérifier ton paiement.');
  openAuth('login');
  return;
 }
 try {
  const result = await invokeSasPayAction({ action: 'check_payment', paymentId });
  if(result.paid) {
   completedPaymentReturnId = paymentId;
   clearPaymentReturnParams(paymentId);
   if(result.testMode || result.activated === false) {
    toast('Test SasPay confirmé. Aucun abonnement réel n’a été activé.');
   } else {
    toast('Paiement confirmé ! Ta formule ' + String(result.tier || '').toUpperCase() + ' est activée.');
   }
   await updateMembershipStatus(currentUser);
   return;
  }
  if(result.terminal) {
   completedPaymentReturnId = paymentId;
   clearPaymentReturnParams(paymentId);
   toast('Cette session SasPay n’a pas abouti. Tu peux choisir une nouvelle session.');
   await updateMembershipStatus(currentUser);
   return;
  }
  showPaymentPending(paymentId, 'SasPay n’a pas encore confirmé le statut final. N’effectue pas un deuxième paiement ; vérifie à nouveau dans quelques instants.');
  if(fromReturn) toast('Retour de SasPay reçu. Le statut final est encore en attente de confirmation.');
 } catch(error) {
  showPaymentPending(paymentId, 'La confirmation n’a pas pu être récupérée. Ne paie pas à nouveau ; réessaie la vérification.');
  if(fromReturn) toast((error && error.message) || 'Vérification indisponible. Réessaie dans un instant.');
 }
}

async function processPaymentReturn() {
 const paymentId = new URL(location.href).searchParams.get('hv_payment_id');
 if(!paymentId || !currentUser || paymentReturnInFlight || completedPaymentReturnId === paymentId) return;
 paymentReturnInFlight = true;
 try { await checkSasPayPayment(paymentId, true); }
 finally { paymentReturnInFlight = false; }
}

window.addEventListener('holyview:trial-update',event=>renderTrialMembershipStatus(event.detail?.remainingSeconds));

function countrySelect(){return countryOptions.map(c=>'<option value="'+c.code+'">'+esc(c.name)+' ('+c.dial+')</option>').join('')}
async function renderApp(){
 $('app').innerHTML = `
 <header class="nav">${logo()}<nav class="links"><a class="active" href="#videos">Vidéos</a><a href="#shorts">Shorts</a><a id="musicNav" href="#music">Musiques</a><a href="#plans">Abonnements</a></nav><div class="navright"><button class="iconbtn" id="searchToggle" aria-label="Rechercher">⌕</button><span class="userchip" id="userChip" hidden></span><button class="btn btn-glass" id="authOpen">Se connecter</button><button class="btn btn-green" id="signupOpen">S’inscrire</button></div></header>
 <main><section class="hero" id="home"><div class="hero-content"><div class="eyebrow"><span class="dot"></span> JÉSUS AU CŒUR DE HOLYVIEW</div><h1 id="heroTitle">Des histoires<br>qui célèbrent<br><span class="pink">JÉSUS.</span></h1><p id="heroDescription">Le cinéma chrétien, les récits bibliques et la musique qui élève l’âme. Une expérience inspirée par Jésus, la lumière du monde.</p><div class="hero-benefits" id="heroBenefits"><span>✦ 5 heures gratuites après inscription</span><span>♫ Films, Shorts & musiques</span><span>♡ PRO et ELITE selon tes envies</span></div><div class="meta"><strong>✦ SÉLECTION HOLYVIEW</strong><span>•</span><span>Foi & inspiration</span><span class="tag">FR</span><span class="tag">FAMILLE</span></div><div class="actions"><button class="btn btn-pink" id="explore">▶ Explorer le catalogue</button><button class="btn btn-green hero-join" id="heroJoinNow">✦ Créer mon espace gratuit</button><button class="btn btn-glass" id="mission">＋ Notre mission</button></div></div><div class="jesus-showcase wordmark-stage" role="img" aria-label="Le nom Jésus en lettres dorées animées"><div class="showcase-orbit orbit-one"></div><div class="showcase-orbit orbit-two"></div><span class="showcase-spark spark-one">✦</span><span class="showcase-spark spark-two">✧</span><span class="showcase-spark spark-three">✦</span><div class="jesus-wordmark" aria-hidden="true"><span class="jesus-wordmark-kicker">AU CŒUR DE LA FOI</span><span class="jesus-wordmark-title"><span>J</span><span>É</span><span>S</span><span>U</span><span>S</span></span><span class="jesus-wordmark-subtitle">LA FOI PREND VIE</span></div><div class="jesus-caption"><strong>JÉSUS · LUMIÈRE DU MONDE</strong></div></div></section>
 <div class="searchbar" id="searchWrap"><input id="searchInput" placeholder="Rechercher un film, un artiste, une musique…" aria-label="Recherche"></div>
 <section class="section" id="videos"><div class="section-head"><div><h2>Vidéos <span class="pink">✦</span></h2><div class="sub" id="videoSectionSubtitle">Films et vidéos chrétiens — découvre un aperçu.</div></div><button class="see" data-scroll="catalogue">Tout explorer ↗</button></div><div class="cards" id="videoCards"></div></section>
 <section class="section shorts-section" id="shorts"><div class="section-head"><div><h2>Shorts <span class="pink">✦</span></h2><div class="sub">Des formats courts chrétiens, séparés des vidéos classiques.</div></div><button class="see" data-scroll="catalogue">Tous les Shorts ↗</button></div><div class="cards shorts-cards" id="shortCards"></div></section>
 <section class="section music" id="music" hidden><div class="section-head"><div><h2>Musique inspirante <span class="pink">♫</span></h2><div class="sub">Des mélodies pour accompagner chaque moment</div></div><button class="see" data-scroll="music">Toute la musique ↗</button></div><div class="cards" id="musicCards"></div></section>
 <section class="section" id="categories" hidden><div class="section-head"><div><h2>Explore par univers</h2><div class="sub">Trouve ton prochain moment d’inspiration</div></div></div><div class="filters"><button class="filter active" data-cat="all">Tout le catalogue</button><button class="filter" data-cat="videos">Vidéos</button><button class="filter" data-cat="shorts">Shorts</button><button class="filter" data-cat="bible">Histoires bibliques</button><button class="filter" data-cat="family">Famille</button><button class="filter" data-cat="music">Musique gospel</button><button class="filter" data-cat="new">Nouveautés</button></div><div class="cards" id="catalogue"></div></section>
 <section class="section plans-section" id="plans"><div class="section-head"><div><h2>Choisis ton expérience <span class="pink">HOLYVIEW</span></h2><div class="sub">Gratuit, PRO ou ELITE : les différences sont expliquées clairement.</div></div></div><div id="memberPlanBanner" class="member-plan-banner" hidden></div><p class="plans-payment-note"><strong>À savoir :</strong> le checkout est créé côté serveur et l’abonnement s’active uniquement après confirmation du statut auprès de SasPay. Les paiements en production restent désactivés jusqu’à validation complète des tests.</p><div class="plan-grid" id="plansGrid"></div></section><section class="cta" id="memberCta"><div><h2>Débloque l’expérience HOLYVIEW.</h2><p>Crée ton compte pour profiter de 5 heures gratuites, découvrir les aperçus et choisir ensuite la formule qui te convient.</p></div><button class="btn btn-green" id="joinNow">Créer mon compte ✦</button></section></main>
 <footer class="footer"><div>${logo()}<p>Une plateforme pensée pour célébrer la foi à travers le cinéma, la musique et les histoires qui rassemblent.</p><span>© 2026 HOLYVIEW. Tous droits réservés.</span></div><div><strong>À PROPOS</strong><div class="footer-links"><a href="#home">Notre mission</a><a href="#terms">Conditions</a><a href="#privacy">Confidentialité</a></div><p id="terms">Les contenus doivent être diffusés avec les droits et autorisations nécessaires.</p><p id="privacy">Les informations de compte sont utilisées pour fournir les services HOLYVIEW.</p></div></footer>
 <div class="modal" id="authModal" role="dialog" aria-modal="true" aria-labelledby="authTitle"><div class="dialog"><button class="close" id="authClose" aria-label="Fermer">×</button>${logo()}<h2 id="authTitle">Bienvenue chez toi.</h2><p id="authDesc">Connecte-toi pour retrouver tes films, ta musique et tes favoris.</p><div class="tabs"><button class="active" data-mode="login">Connexion</button><button data-mode="signup">Créer un compte</button></div>
 <form id="authForm" novalidate><div id="nameField" class="field" hidden><span>Nom complet *</span><input id="fullName" autocomplete="name" maxlength="100" placeholder="Ton prénom et ton nom"></div>
 <label class="field"><span>Adresse e-mail *</span><input id="email" type="email" autocomplete="email" required maxlength="254" placeholder="toi@exemple.com"></label>
 <label class="field"><span>Mot de passe *</span><div class="password-wrap"><input id="password" type="password" autocomplete="current-password" required minlength="8" placeholder="8 caractères minimum"><button type="button" class="toggle-password" id="togglePassword">Afficher</button></div><small id="passwordHelp">Utilise un mot de passe robuste et unique.</small></label>
 <div id="phoneFields" hidden><div class="field"><span>Pays de résidence *</span><select id="country" autocomplete="country-name" required><option value="">Choisis ton pays</option>${countrySelect()}</select><small>La liste couvre les pays et territoires pris en charge par la numérotation internationale.</small></div>
 <label class="field"><span>Numéro de téléphone *</span><div class="phone-wrap"><span class="calling" id="callingCode">+—</span><input id="phone" type="tel" autocomplete="tel-national" inputmode="tel" required placeholder="Numéro local"></div><small>Entre le numéro national sans l’indicatif du pays. Le format est contrôlé automatiquement.</small><div id="phoneFeedback" class="error" aria-live="polite"></div></label></div>
 <div id="authError" class="error" role="alert"></div><div id="authSuccess" class="success" role="status"></div><button class="btn btn-pink submit" id="authSubmit" type="submit">Se connecter →</button></form><p class="fineprint">En continuant, tu acceptes les conditions d’utilisation et la politique de confidentialité de HOLYVIEW.</p></div></div>
 <div class="video-detail-modal" id="videoDetailModal" hidden role="dialog" aria-modal="true" aria-labelledby="detailTitle"><div class="video-detail-window"><header class="video-detail-head"><div><strong id="detailTitle">Vidéo</strong><small id="detailFormat">Aperçu</small></div><button type="button" class="hv-player-close" id="detailClose" aria-label="Fermer">×</button></header><div class="video-detail-layout"><div class="video-detail-main"><div class="detail-video-stage" id="detailVideoStage"><video id="detailPreview" controls playsinline preload="metadata"></video><div id="detailPreviewMessage" class="detail-preview-message"></div></div><p id="detailSynopsis"></p><div class="detail-actions"><button type="button" id="detailLike" class="small-action">♥ J’aime</button><span id="detailLikes">0 likes</span><button type="button" id="detailShare" class="small-action">↗ Partager</button><span id="detailShares">0 partages</span></div><button type="button" class="btn btn-green" id="detailFullWatch">Regarder la vidéo complète</button><div class="detail-comments"><h3>Commentaires <span id="detailCommentCount">0</span></h3><div id="detailCommentsList"></div><form id="detailCommentForm"><textarea id="detailCommentInput" maxlength="1000" rows="2" placeholder="Écris un commentaire…"></textarea><button type="submit" class="btn btn-pink">Publier le commentaire</button></form><button type="button" class="btn btn-glass" id="detailJoin" hidden>S’inscrire / se connecter pour participer</button></div></div></div></div></div>
 <aside class="install-banner" id="installBanner" hidden aria-label="Installer HOLYVIEW"><div><strong>Installe HOLYVIEW</strong><small id="installHelp">Retrouve tes vidéos plus facilement depuis ton écran d’accueil.</small></div><button type="button" class="btn btn-green" id="installAppButton">Installer</button><button type="button" class="install-dismiss" id="installDismiss" aria-label="Masquer le conseil d’installation">×</button></aside><div class="toast" id="toast" role="status" aria-live="polite"></div>
 <div class="player" id="player"><img id="playerImage" alt=""><div class="player-info"><b id="playerTitle">HOLYVIEW</b><small id="playerSubtitle">Lecteur</small></div><div class="player-controls"><button class="iconbtn" id="playToggle">▶</button><input type="range" min="0" max="100" value="0" aria-label="Progression de lecture"></div><button class="iconbtn" id="playerClose" aria-label="Fermer">×</button></div>`;
 bindUI(); await loadCatalog(); await loadOffers(); const {data}=await supabase.auth.getSession(); updateUser(data.session?.user||null); attachAdminDashboard({supabase,getUser:()=>currentUser,toast}); attachPlayer({supabase,getUser:()=>currentUser,openAuth,toast});
}
function setMode(mode){authMode=mode;document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));$('nameField').hidden=mode!=='signup';$('phoneFields').hidden=mode!=='signup';$('fullName').required=mode==='signup';$('country').required=mode==='signup';$('phone').required=mode==='signup';$('authTitle').textContent=mode==='login'?'Bienvenue chez toi.':'Rejoins HOLYVIEW.';$('authDesc').textContent=mode==='login'?'Connecte-toi pour retrouver tes films, ta musique et tes favoris.':'Renseigne tes informations pour créer ton compte partout dans le monde.';$('authSubmit').textContent=mode==='login'?'Se connecter →':'Créer mon compte →';$('password').autocomplete=mode==='login'?'current-password':'new-password';$('authError').textContent='';$('authSuccess').textContent='';$('phoneFeedback').textContent=''}
function openAuth(mode='login'){setMode(mode);$('authModal').classList.add('show');setTimeout(()=>(mode==='signup'?$('fullName'):$('email')).focus(),50)}
function updateUser(user){currentUser=user;$('authOpen').textContent=user?'Déconnexion':'Se connecter';$('signupOpen').hidden=!!user;$('userChip').hidden=!user;const hero=$('home');hero?.classList.toggle('signed-in',!!user);$('heroJoinNow').hidden=!!user;$('joinNow').textContent=user?'Continuer à explorer ✦':'Créer mon compte ✦';$('music').hidden=!user||!tracks.length;$('categories').hidden=!user;$('memberCta').hidden=!!user;document.querySelector('.footer').hidden=!user;$('musicNav').hidden=!user||!tracks.length;$('videoSectionSubtitle').textContent=user?'Regarde les vidéos complètes, aime, commente et partage.':'Regarde les aperçus. Crée un compte pour accéder aux vidéos complètes.';$('heroTitle').innerHTML=user?'Bienvenue sur<br>HOLY<span class="pink">VIEW.</span>':'Des histoires<br>qui célèbrent<br><span class="pink">JÉSUS.</span>';$('heroDescription').textContent=user?'Ton espace d’inspiration est prêt. Jésus reste au cœur de HOLYVIEW : découvre des films chrétiens, des récits bibliques et des musiques qui fortifient ta foi.':'Le cinéma chrétien, les récits bibliques et la musique qui élève l’âme. Une expérience inspirée par Jésus, la lumière du monde.';if(user){$('userChip').textContent=user.user_metadata?.full_name||user.email?.split('@')[0]||'Connecté';$('userChip').hidden=false}if(typeof activeDetailMovie!=='undefined'&&activeDetailMovie&&!$('videoDetailModal').hidden){$('detailFullWatch').hidden=!user;$('detailLike').disabled=false;$('detailLike').textContent=user?'♡ J’aime':'♡ J’aime · se connecter';$('detailCommentForm').hidden=!user;$('detailJoin').hidden=!!user;if(user){void loadDetailComments();void refreshDetailStats()}else $('detailCommentsList').innerHTML='<p class="detail-muted">Inscris-toi ou connecte-toi pour voir et publier les commentaires.</p>'};void updateMembershipStatus(user).then(()=>{if(user)void processPaymentReturn()});}
function updateCallingCode(){const c=$('country').value;$('callingCode').textContent=c?'+'+getCountryCallingCode(c):'+—';validatePhone(false)}
function validatePhone(show){if(authMode!=='signup'||!$('country').value||!$('phone').value.trim()){if(show)$('phoneFeedback').textContent='Choisis un pays et saisis ton numéro.';return false}const country=$('country').value,raw=$('phone').value.trim();let valid=false;try{valid=isValidPhoneNumber(raw,country);const parsed=parsePhoneNumber(raw,country);if(parsed && parsed.country && parsed.country!==country)valid=false}catch{}$('phoneFeedback').className=valid?'success':'error';$('phoneFeedback').textContent=valid?'Format valide pour '+regionNames.of(country)+'.':(raw.length<4?'':'Ce numéro ne correspond pas au format attendu pour '+regionNames.of(country)+'.');return valid}
let deferredInstallPrompt=null;
function setupInstallPrompt(){
 const banner=$('installBanner'),button=$('installAppButton'),help=$('installHelp');
 const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
 const appleMobile=()=>/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const safariDesktop=()=>/Safari/i.test(navigator.userAgent)&&!/Chrome|Chromium|CriOS|Edg|OPR|Firefox|Android/i.test(navigator.userAgent);
 const unsupportedBrowser=()=>/Firefox/i.test(navigator.userAgent)&&!appleMobile();
 if(standalone()){banner.hidden=true;return}
 banner.hidden=false;
 button.disabled=false;
 button.textContent='Installer';
 help.textContent='Installe HOLYVIEW sur ton appareil.';
 window.addEventListener('beforeinstallprompt',e=>{
   e.preventDefault();
   deferredInstallPrompt=e;
   button.disabled=false;
   button.textContent='Installer';
   help.textContent='HOLYVIEW est prête à être installée.';
   banner.hidden=false;
 });
 window.addEventListener('appinstalled',()=>{
   deferredInstallPrompt=null;
   banner.hidden=true;
   toast('HOLYVIEW est installé sur cet appareil.');
 });
 button.onclick=async()=>{
   if(standalone()){banner.hidden=true;return}
   if(deferredInstallPrompt){
     const installEvent=deferredInstallPrompt;
     deferredInstallPrompt=null;
     button.disabled=true;
     button.textContent='Installation…';
     try{
       const choicePromise=installEvent.userChoice;
       await installEvent.prompt();
       const choice=await choicePromise;
       if(choice?.outcome==='accepted'){
         banner.hidden=true;
         toast('HOLYVIEW a été ajouté à tes applications.');
       }else{
         button.disabled=false;
         button.textContent='Installer';
         help.textContent='Installation non confirmée. Tu peux réessayer lorsque le navigateur le permet.';
       }
     }catch(error){
       button.disabled=false;
       button.textContent='Installer';
       help.textContent='Le navigateur n’a pas pu ouvrir la fenêtre. Actualise la page et réessaie.';
       console.warn('HOLYVIEW install prompt',error);
     }
     return;
   }
   if(appleMobile()){
     help.textContent='Sur iPhone ou iPad, ouvre HOLYVIEW dans Safari, appuie sur Partager, puis « Sur l’écran d’accueil ». Apple ne permet pas à un site de lancer cette commande automatiquement.';
     return;
   }
   if(safariDesktop()){
     help.textContent='Sur Safari pour Mac, utilise le menu Fichier puis « Ajouter au Dock… ». Safari ne permet pas au site de lancer cette commande automatiquement.';
     return;
   }
   if(unsupportedBrowser()){
     help.textContent='Ce navigateur ne propose pas l’installation directe de PWA. Ouvre HOLYVIEW dans une version récente de Chrome ou Edge.';
     return;
   }
   help.textContent='Le navigateur n’a pas encore autorisé l’installation directe. Garde HOLYVIEW ouvert quelques instants puis réessaie.';
 };
 $('installDismiss').onclick=()=>{banner.hidden=true};
}
function bindUI(){
 setupInstallPrompt();
 $('authOpen').onclick=async()=>{if(currentUser){await supabase.auth.signOut();updateUser(null);toast('Tu es déconnecté.')}else openAuth('login')};$('signupOpen').onclick=()=>openAuth('signup');
 $('joinNow').onclick=()=>currentUser?$('videos').scrollIntoView({behavior:'smooth'}):openAuth('signup');$('heroJoinNow').onclick=()=>openAuth('signup');$('plansGrid').addEventListener('click',e=>{
 const button=e.target.closest('[data-plan-select]');if(!button)return;
 const tier=button.dataset.planSelect;
 if(tier==='free'){if(!currentUser)openAuth('signup');else $('videos').scrollIntoView({behavior:'smooth'});return}
 if(!currentUser){openAuth('signup');toast('Crée ton compte pour préparer ton abonnement '+tier.toUpperCase()+'.');return}
 const originalLabel=button.textContent;
 button.disabled=true;button.textContent='Préparation du paiement…';
 void (async()=>{
  try{
   const result=await invokeSasPayAction({action:'create_checkout',tier});
   if(result.paid){toast('Ce paiement est déjà confirmé.');await updateMembershipStatus(currentUser);button.disabled=false;button.textContent=originalLabel;return}
   if(!result.checkoutUrl||!result.paymentId)throw new Error('SasPay n’a pas renvoyé de lien de paiement valide.');
   toast(result.testMode?'Ouverture du checkout de test SasPay…':'Ouverture du paiement sécurisé SasPay…');
   window.location.assign(result.checkoutUrl);
  }catch(error){
   toast((error&&error.message)||'Impossible de préparer le paiement. Réessaie plus tard.');
   if(button.isConnected){button.disabled=false;button.textContent=originalLabel}
  }
 })();
});
$('memberPlanBanner').addEventListener('click',e=>{
 const button=e.target.closest('[data-check-payment]');if(!button)return;
 const paymentId=button.dataset.checkPayment;
 button.disabled=true;button.textContent='Vérification…';
 void checkSasPayPayment(paymentId,false);
});$('authClose').onclick=()=>$('authModal').classList.remove('show');$('authModal').onclick=e=>{if(e.target===$('authModal'))$('authModal').classList.remove('show')};
 document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
 $('togglePassword').onclick=()=>{const p=$('password'),show=p.type==='password';p.type=show?'text':'password';$('togglePassword').textContent=show?'Masquer':'Afficher';$('togglePassword').setAttribute('aria-pressed',String(show))};
 $('country').addEventListener('change',updateCallingCode);$('phone').addEventListener('input',()=>validatePhone(false));$('phone').addEventListener('blur',()=>validatePhone(true));
 $('authForm').onsubmit=async e=>{e.preventDefault();$('authError').textContent='';$('authSuccess').textContent='';const email=$('email').value.trim(),password=$('password').value;let fullName=$('fullName').value.trim(),country=$('country').value,phone=$('phone').value.trim();
 if(!email||!password){$('authError').textContent='Renseigne ton e-mail et ton mot de passe.';return}
 if(authMode==='signup'){if(fullName.length<2){$('authError').textContent='Le nom complet est obligatoire (au moins 2 caractères).';return}if(!country){$('authError').textContent='Choisis ton pays.';return}if(!validatePhone(true)){$('authError').textContent='Corrige le numéro de téléphone avant de continuer.';return}}
 if(password.length<8){$('authError').textContent='Le mot de passe doit contenir au moins 8 caractères.';return}
 $('authSubmit').disabled=true;$('authSubmit').textContent='Vérification…';
 try{
  let result;
  if(authMode==='signup'){
   const phoneCheck=await supabase.functions.invoke('validate-phone',{body:{country,phone}});
   if(phoneCheck.error) throw new Error('La vérification du téléphone est momentanément indisponible. Réessaie dans un instant.');
   if(!phoneCheck.data?.valid) throw new Error(phoneCheck.data?.error||'Ce numéro ne correspond pas au pays sélectionné.');
   result=await supabase.auth.signUp({email,password,options:{data:{full_name:fullName,country_code:country,phone_number:phoneCheck.data.e164}}});
  }else result=await supabase.auth.signInWithPassword({email,password});
  if(result.error)throw result.error;
  if(authMode==='signup'&&!result.data.session){$('authSuccess').textContent='Compte créé. Consulte ta boîte e-mail pour confirmer ton adresse avant de te connecter.';toast('Vérifie ton e-mail pour confirmer ton compte.');}
  else{updateUser(result.data.user);$('authModal').classList.remove('show');toast(authMode==='signup'?'Bienvenue sur HOLYVIEW !':'Connexion réussie.');}
 }catch(err){$('authError').textContent=err.message||'Une erreur est survenue. Réessaie.'}
 finally{$('authSubmit').disabled=false;$('authSubmit').textContent=authMode==='login'?'Se connecter →':'Créer mon compte →'}
 };
 $('searchToggle').onclick=()=>{$('searchWrap').classList.toggle('show');if($('searchWrap').classList.contains('show'))$('searchInput').focus()};
 $('searchInput').oninput=render;$('explore').onclick=()=>$('videos').scrollIntoView({behavior:'smooth'});$('mission').onclick=()=>toast('HOLYVIEW : des films et des musiques pour inspirer, encourager et rassembler.');document.querySelectorAll('[data-scroll]').forEach(b=>b.onclick=()=>$(b.dataset.scroll).scrollIntoView({behavior:'smooth'}));
 document.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-cat]').forEach(x=>x.classList.toggle('active',x===b));const cat=b.dataset.cat;let items=cat==='music'?tracks.map(x=>card(x,'track')):cat==='videos'?movies.filter(x=>x.display_format!=='short').map(x=>card(x,'movie')):cat==='shorts'?movies.filter(x=>x.display_format==='short').map(x=>card(x,'movie')):cat==='new'?[...movies.filter(x=>x.tag==='NOUVEAUTÉ'),...tracks.filter(x=>x.tag==='NOUVEAUTÉ')].map(x=>card(x,x.kind||'movie')):cat==='all'?[...movies.filter(x=>x.display_format!=='short').map(x=>card(x,'movie')),...movies.filter(x=>x.display_format==='short').map(x=>card(x,'movie')),...tracks.map(x=>card(x,'track'))]:movies.filter(x=>x.display_format!=='short').map(x=>card(x,'movie'));$('catalogue').innerHTML=items.join('')||'<div class="empty">Cette sélection sera disponible après publication du contenu.</div>';});
 document.body.addEventListener('click',e=>{const c=e.target.closest('.card');if(!c)return;const kind=c.dataset.kind,item=(kind==='track'?tracks:movies).find(x=>x.id===c.dataset.id);if(!item)return;if(kind==='movie'){void openVideoDetails(item);return}if(!currentUser){openAuth('login');toast('Connecte-toi pour écouter ce contenu.');return}window.dispatchEvent(new CustomEvent('holyview:play',{detail:{kind,item}}))});
 document.body.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.card')){e.preventDefault();e.target.click()}});
 $('detailClose').onclick=()=>{const v=$('detailPreview');v.pause();v.removeAttribute('src');v.load();$('videoDetailModal').hidden=true;document.body.classList.remove('modal-open')};$('videoDetailModal').addEventListener('click',e=>{if(e.target===$('videoDetailModal'))$('detailClose').click()});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('videoDetailModal').hidden)$('detailClose').click()});
  $('detailCommentForm').onsubmit=async e=>{e.preventDefault();if(!currentUser){openAuth('login');return}const body=$('detailCommentInput').value.trim();if(!body)return;const {error}=await supabase.from('video_comments').insert({movie_id:activeDetailMovie.id,user_id:currentUser.id,body});if(error){toast('Le commentaire n’a pas pu être publié.');return}$('detailCommentInput').value='';await loadDetailComments();await refreshDetailStats();await loadCatalog();};
 $('detailShare').onclick=async()=>{if(!activeDetailMovie)return;const url=location.origin+'/#video-'+activeDetailMovie.slug;if(navigator.share){try{await navigator.share({title:activeDetailMovie.title,text:'Découvre cet aperçu sur HOLYVIEW',url})}catch{return}}else{try{await navigator.clipboard.writeText(url);toast('Lien copié.')}catch{toast(url)}}if(currentUser){const {error}=await supabase.from('video_shares').insert({movie_id:activeDetailMovie.id,user_id:currentUser.id,share_date:new Date().toISOString().slice(0,10)});if(error&&error.code!=='23505')console.warn('share tracking',error);await refreshDetailStats()}};
 $('detailLike').onclick=async()=>{if(!currentUser){openAuth('login');toast('Connecte-toi pour aimer cette vidéo.');return}const {data:like}=await supabase.from('video_likes').select('id').eq('movie_id',activeDetailMovie.id).eq('user_id',currentUser.id).maybeSingle();if(like){const {error}=await supabase.from('video_likes').delete().eq('id',like.id);if(error)toast('Impossible de retirer le J’aime.')}else{const {error}=await supabase.from('video_likes').insert({movie_id:activeDetailMovie.id,user_id:currentUser.id});if(error)toast('Impossible d’ajouter le J’aime.')}await refreshDetailStats();await loadCatalog()};
 $('detailFullWatch').onclick=async()=>{if(!currentUser){openAuth('login');return}const item=activeDetailMovie;$('detailClose').click();window.dispatchEvent(new CustomEvent('holyview:play',{detail:{kind:'movie',item}}));await loadCatalog()};
 $('playerClose').onclick=()=>$('player').classList.remove('show');$('playToggle').onclick=()=>toast('Le lecteur sera connecté aux médias privés dans la prochaine étape.');
 window.addEventListener('holyview:view-recorded',()=>{void loadCatalog();if(activeDetailMovie)void refreshDetailStats()});window.addEventListener('holyview:offers-updated',()=>{void loadOffers()});
 window.addEventListener('holyview:show-plans',()=>{const target=$('plans');if(target)target.scrollIntoView({behavior:'smooth',block:'start'})});
 supabase.auth.onAuthStateChange((_event,session)=>updateUser(session?.user||null));
}
if('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('/sw.js').catch(e=>console.warn('PWA service worker',e));
renderApp();
