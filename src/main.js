import { createClient } from '@supabase/supabase-js';
import { getCountries, getCountryCallingCode, isValidPhoneNumber, parsePhoneNumber } from 'libphonenumber-js';
import './style.css';

const SUPABASE_URL = 'https://rewzjcmaexthotbimacu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_SWMO0_i6w4hNMfO5O_0vJg_A2qwvhTF';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const $ = (id) => document.getElementById(id);
const regionNames = new Intl.DisplayNames(['fr'], { type: 'region' });
const countryOptions = getCountries().map(code => ({ code, name: regionNames.of(code) || code, dial: '+' + getCountryCallingCode(code) }))
  .sort((a,b) => a.name.localeCompare(b.name, 'fr'));
const demoMovies = [
 {id:'demo-m1',title:'Le Chemin de la Grâce',release_year:2025,poster_path:'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=700&q=85',tag:'FOI & ESPÉRANCE',synopsis:'Un voyage de pardon, d’espérance et de foi.'},
 {id:'demo-m2',title:'Au-delà des montagnes',release_year:2024,poster_path:'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=700&q=85',tag:'INSPIRATION'},
 {id:'demo-m3',title:'Les Promesses',release_year:2025,poster_path:'https://images.unsplash.com/photo-1511895426328-dc8714191300?auto=format&fit=crop&w=700&q=85',tag:'FAMILLE'},
 {id:'demo-m4',title:'Sur les pas de Jésus',release_year:2024,poster_path:'https://images.unsplash.com/photo-1548625361-58a9b86aa83b?auto=format&fit=crop&w=700&q=85',tag:'BIBLE'},
 {id:'demo-m5',title:'Une lumière dans la nuit',release_year:2026,poster_path:'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=700&q=85',tag:'NOUVEAUTÉ'}
];
const demoTracks = [
 {id:'demo-a1',title:'Grâce infinie',artist_name:'Voix de louange',poster_path:'https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=700&q=85',tag:'LOUANGE'},
 {id:'demo-a2',title:'Tout est possible',artist_name:'Chants d’espoir',poster_path:'https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&w=700&q=85',tag:'GOSPEL'},
 {id:'demo-a3',title:'Dans ta présence',artist_name:'Cœur adorateur',poster_path:'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?auto=format&fit=crop&w=700&q=85',tag:'ADORATION'},
 {id:'demo-a4',title:'Nouvelle saison',artist_name:'Harmonie céleste',poster_path:'https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=700&q=85',tag:'NOUVEAUTÉ'},
 {id:'demo-a5',title:'Je marcherai par la foi',artist_name:'Voix de louange',poster_path:'https://images.unsplash.com/photo-1507838153414-b4b713384a76?auto=format&fit=crop&w=700&q=85',tag:'FOI'}
];
let movies=[], tracks=[], currentUser=null, authMode='login';
const esc = (s='') => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.remove('show'),3600)}
function logo(){return '<a class="brand" href="#home" aria-label="HOLYVIEW accueil"><img src="/holyview-logo.svg" alt=""><span>HOLY<b>VIEW</b></span></a>'}
function card(item,kind){const title=esc(item.title),img=esc(item.poster_path||item.image_path||'');return '<article class="card" role="button" tabindex="0" data-id="'+esc(item.id)+'" data-kind="'+kind+'"><div class="poster"><img loading="lazy" src="'+img+'" alt="'+title+'" onerror="this.style.display=\'none\'"><span class="poster-label">'+esc(item.tag||(kind==='track'?'MUSIQUE':'FILM'))+'</span><span class="poster-play">▶</span></div><h3>'+title+'</h3><p>'+(kind==='track'?esc(item.artist_name||item.artists?.name||'Musique chrétienne'):esc(item.release_year||'Film chrétien'))+'</p></article>'}
function render(){
 const q=($('searchInput')?.value||'').trim().toLocaleLowerCase('fr');
 const filteredMovies=movies.filter(x=>(x.title+' '+(x.synopsis||'')).toLocaleLowerCase('fr').includes(q));
 const filteredTracks=tracks.filter(x=>(x.title+' '+(x.artist_name||x.artists?.name||'')).toLocaleLowerCase('fr').includes(q));
 $('movieCards').innerHTML=filteredMovies.slice(0,5).map(x=>card(x,'movie')).join('')||'<div class="empty">Les films autorisés et publiés apparaîtront ici. Les affiches de démonstration ne sont pas des contenus disponibles à la lecture.</div>';
 $('musicCards').innerHTML=filteredTracks.slice(0,5).map(x=>card(x,'track')).join('')||'<div class="empty">La sélection musicale apparaîtra ici après publication des pistes.</div>';
 $('catalogue').innerHTML=[...filteredMovies.map(x=>card(x,'movie')),...filteredTracks.map(x=>card(x,'track'))].join('')||'<div class="empty">Aucun résultat. Essaie une autre recherche.</div>';
}
async function loadCatalog(){
 const [m,t]=await Promise.all([
  supabase.from('movies').select('id,title,slug,synopsis,poster_path,duration_seconds,release_year,status,is_featured').eq('status','published').order('is_featured',{ascending:false}).limit(30),
  supabase.from('music_tracks').select('id,title,duration_seconds,artist_id,artists(name,image_path)').eq('status','published').limit(30)
 ]);
 movies=m.data?.length?m.data.map(x=>({...x,tag:x.is_featured?'À LA UNE':'FILM'})):demoMovies;
 tracks=t.data?.length?t.data.map(x=>({...x,artist_name:x.artists?.name,poster_path:x.artists?.image_path,tag:'MUSIQUE'})):demoTracks;
 render();
}
function countrySelect(){return countryOptions.map(c=>'<option value="'+c.code+'">'+esc(c.name)+' ('+c.dial+')</option>').join('')}
function renderApp(){
 $('app').innerHTML = `
 <header class="nav">${logo()}<nav class="links"><a class="active" href="#home">Accueil</a><a href="#films">Films</a><a href="#music">Musiques</a><a href="#categories">Catégories</a></nav><div class="navright"><button class="iconbtn" id="searchToggle" aria-label="Rechercher">⌕</button><span class="userchip" id="userChip" hidden></span><button class="btn btn-pink" id="authOpen">Se connecter</button></div></header>
 <main><section class="hero" id="home"><div class="hero-content"><div class="eyebrow"><span class="dot"></span> LE STREAMING QUI INSPIRE</div><h1>Des histoires<br>qui nourrissent<br><span class="pink">la foi.</span></h1><p>Films chrétiens, récits bibliques et musique qui élève l’âme. Trouve l’inspiration pour chaque saison de ta vie.</p><div class="meta"><strong>✦ SÉLECTION HOLYVIEW</strong><span>•</span><span>Foi & inspiration</span><span class="tag">FR</span><span class="tag">FAMILLE</span></div><div class="actions"><button class="btn btn-pink" id="explore">▶ Explorer le catalogue</button><button class="btn btn-glass" id="mission">＋ Notre mission</button></div></div></section>
 <div class="searchbar" id="searchWrap"><input id="searchInput" placeholder="Rechercher un film, un artiste, une musique…" aria-label="Recherche"></div>
 <section class="section" id="films"><div class="section-head"><div><h2>Films à découvrir <span class="pink">✦</span></h2><div class="sub">Des récits qui touchent le cœur et fortifient la foi</div></div><button class="see" data-scroll="catalogue">Tout explorer ↗</button></div><div class="cards" id="movieCards"></div></section>
 <section class="section music" id="music"><div class="section-head"><div><h2>Musique inspirante <span class="pink">♫</span></h2><div class="sub">Des mélodies pour accompagner chaque moment</div></div><button class="see" data-scroll="music">Toute la musique ↗</button></div><div class="cards" id="musicCards"></div></section>
 <section class="section" id="categories"><div class="section-head"><div><h2>Explore par univers</h2><div class="sub">Trouve ton prochain moment d’inspiration</div></div></div><div class="filters"><button class="filter active" data-cat="all">Tout le catalogue</button><button class="filter" data-cat="movies">Films chrétiens</button><button class="filter" data-cat="bible">Histoires bibliques</button><button class="filter" data-cat="family">Famille</button><button class="filter" data-cat="music">Musique gospel</button><button class="filter" data-cat="new">Nouveautés</button></div><div class="cards" id="catalogue"></div></section>
 <section class="cta"><div><h2>La foi se vit aussi en histoires.</h2><p>Crée ton espace personnel pour retrouver tes favoris et reprendre ta lecture.<br>5 heures d’essai gratuit à la création du compte, selon les règles de la plateforme.</p></div><button class="btn btn-green" id="joinNow">Créer mon compte ✦</button></section></main>
 <footer class="footer"><div>${logo()}<p>Une plateforme pensée pour célébrer la foi à travers le cinéma, la musique et les histoires qui rassemblent.</p><span>© 2026 HOLYVIEW. Tous droits réservés.</span></div><div><strong>À PROPOS</strong><div class="footer-links"><a href="#home">Notre mission</a><a href="#terms">Conditions</a><a href="#privacy">Confidentialité</a></div><p id="terms">Les contenus doivent être diffusés avec les droits et autorisations nécessaires.</p><p id="privacy">Les informations de compte sont utilisées pour fournir les services HOLYVIEW.</p></div></footer>
 <div class="modal" id="authModal" role="dialog" aria-modal="true" aria-labelledby="authTitle"><div class="dialog"><button class="close" id="authClose" aria-label="Fermer">×</button>${logo()}<h2 id="authTitle">Bienvenue chez toi.</h2><p id="authDesc">Connecte-toi pour retrouver tes films, ta musique et tes favoris.</p><div class="tabs"><button class="active" data-mode="login">Connexion</button><button data-mode="signup">Créer un compte</button></div>
 <form id="authForm" novalidate><div id="nameField" class="field" hidden><span>Nom complet *</span><input id="fullName" autocomplete="name" maxlength="100" placeholder="Ton prénom et ton nom"></div>
 <label class="field"><span>Adresse e-mail *</span><input id="email" type="email" autocomplete="email" required maxlength="254" placeholder="toi@exemple.com"></label>
 <label class="field"><span>Mot de passe *</span><div class="password-wrap"><input id="password" type="password" autocomplete="current-password" required minlength="8" placeholder="8 caractères minimum"><button type="button" class="toggle-password" id="togglePassword">Afficher</button></div><small id="passwordHelp">Utilise un mot de passe robuste et unique.</small></label>
 <div id="phoneFields" hidden><div class="field"><span>Pays de résidence *</span><select id="country" autocomplete="country-name" required><option value="">Choisis ton pays</option>${countrySelect()}</select><small>La liste couvre les pays et territoires pris en charge par la numérotation internationale.</small></div>
 <label class="field"><span>Numéro de téléphone *</span><div class="phone-wrap"><span class="calling" id="callingCode">+—</span><input id="phone" type="tel" autocomplete="tel-national" inputmode="tel" required placeholder="Numéro local"></div><small>Entre le numéro national sans l’indicatif du pays. Le format est contrôlé automatiquement.</small><div id="phoneFeedback" class="error" aria-live="polite"></div></label></div>
 <div id="authError" class="error" role="alert"></div><div id="authSuccess" class="success" role="status"></div><button class="btn btn-pink submit" id="authSubmit" type="submit">Se connecter →</button></form><p class="fineprint">En continuant, tu acceptes les conditions d’utilisation et la politique de confidentialité de HOLYVIEW.</p></div></div>
 <div class="toast" id="toast" role="status" aria-live="polite"></div>
 <div class="player" id="player"><img id="playerImage" alt=""><div class="player-info"><b id="playerTitle">HOLYVIEW</b><small id="playerSubtitle">Lecteur</small></div><div class="player-controls"><button class="iconbtn" id="playToggle">▶</button><input type="range" min="0" max="100" value="0" aria-label="Progression de lecture"></div><button class="iconbtn" id="playerClose" aria-label="Fermer">×</button></div>`;
 bindUI(); await loadCatalog(); const {data}=await supabase.auth.getSession(); updateUser(data.session?.user||null);
}
function setMode(mode){authMode=mode;document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));$('nameField').hidden=mode!=='signup';$('phoneFields').hidden=mode!=='signup';$('fullName').required=mode==='signup';$('country').required=mode==='signup';$('phone').required=mode==='signup';$('authTitle').textContent=mode==='login'?'Bienvenue chez toi.':'Rejoins HOLYVIEW.';$('authDesc').textContent=mode==='login'?'Connecte-toi pour retrouver tes films, ta musique et tes favoris.':'Renseigne tes informations pour créer ton compte partout dans le monde.';$('authSubmit').textContent=mode==='login'?'Se connecter →':'Créer mon compte →';$('password').autocomplete=mode==='login'?'current-password':'new-password';$('authError').textContent='';$('authSuccess').textContent='';$('phoneFeedback').textContent=''}
function openAuth(mode='login'){setMode(mode);$('authModal').classList.add('show');setTimeout(()=>(mode==='signup'?$('fullName'):$('email')).focus(),50)}
function updateUser(user){currentUser=user;$('authOpen').textContent=user?'Déconnexion':'Se connecter';$('userChip').hidden=!user;if(user){$('userChip').textContent=user.user_metadata?.full_name||user.email?.split('@')[0]||'Connecté';$('userChip').hidden=false}}
function updateCallingCode(){const c=$('country').value;$('callingCode').textContent=c?'+'+getCountryCallingCode(c):'+—';validatePhone(false)}
function validatePhone(show){if(authMode!=='signup'||!$('country').value||!$('phone').value.trim()){if(show)$('phoneFeedback').textContent='Choisis un pays et saisis ton numéro.';return false}const country=$('country').value,raw=$('phone').value.trim();let valid=false;try{valid=isValidPhoneNumber(raw,country);const parsed=parsePhoneNumber(raw,country);if(parsed && parsed.country && parsed.country!==country)valid=false}catch{}$('phoneFeedback').className=valid?'success':'error';$('phoneFeedback').textContent=valid?'Format valide pour '+regionNames.of(country)+'.':(raw.length<4?'':'Ce numéro ne correspond pas au format attendu pour '+regionNames.of(country)+'.');return valid}
function bindUI(){
 $('authOpen').onclick=async()=>{if(currentUser){await supabase.auth.signOut();updateUser(null);toast('Tu es déconnecté.')}else openAuth()};
 $('joinNow').onclick=()=>openAuth('signup');$('authClose').onclick=()=>$('authModal').classList.remove('show');$('authModal').onclick=e=>{if(e.target===$('authModal'))$('authModal').classList.remove('show')};
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
   const parsed=parsePhoneNumber(phone,country);
   result=await supabase.auth.signUp({email,password,options:{data:{full_name:fullName,country_code:country,phone_number:parsed.number}}});
  }else result=await supabase.auth.signInWithPassword({email,password});
  if(result.error)throw result.error;
  if(authMode==='signup'&&!result.data.session){$('authSuccess').textContent='Compte créé. Consulte ta boîte e-mail pour confirmer ton adresse avant de te connecter.';toast('Vérifie ton e-mail pour confirmer ton compte.');}
  else{updateUser(result.data.user);$('authModal').classList.remove('show');toast(authMode==='signup'?'Bienvenue sur HOLYVIEW !':'Connexion réussie.');}
 }catch(err){$('authError').textContent=err.message||'Une erreur est survenue. Réessaie.'}
 finally{$('authSubmit').disabled=false;setMode(authMode)}
 };
 $('searchToggle').onclick=()=>{$('searchWrap').classList.toggle('show');if($('searchWrap').classList.contains('show'))$('searchInput').focus()};
 $('searchInput').oninput=render;$('explore').onclick=()=>$('films').scrollIntoView({behavior:'smooth'});$('mission').onclick=()=>toast('HOLYVIEW : des films et des musiques pour inspirer, encourager et rassembler.');document.querySelectorAll('[data-scroll]').forEach(b=>b.onclick=()=>$(b.dataset.scroll).scrollIntoView({behavior:'smooth'}));
 document.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-cat]').forEach(x=>x.classList.toggle('active',x===b));const cat=b.dataset.cat;let items=cat==='music'?tracks.map(x=>card(x,'track')):cat==='new'?[...movies.filter(x=>x.tag==='NOUVEAUTÉ'),...tracks.filter(x=>x.tag==='NOUVEAUTÉ')].map(x=>card(x,x.kind||'movie')):cat==='all'?[...movies.map(x=>card(x,'movie')),...tracks.map(x=>card(x,'track'))]:movies.map(x=>card(x,'movie'));$('catalogue').innerHTML=items.join('')||'<div class="empty">Cette sélection sera disponible après publication du contenu.</div>';});
 document.body.addEventListener('click',e=>{const c=e.target.closest('.card');if(!c)return;const kind=c.dataset.kind,item=(kind==='track'?tracks:movies).find(x=>x.id===c.dataset.id);if(!item)return;if(String(item.id).startsWith('demo-')){toast('Affiche de démonstration : aucun fichier vidéo ou audio réel n’est attaché.');return}if(!currentUser){openAuth();toast('Connecte-toi pour continuer.');return}toast('La lecture protégée sera ouverte lorsque le média autorisé sera configuré côté serveur.')});
 document.body.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.card')){e.preventDefault();e.target.click()}});
 $('playerClose').onclick=()=>$('player').classList.remove('show');$('playToggle').onclick=()=>toast('Le lecteur sera connecté aux médias privés dans la prochaine étape.');
 supabase.auth.onAuthStateChange((_event,session)=>updateUser(session?.user||null));
}
if('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('/sw.js').catch(e=>console.warn('PWA service worker',e));
renderApp();
