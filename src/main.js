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
let movies=[], tracks=[], currentUser=null, authMode='login';
const esc = (s='') => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.remove('show'),3600)}
function logo(){return '<a class="brand" href="#home" aria-label="HOLYVIEW accueil"><img src="/holyview-logo.svg" alt=""><span>HOLY<b>VIEW</b></span></a>'}
function card(item,kind){const title=esc(item.title),img=esc(item.poster_path||item.image_path||'');return '<article class="card" role="button" tabindex="0" data-id="'+esc(item.id)+'" data-kind="'+kind+'"><div class="poster"><img loading="lazy" src="'+img+'" alt="'+title+'" onerror="this.style.display=\'none\'"><span class="poster-label">'+esc(item.tag||(kind==='track'?'MUSIQUE':'FILM'))+'</span><span class="poster-play">▶</span></div><h3>'+title+'</h3><p>'+(kind==='track'?esc(item.artist_name||item.artists?.name||'Musique chrétienne'):esc(item.release_year||'Film chrétien'))+'</p></article>'}
function render(){
 const q=($('searchInput')?.value||'').trim().toLocaleLowerCase('fr');
 const filteredMovies=movies.filter(x=>(x.title+' '+(x.synopsis||'')).toLocaleLowerCase('fr').includes(q));
 const filteredTracks=tracks.filter(x=>(x.title+' '+(x.artist_name||x.artists?.name||'')).toLocaleLowerCase('fr').includes(q));
 $('movieCards').innerHTML=filteredMovies.slice(0,30).map(x=>card(x,'movie')).join('')||'<div class="empty">Aucune vidéo publiée pour le moment. Les prochaines vidéos officielles de HOLYVIEW apparaîtront ici.</div>';
 $('musicCards').innerHTML=filteredTracks.slice(0,5).map(x=>card(x,'track')).join('')||'<div class="empty">La sélection musicale apparaîtra ici après publication des pistes.</div>';
 $('catalogue').innerHTML=[...filteredMovies.map(x=>card(x,'movie')),...filteredTracks.map(x=>card(x,'track'))].join('')||'<div class="empty">Aucun résultat. Essaie une autre recherche.</div>';
}
async function loadCatalog(){
 const [m,t]=await Promise.all([
  supabase.from('movies').select('id,title,slug,synopsis,poster_path,duration_seconds,release_year,status,is_featured,display_format,preview_asset_path,preview_duration_seconds,clip_start_seconds,clip_end_seconds,subtitles').eq('status','published').order('is_featured',{ascending:false}).limit(100),
  supabase.from('music_tracks').select('id,title,duration_seconds,artist_id,artists(name,image_path)').eq('status','published').limit(30)
 ]);
 const {data:stats}=await supabase.from('movie_stats').select('movie_id,view_count,like_count,comment_count,share_count');
 const statsById=new Map((stats||[]).map(x=>[x.movie_id,x]));
 movies=(m.data||[]).map(x=>({...x,stats:statsById.get(x.id)||{},tag:x.display_format==='short'?'SHORT':x.is_featured?'À LA UNE':'VIDÉO'}));
 tracks=(t.data||[]).map(x=>({...x,artist_name:x.artists?.name,poster_path:x.artists?.image_path,tag:'MUSIQUE'}));
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
 $('detailLike').disabled=!currentUser;
 $('detailCommentForm').hidden=!currentUser;
 $('detailJoin').hidden=!!currentUser;
 $('detailJoin').onclick=()=>openAuth('signup');
 $('detailPreview').classList.toggle('detail-short',item.display_format==='short');
 $('detailVideoStage').classList.toggle('detail-short-stage',item.display_format==='short');
 modal.hidden=false; document.body.classList.add('modal-open');
 if(detailPreviewUrl){URL.revokeObjectURL(detailPreviewUrl);detailPreviewUrl=null}
 video.pause();video.removeAttribute('src');video.load();
 try{
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
function countrySelect(){return countryOptions.map(c=>'<option value="'+c.code+'">'+esc(c.name)+' ('+c.dial+')</option>').join('')}
async function renderApp(){
 $('app').innerHTML = `
 <header class="nav">${logo()}<nav class="links"><a class="active" href="#films">Vidéos & Shorts</a><a id="musicNav" href="#music">Musiques</a></nav><div class="navright"><button class="iconbtn" id="searchToggle" aria-label="Rechercher">⌕</button><span class="userchip" id="userChip" hidden></span><button class="btn btn-glass" id="authOpen">Se connecter</button><button class="btn btn-green" id="signupOpen">S’inscrire</button></div></header>
 <main><section class="hero" id="home"><div class="hero-content"><div class="eyebrow"><span class="dot"></span> LE STREAMING QUI INSPIRE</div><h1 id="heroTitle">Des histoires<br>qui nourrissent<br><span class="pink">la foi.</span></h1><p id="heroDescription">Films chrétiens, récits bibliques et musique qui élève l’âme. Trouve l’inspiration pour chaque saison de ta vie.</p><div class="hero-benefits" id="heroBenefits"><span>✦ Des histoires qui inspirent</span><span>♫ Louange & gospel</span><span>♡ Un espace pour ta famille</span></div><div class="meta"><strong>✦ SÉLECTION HOLYVIEW</strong><span>•</span><span>Foi & inspiration</span><span class="tag">FR</span><span class="tag">FAMILLE</span></div><div class="actions"><button class="btn btn-pink" id="explore">▶ Explorer le catalogue</button><button class="btn btn-green hero-join" id="heroJoinNow">✦ Créer mon espace gratuit</button><button class="btn btn-glass" id="mission">＋ Notre mission</button></div></div></section>
 <div class="searchbar" id="searchWrap"><input id="searchInput" placeholder="Rechercher un film, un artiste, une musique…" aria-label="Recherche"></div>
 <section class="section" id="films"><div class="section-head"><div><h2>Vidéos & Shorts <span class="pink">✦</span></h2><div class="sub" id="videoSectionSubtitle">Découvre un aperçu. Connecte-toi pour regarder les vidéos complètes.</div></div><button class="see" data-scroll="catalogue">Tout explorer ↗</button></div><div class="cards" id="movieCards"></div></section>
 <section class="section music" id="music" hidden><div class="section-head"><div><h2>Musique inspirante <span class="pink">♫</span></h2><div class="sub">Des mélodies pour accompagner chaque moment</div></div><button class="see" data-scroll="music">Toute la musique ↗</button></div><div class="cards" id="musicCards"></div></section>
 <section class="section" id="categories" hidden><div class="section-head"><div><h2>Explore par univers</h2><div class="sub">Trouve ton prochain moment d’inspiration</div></div></div><div class="filters"><button class="filter active" data-cat="all">Tout le catalogue</button><button class="filter" data-cat="movies">Films chrétiens</button><button class="filter" data-cat="bible">Histoires bibliques</button><button class="filter" data-cat="family">Famille</button><button class="filter" data-cat="music">Musique gospel</button><button class="filter" data-cat="new">Nouveautés</button></div><div class="cards" id="catalogue"></div></section>
 <section class="cta" id="memberCta"><div><h2>Débloque l’expérience HOLYVIEW.</h2><p>Crée ton compte gratuit pour regarder les vidéos complètes, aimer, commenter et partager.</p></div><button class="btn btn-green" id="joinNow">Créer mon compte ✦</button></section></main>
 <footer class="footer"><div>${logo()}<p>Une plateforme pensée pour célébrer la foi à travers le cinéma, la musique et les histoires qui rassemblent.</p><span>© 2026 HOLYVIEW. Tous droits réservés.</span></div><div><strong>À PROPOS</strong><div class="footer-links"><a href="#home">Notre mission</a><a href="#terms">Conditions</a><a href="#privacy">Confidentialité</a></div><p id="terms">Les contenus doivent être diffusés avec les droits et autorisations nécessaires.</p><p id="privacy">Les informations de compte sont utilisées pour fournir les services HOLYVIEW.</p></div></footer>
 <div class="modal" id="authModal" role="dialog" aria-modal="true" aria-labelledby="authTitle"><div class="dialog"><button class="close" id="authClose" aria-label="Fermer">×</button>${logo()}<h2 id="authTitle">Bienvenue chez toi.</h2><p id="authDesc">Connecte-toi pour retrouver tes films, ta musique et tes favoris.</p><div class="tabs"><button class="active" data-mode="login">Connexion</button><button data-mode="signup">Créer un compte</button></div>
 <form id="authForm" novalidate><div id="nameField" class="field" hidden><span>Nom complet *</span><input id="fullName" autocomplete="name" maxlength="100" placeholder="Ton prénom et ton nom"></div>
 <label class="field"><span>Adresse e-mail *</span><input id="email" type="email" autocomplete="email" required maxlength="254" placeholder="toi@exemple.com"></label>
 <label class="field"><span>Mot de passe *</span><div class="password-wrap"><input id="password" type="password" autocomplete="current-password" required minlength="8" placeholder="8 caractères minimum"><button type="button" class="toggle-password" id="togglePassword">Afficher</button></div><small id="passwordHelp">Utilise un mot de passe robuste et unique.</small></label>
 <div id="phoneFields" hidden><div class="field"><span>Pays de résidence *</span><select id="country" autocomplete="country-name" required><option value="">Choisis ton pays</option>${countrySelect()}</select><small>La liste couvre les pays et territoires pris en charge par la numérotation internationale.</small></div>
 <label class="field"><span>Numéro de téléphone *</span><div class="phone-wrap"><span class="calling" id="callingCode">+—</span><input id="phone" type="tel" autocomplete="tel-national" inputmode="tel" required placeholder="Numéro local"></div><small>Entre le numéro national sans l’indicatif du pays. Le format est contrôlé automatiquement.</small><div id="phoneFeedback" class="error" aria-live="polite"></div></label></div>
 <div id="authError" class="error" role="alert"></div><div id="authSuccess" class="success" role="status"></div><button class="btn btn-pink submit" id="authSubmit" type="submit">Se connecter →</button></form><p class="fineprint">En continuant, tu acceptes les conditions d’utilisation et la politique de confidentialité de HOLYVIEW.</p></div></div>
 <div class="video-detail-modal" id="videoDetailModal" hidden role="dialog" aria-modal="true" aria-labelledby="detailTitle"><div class="video-detail-window"><header class="video-detail-head"><div><strong id="detailTitle">Vidéo</strong><small id="detailFormat">Aperçu</small></div><button type="button" class="hv-player-close" id="detailClose" aria-label="Fermer">×</button></header><div class="video-detail-layout"><div class="video-detail-main"><div class="detail-video-stage" id="detailVideoStage"><video id="detailPreview" controls playsinline preload="metadata"></video><div id="detailPreviewMessage" class="detail-preview-message"></div></div><p id="detailSynopsis"></p><div class="detail-actions"><button type="button" id="detailLike" class="small-action">♥ J’aime</button><span id="detailLikes">0 likes</span><button type="button" id="detailShare" class="small-action">↗ Partager</button><span id="detailShares">0 partages</span></div><button type="button" class="btn btn-green" id="detailFullWatch">Regarder la vidéo complète</button><div class="detail-comments"><h3>Commentaires <span id="detailCommentCount">0</span></h3><div id="detailCommentsList"></div><form id="detailCommentForm"><textarea id="detailCommentInput" maxlength="1000" rows="2" placeholder="Écris un commentaire…"></textarea><button type="submit" class="btn btn-pink">Publier le commentaire</button></form><button type="button" class="btn btn-glass" id="detailJoin" hidden>S’inscrire / se connecter pour participer</button></div></div></div></div></div>
 <div class="toast" id="toast" role="status" aria-live="polite"></div>
 <div class="player" id="player"><img id="playerImage" alt=""><div class="player-info"><b id="playerTitle">HOLYVIEW</b><small id="playerSubtitle">Lecteur</small></div><div class="player-controls"><button class="iconbtn" id="playToggle">▶</button><input type="range" min="0" max="100" value="0" aria-label="Progression de lecture"></div><button class="iconbtn" id="playerClose" aria-label="Fermer">×</button></div>`;
 bindUI(); await loadCatalog(); const {data}=await supabase.auth.getSession(); updateUser(data.session?.user||null); attachAdminDashboard({supabase,getUser:()=>currentUser,toast}); attachPlayer({supabase,getUser:()=>currentUser,openAuth,toast});
}
function setMode(mode){authMode=mode;document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));$('nameField').hidden=mode!=='signup';$('phoneFields').hidden=mode!=='signup';$('fullName').required=mode==='signup';$('country').required=mode==='signup';$('phone').required=mode==='signup';$('authTitle').textContent=mode==='login'?'Bienvenue chez toi.':'Rejoins HOLYVIEW.';$('authDesc').textContent=mode==='login'?'Connecte-toi pour retrouver tes films, ta musique et tes favoris.':'Renseigne tes informations pour créer ton compte partout dans le monde.';$('authSubmit').textContent=mode==='login'?'Se connecter →':'Créer mon compte →';$('password').autocomplete=mode==='login'?'current-password':'new-password';$('authError').textContent='';$('authSuccess').textContent='';$('phoneFeedback').textContent=''}
function openAuth(mode='login'){setMode(mode);$('authModal').classList.add('show');setTimeout(()=>(mode==='signup'?$('fullName'):$('email')).focus(),50)}
function updateUser(user){currentUser=user;$('authOpen').textContent=user?'Déconnexion':'Se connecter';$('signupOpen').hidden=!!user;$('userChip').hidden=!user;const hero=$('home');hero?.classList.toggle('signed-in',!!user);$('heroJoinNow').hidden=!!user;$('joinNow').textContent=user?'Continuer à explorer ✦':'Créer mon compte ✦';$('music').hidden=!user||!tracks.length;$('categories').hidden=!user;$('memberCta').hidden=!!user;$('musicNav').hidden=!user||!tracks.length;$('videoSectionSubtitle').textContent=user?'Regarde les vidéos complètes, aime, commente et partage.':'Regarde les aperçus. Crée un compte pour accéder aux vidéos complètes.';$('heroTitle').innerHTML=user?'Bienvenue sur<br>HOLY<span class="pink">VIEW.</span>':'Des histoires<br>qui nourrissent<br><span class="pink">la foi.</span>';$('heroDescription').textContent=user?'Ton espace d’inspiration est prêt. Découvre les films chrétiens et les musiques qui fortifient ta foi, et retrouve les contenus disponibles pour ton compte.':'Un espace de cinéma chrétien, de récits bibliques et de musique qui élève l’âme. Découvre des histoires qui inspirent, rassemblent et nourrissent ta foi.';if(user){$('userChip').textContent=user.user_metadata?.full_name||user.email?.split('@')[0]||'Connecté';$('userChip').hidden=false}}
function updateCallingCode(){const c=$('country').value;$('callingCode').textContent=c?'+'+getCountryCallingCode(c):'+—';validatePhone(false)}
function validatePhone(show){if(authMode!=='signup'||!$('country').value||!$('phone').value.trim()){if(show)$('phoneFeedback').textContent='Choisis un pays et saisis ton numéro.';return false}const country=$('country').value,raw=$('phone').value.trim();let valid=false;try{valid=isValidPhoneNumber(raw,country);const parsed=parsePhoneNumber(raw,country);if(parsed && parsed.country && parsed.country!==country)valid=false}catch{}$('phoneFeedback').className=valid?'success':'error';$('phoneFeedback').textContent=valid?'Format valide pour '+regionNames.of(country)+'.':(raw.length<4?'':'Ce numéro ne correspond pas au format attendu pour '+regionNames.of(country)+'.');return valid}
function bindUI(){
 $('authOpen').onclick=async()=>{if(currentUser){await supabase.auth.signOut();updateUser(null);toast('Tu es déconnecté.')}else openAuth('login')};$('signupOpen').onclick=()=>openAuth('signup');
 $('joinNow').onclick=()=>currentUser?$('films').scrollIntoView({behavior:'smooth'}):openAuth('signup');$('heroJoinNow').onclick=()=>openAuth('signup');$('authClose').onclick=()=>$('authModal').classList.remove('show');$('authModal').onclick=e=>{if(e.target===$('authModal'))$('authModal').classList.remove('show')};
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
 $('searchInput').oninput=render;$('explore').onclick=()=>$('films').scrollIntoView({behavior:'smooth'});$('mission').onclick=()=>toast('HOLYVIEW : des films et des musiques pour inspirer, encourager et rassembler.');document.querySelectorAll('[data-scroll]').forEach(b=>b.onclick=()=>$(b.dataset.scroll).scrollIntoView({behavior:'smooth'}));
 document.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-cat]').forEach(x=>x.classList.toggle('active',x===b));const cat=b.dataset.cat;let items=cat==='music'?tracks.map(x=>card(x,'track')):cat==='new'?[...movies.filter(x=>x.tag==='NOUVEAUTÉ'),...tracks.filter(x=>x.tag==='NOUVEAUTÉ')].map(x=>card(x,x.kind||'movie')):cat==='all'?[...movies.map(x=>card(x,'movie')),...tracks.map(x=>card(x,'track'))]:movies.map(x=>card(x,'movie'));$('catalogue').innerHTML=items.join('')||'<div class="empty">Cette sélection sera disponible après publication du contenu.</div>';});
 document.body.addEventListener('click',e=>{const c=e.target.closest('.card');if(!c)return;const kind=c.dataset.kind,item=(kind==='track'?tracks:movies).find(x=>x.id===c.dataset.id);if(!item)return;if(kind==='movie'){void openVideoDetails(item);return}if(!currentUser){openAuth('login');toast('Connecte-toi pour écouter ce contenu.');return}window.dispatchEvent(new CustomEvent('holyview:play',{detail:{kind,item}}))});
 document.body.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.card')){e.preventDefault();e.target.click()}});
 $('detailClose').onclick=()=>{const v=$('detailPreview');v.pause();v.removeAttribute('src');v.load();$('videoDetailModal').hidden=true;document.body.classList.remove('modal-open')};$('videoDetailModal').addEventListener('click',e=>{if(e.target===$('videoDetailModal'))$('detailClose').click()});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('videoDetailModal').hidden)$('detailClose').click()});
 $('detailLike').onclick=async()=>{if(!currentUser){openAuth('login');return}const {data:like}=await supabase.from('video_likes').select('id').eq('movie_id',activeDetailMovie.id).eq('user_id',currentUser.id).maybeSingle();if(like){const {error}=await supabase.from('video_likes').delete().eq('id',like.id);if(error)toast('Impossible de retirer le J’aime.')}else{const {error}=await supabase.from('video_likes').insert({movie_id:activeDetailMovie.id,user_id:currentUser.id});if(error)toast('Impossible d’ajouter le J’aime.')}await refreshDetailStats();await loadCatalog();};
 $('detailCommentForm').onsubmit=async e=>{e.preventDefault();if(!currentUser){openAuth('login');return}const body=$('detailCommentInput').value.trim();if(!body)return;const {error}=await supabase.from('video_comments').insert({movie_id:activeDetailMovie.id,user_id:currentUser.id,body});if(error){toast('Le commentaire n’a pas pu être publié.');return}$('detailCommentInput').value='';await loadDetailComments();await refreshDetailStats();await loadCatalog();};
 $('detailShare').onclick=async()=>{if(!activeDetailMovie)return;const url=location.origin+'/#video-'+activeDetailMovie.slug;if(navigator.share){try{await navigator.share({title:activeDetailMovie.title,text:'Découvre cet aperçu sur HOLYVIEW',url})}catch{return}}else{try{await navigator.clipboard.writeText(url);toast('Lien copié.')}catch{toast(url)}}if(currentUser){const {error}=await supabase.from('video_shares').insert({movie_id:activeDetailMovie.id,user_id:currentUser.id,share_date:new Date().toISOString().slice(0,10)});if(error&&error.code!=='23505')console.warn('share tracking',error);await refreshDetailStats()}};
 $('detailFullWatch').onclick=async()=>{if(!currentUser){openAuth('login');return}const {error}=await supabase.from('video_views').insert({movie_id:activeDetailMovie.id,user_id:currentUser.id,view_date:new Date().toISOString().slice(0,10)});if(error&&error.code!=='23505')console.warn('view tracking',error);const item=activeDetailMovie;$('detailClose').click();window.dispatchEvent(new CustomEvent('holyview:play',{detail:{kind:'movie',item}}));await loadCatalog()};
 $('playerClose').onclick=()=>$('player').classList.remove('show');$('playToggle').onclick=()=>toast('Le lecteur sera connecté aux médias privés dans la prochaine étape.');
 supabase.auth.onAuthStateChange((_event,session)=>updateUser(session?.user||null));
}
if('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('/sw.js').catch(e=>console.warn('PWA service worker',e));
renderApp();
