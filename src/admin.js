import './admin.css';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rewzjcmaexthotbimacu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_SWMO0_i6w4hNMfO5O_0vJg_A2qwvhTF';

const money = (value, currency='XOF') => new Intl.NumberFormat('fr-FR',{style:'currency',currency,maximumFractionDigits:0}).format(Number(value||0));
const dateLabel = value => value ? new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium'}).format(new Date(value)) : '—';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const slugify = value => String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70);
const BUCKET = 'holyview-private';

export async function attachAdminDashboard({supabase, getUser, toast}) {
  const navRight = document.querySelector('.navright');
  if (!navRight || document.getElementById('adminOpen')) return;
  const openBtn = document.createElement('button');
  openBtn.id = 'adminOpen';
  openBtn.className = 'btn btn-glass admin-open';
  openBtn.textContent = '⚙ Administration';
  openBtn.hidden = true;
  navRight.insertBefore(openBtn, navRight.firstChild);

  const homeNodes = () => [document.querySelector('.hero'), document.querySelector('.searchbar'), ...document.querySelectorAll('main .section, main .cta'), document.querySelector('.footer')];
  const app = document.getElementById('app');
  const admin = document.createElement('section');
  admin.id = 'adminDashboard';
  admin.className = 'admin-dashboard';
  admin.hidden = true;
  admin.innerHTML = `
    <div class="admin-top"><div><div class="admin-eyebrow">HOLYVIEW · CENTRE DE CONTRÔLE</div><h1>Tableau de bord</h1><p>La plateforme, ses membres et ses contenus en un seul endroit.</p></div><span class="admin-live-status" id="adminLiveStatus">Données en direct</span></div>
    <div class="admin-tabs" role="tablist"><button class="active" data-admin-tab="overview">Vue générale</button><button data-admin-tab="users">Utilisateurs</button><button data-admin-tab="content">Catalogue</button><button data-admin-tab="publish">Publier un média</button></div>
    <div id="adminNotice" class="admin-notice" role="status"></div>
    <section class="admin-pane" id="adminPane-overview">
      <div class="admin-kpis" id="adminKpis"><div class="admin-kpi skeleton">Chargement des statistiques…</div></div>
      <div class="admin-grid"><article class="admin-panel"><div class="admin-panel-head"><div><h2>Revenus confirmés</h2><p>Uniquement les paiements marqués « réussis ».</p></div><select id="revenuePeriod" aria-label="Période des revenus"><option value="week">Cette semaine</option><option value="month" selected>Ce mois</option><option value="year">Cette année</option><option value="all">Depuis le début</option></select></div><div class="revenue-total" id="revenueTotal">—</div><div class="revenue-chart" id="revenueChart"></div><p class="admin-footnote">Les paiements sont désactivés pour l’instant : le chiffre reste à zéro tant qu’aucun paiement confirmé n’est enregistré.</p></article>
      <article class="admin-panel"><div class="admin-panel-head"><div><h2>Répartition des abonnements</h2><p>Comptes actifs par formule</p></div></div><div id="tierBreakdown" class="tier-breakdown"></div><div class="admin-mini-stats" id="adminMiniStats"></div></article></div>
      <article class="admin-panel"><div class="admin-panel-head"><div><h2>Dernières inscriptions</h2><button class="text-button" data-jump-tab="users">Voir tous les membres ↗</button></div></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Membre</th><th>Pays</th><th>Formule</th><th>Inscription</th></tr></thead><tbody id="recentUsers"></tbody></table></div></article>
    </section>
    <section class="admin-pane" id="adminPane-users" hidden><article class="admin-panel"><div class="admin-panel-head"><div><h2>Répertoire des utilisateurs</h2><p>Informations de compte, pays et abonnement.</p></div><input id="userSearch" class="admin-search" placeholder="Rechercher nom, e-mail, pays, numéro…"></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Utilisateur</th><th>Pays / téléphone</th><th>Abonnement</th><th>Statut</th><th>Inscrit le</th></tr></thead><tbody id="usersTable"></tbody></table></div><div class="admin-footnote" id="usersCount"></div></article></section>
    <section class="admin-pane" id="adminPane-content" hidden><article class="admin-panel"><div class="admin-panel-head"><div><h2>Catalogue de HOLYVIEW</h2><p>Seuls les administrateurs publient les films et les musiques.</p></div><div class="admin-inline"><button class="filter active" data-content-filter="all">Tout</button><button class="filter" data-content-filter="movie">Films</button><button class="filter" data-content-filter="track">Musiques</button></div></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Contenu</th><th>Type</th><th>État</th><th>Téléchargement ELITE</th><th>Action</th></tr></thead><tbody id="contentTable"></tbody></table></div></article></section>
    <section class="admin-pane" id="adminPane-publish" hidden><div class="admin-grid"><article class="admin-panel"><div class="admin-panel-head"><div><h2>Ajouter un contenu</h2><p>Les fichiers audio/vidéo sont déposés dans un stockage privé.</p></div></div>
      <form id="publishForm" class="publish-form">
        <label>Type de contenu<select id="publishType"><option value="movie">Film / vidéo</option><option value="track">Musique / audio</option></select></label>
        <label>Titre du contenu<input id="publishTitle" required maxlength="180" placeholder="Ex. Le chemin de la Grâce"></label>
        <label id="publishSynopsisWrap">Synopsis<textarea id="publishSynopsis" rows="3" maxlength="5000" placeholder="Présente le contenu aux spectateurs…"></textarea></label>
        <label id="publishArtistWrap" hidden>Nom de l’artiste<input id="publishArtist" maxlength="160" placeholder="Nom de l’artiste ou du groupe"></label>
        <div class="admin-two-fields"><label>Année de sortie<input id="publishYear" type="number" min="1900" max="2100" value="2026"></label><label>Affiche (URL d’image)<input id="publishPoster" type="url" placeholder="https://…"></label></div>
        <label>Fichier média (vidéo ou audio)<input id="publishFile" type="file" accept="video/mp4,video/webm,audio/mpeg,audio/mp4,audio/aac,audio/ogg" required><small>Stockage privé. Taille maximale configurée : 2 Go. Pour les gros fichiers, un flux d’envoi reprenable sera nécessaire.</small></label>
        <section id="videoEditor" class="video-editor">
          <div class="video-editor-head"><div><strong>Aperçu & réglages vidéo</strong><small>Vérifie la vidéo avant de l’enregistrer.</small></div><span class="editor-badge">PRÉVISUALISATION</span></div>
          <video id="publishPreview" controls playsinline preload="metadata" hidden></video>
          <div id="previewEmpty" class="preview-empty">Choisis un fichier vidéo pour afficher son aperçu ici.</div>
          <div class="admin-two-fields">
            <label>Début (secondes)<input id="clipStart" type="number" min="0" step="0.1" value="0"></label>
            <label>Fin (secondes)<input id="clipEnd" type="number" min="0" step="0.1" placeholder="Fin du fichier"></label>
          </div>
          <div class="editor-actions"><button type="button" class="small-action" id="previewClip">▶ Prévisualiser l’extrait</button><button type="button" class="small-action" id="resetClip">Réinitialiser les points</button></div>
          <small class="editor-help">Les points de début et de fin définissent l’extrait diffusé sur HOLYVIEW. Le fichier source original reste conservé : cette version ne réencode pas le fichier.</small>
          <label>Sous-titres (facultatif)<input id="publishSubtitles" type="file" accept=".vtt,.srt,text/vtt,application/x-subrip"><small>Importe un fichier .VTT ou .SRT. Les sous-titres seront convertis pour l’aperçu et enregistrés avec la fiche vidéo.</small></label>
          <div id="subtitleStatus" class="editor-help" aria-live="polite">Aucun sous-titre ajouté.</div>
        </section>
        <label class="admin-check"><input id="publishFeatured" type="checkbox"> Mettre ce contenu à la une</label>
        <label class="admin-check"><input id="publishDownload" type="checkbox"> Autoriser le téléchargement hors ligne pour ELITE (à activer uniquement avec les droits nécessaires)</label>
        <label class="admin-check"><input id="publishNow" type="checkbox" checked> Publier dès l’enregistrement</label>
        <div id="publishError" class="admin-error" role="alert"></div><button class="btn btn-pink" id="publishSubmit" type="submit">Téléverser et enregistrer ↗</button>
      </form></article>
      <article class="admin-panel admin-guidance"><div class="admin-guidance-icon">✦</div><h2>Publication responsable</h2><p>Avant de publier, vérifie les droits de diffusion, la licence musicale, l’autorisation des ayants droit et l’âge recommandé.</p><ul><li>Les fichiers sont stockés dans un bucket privé.</li><li>Les visiteurs ne reçoivent pas de lien public permanent.</li><li>Le statut « publié » rend la fiche visible au catalogue.</li><li>La lecture protégée doit être autorisée par le serveur.</li></ul><div class="admin-security-note">La formule ELITE ne rend pas automatiquement un média téléchargeable : la case dédiée doit être cochée par l’administrateur.</div></article></div></section>
  `;
  const navRefresh=document.createElement('button'); navRefresh.id='adminRefreshNav'; navRefresh.className='btn btn-glass admin-refresh-nav'; navRefresh.textContent='↻ Actualiser'; navRefresh.hidden=true; navRight.insertBefore(navRefresh, openBtn.nextSibling);\n  app.insertBefore(admin, document.querySelector('.footer'));
  let isAdmin = false;
  let users = [], subscriptions = [], payments = [], movies = [], tracks = [], contentFilter = 'all';

  const notice = (message, type='info') => { const node=document.getElementById('adminNotice'); node.textContent=message; node.className='admin-notice '+type; node.hidden=!message; };
  const showHome = () => { admin.hidden=true; navRefresh.hidden=true; homeNodes().forEach(node=>{if(node)node.hidden=false}); openBtn.classList.remove('selected'); window.scrollTo({top:0,behavior:'smooth'}); };
  const showAdmin = async () => {
    if (!isAdmin) { toast('Cette zone est réservée aux administrateurs autorisés.'); return; }
    homeNodes().forEach(node=>{if(node)node.hidden=true});
    admin.hidden=false; openBtn.classList.add('selected'); navRefresh.hidden=false;
    document.querySelectorAll('[data-admin-tab]').forEach(b=>b.classList.toggle('active',b.dataset.adminTab==='overview'));
    showPane('overview');
    window.scrollTo({top:0,behavior:'smooth'});
    await refreshAll();
  };
  function showPane(tab) {
    document.querySelectorAll('.admin-pane').forEach(p=>p.hidden=p.id!==`adminPane-${tab}`);
    document.querySelectorAll('[data-admin-tab]').forEach(b=>b.classList.toggle('active',b.dataset.adminTab===tab));
  }
  async function fetchAll(table, columns, orderColumn='created_at') {
    const all=[]; let start=0;
    while (true) {
      const {data,error}=await supabase.from(table).select(columns).order(orderColumn,{ascending:false}).range(start,start+499);
      if(error) throw error;
      all.push(...(data||[]));
      if(!data || data.length<500) break;
      start+=500;
      if(start>20000) break;
    }
    return all;
  }
  async function refreshAll() {
    notice('Mise à jour des données sécurisées…');
    try {
      const [u,s,p,m,t] = await Promise.all([
        fetchAll('profiles','id,email,full_name,display_name,country_code,phone_number,created_at'),
        fetchAll('subscriptions','id,user_id,tier,status,starts_at,ends_at,created_at'),
        fetchAll('payments','id,user_id,amount,currency,status,created_at'),
        fetchAll('movies','id,title,slug,status,is_featured,allow_offline_download,poster_path,created_at,video_asset_path,clip_start_seconds,clip_end_seconds,subtitles'),
        fetchAll('music_tracks','id,title,status,allow_offline_download,audio_asset_path,created_at')
      ]);
      users=u; subscriptions=s; payments=p; movies=m; tracks=t;
      renderOverview(); renderUsers(); renderContent();
      notice('Données actualisées depuis Supabase.', 'success');
    } catch (error) {
      console.error('HOLYVIEW admin refresh',error);
      notice('Impossible de charger toutes les données. Vérifie les autorisations administrateur et les règles RLS.', 'error');
    }
  }
  const latestSub = id => subscriptions.filter(s=>s.user_id===id).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0];
  const activeSub = id => subscriptions.filter(s=>s.user_id===id && s.status==='active' && (!s.ends_at || new Date(s.ends_at)>new Date()) && (!s.starts_at || new Date(s.starts_at)<=new Date())).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0];
  const tierName = tier => ({free:'Gratuit',pro:'PRO',elite:'ELITE'}[tier]||tier||'Gratuit');
  const countryName = code => { try { return code ? new Intl.DisplayNames(['fr'],{type:'region'}).of(code)||code : '—'; } catch { return code||'—'; } };
  const activeTierCounts = () => {const out={free:0,pro:0,elite:0}; users.forEach(u=>{const sub=activeSub(u.id);const tier=sub?.tier||'free';out[tier]=(out[tier]||0)+1});return out};
  function periodStart(period) {
    const now=new Date(), start=new Date(now);
    if(period==='week'){const day=(now.getDay()+6)%7;start.setDate(now.getDate()-day);start.setHours(0,0,0,0)}
    else if(period==='month'){start.setDate(1);start.setHours(0,0,0,0)}
    else if(period==='year'){start.setMonth(0,1);start.setHours(0,0,0,0)}
    else return new Date(0);
    return start;
  }
  function renderOverview() {
    const active=users.filter(u=>activeSub(u.id)).length;
    const paidSubs=users.filter(u=>['pro','elite'].includes(activeSub(u.id)?.tier)).length;
    const confirmed=payments.filter(p=>p.status==='succeeded');
    const today=new Date();const newToday=users.filter(u=>new Date(u.created_at).toDateString()===today.toDateString()).length;
    document.getElementById('adminKpis').innerHTML=[
      ['Membres inscrits',users.length,'Tous les comptes créés','♙'],
      ['Abonnements actifs',active,'PRO + ELITE + accès gratuits actifs','✦'],
      ['Abonnés payants',paidSubs,'Formules PRO et ELITE actives','◆'],
      ['Revenus confirmés',money(confirmed.reduce((n,p)=>n+Number(p.amount||0),0),confirmed.find(p=>p.currency)?.currency||'XOF'),'Total historique des paiements réussis','↗']
    ].map(([label,value,sub,icon])=>`<article class="admin-kpi"><div class="kpi-top"><span>${escapeHtml(label)}</span><b>${icon}</b></div><strong>${escapeHtml(value)}</strong><small>${escapeHtml(sub)}</small></article>`).join('');
    document.getElementById('adminMiniStats').innerHTML=`<div><b>${newToday}</b><span>Inscription(s) aujourd’hui</span></div><div><b>${confirmed.length}</b><span>Paiement(s) confirmé(s)</span></div><div><b>${payments.filter(p=>p.status==='pending').length}</b><span>Paiement(s) en attente</span></div>`;
    const counts=activeTierCounts(), max=Math.max(1,...Object.values(counts));
    document.getElementById('tierBreakdown').innerHTML=['free','pro','elite'].map(t=>`<div class="tier-row"><div><span class="tier-dot ${t}"></span><span>${tierName(t)}</span><b>${counts[t]||0}</b></div><div class="tier-track"><span class="${t}" style="width:${Math.round((counts[t]||0)/max*100)}%"></span></div></div>`).join('');
    document.getElementById('recentUsers').innerHTML=users.slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,6).map(u=>{const s=activeSub(u.id)||latestSub(u.id);return `<tr><td><strong>${escapeHtml(u.full_name||u.display_name||'Utilisateur')}</strong><small>${escapeHtml(u.email||'E-mail non synchronisé')}</small></td><td>${escapeHtml(countryName(u.country_code))}</td><td><span class="tier-pill ${escapeHtml(s?.tier||'free')}">${escapeHtml(tierName(s?.tier||'free'))}</span></td><td>${dateLabel(u.created_at)}</td></tr>`}).join('')||'<tr><td colspan="4" class="table-empty">Aucune inscription pour le moment.</td></tr>';
    renderRevenue();
  }
  function renderRevenue() {
    const period=document.getElementById('revenuePeriod').value, start=periodStart(period);
    const rows=payments.filter(p=>p.status==='succeeded'&&new Date(p.created_at)>=start);
    const total=rows.reduce((n,p)=>n+Number(p.amount||0),0);
    const currency=rows.find(p=>p.currency)?.currency||payments.find(p=>p.currency)?.currency||'XOF';
    document.getElementById('revenueTotal').textContent=money(total,currency);
    const buckets=new Map();
    rows.forEach(p=>{const d=new Date(p.created_at);let key,label;if(period==='year'){key=d.getMonth();label=new Intl.DateTimeFormat('fr-FR',{month:'short'}).format(d)}else if(period==='all'){key=d.getFullYear();label=String(key)}else{key=d.toISOString().slice(0,10);label=new Intl.DateTimeFormat('fr-FR',{day:'2-digit',month:'short'}).format(d)}buckets.set(key,{label,value:(buckets.get(key)?.value||0)+Number(p.amount||0)})});
    let series=[...buckets.entries()].sort((a,b)=>String(a[0]).localeCompare(String(b[0]))).slice(-12).map(([,v])=>v);
    if(!series.length)series=[{label:'Aucun paiement',value:0}];
    const max=Math.max(1,...series.map(x=>x.value));
    document.getElementById('revenueChart').innerHTML=series.map(x=>`<div class="revenue-bar-wrap" title="${escapeHtml(x.label)} : ${escapeHtml(money(x.value,currency))}"><div class="revenue-bar" style="height:${Math.max(3,Math.round(x.value/max*100))}%"></div><span>${escapeHtml(x.label)}</span></div>`).join('');
  }
  function renderUsers() {
    const q=(document.getElementById('userSearch')?.value||'').trim().toLocaleLowerCase('fr');
    const rows=users.filter(u=>[u.full_name,u.display_name,u.email,u.country_code,countryName(u.country_code),u.phone_number].join(' ').toLocaleLowerCase('fr').includes(q)).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    document.getElementById('usersCount').textContent=`${rows.length} utilisateur(s) affiché(s) sur ${users.length} compte(s) chargé(s).`;
    document.getElementById('usersTable').innerHTML=rows.map(u=>{const s=activeSub(u.id)||latestSub(u.id);const status=s?.status||'aucun';return `<tr><td><strong>${escapeHtml(u.full_name||u.display_name||'Utilisateur')}</strong><small>${escapeHtml(u.email||'E-mail non synchronisé')}</small><small class="muted-id">${escapeHtml(u.id)}</small></td><td>${escapeHtml(countryName(u.country_code))}<small>${escapeHtml(u.phone_number||'Numéro non renseigné')}</small></td><td><span class="tier-pill ${escapeHtml(s?.tier||'free')}">${escapeHtml(tierName(s?.tier||'free'))}</span><small>${s?.ends_at?'Fin : '+dateLabel(s.ends_at):'—'}</small></td><td><span class="status-pill ${escapeHtml(status)}">${escapeHtml(status==='aucun'?'Aucun':status)}</span></td><td>${dateLabel(u.created_at)}</td></tr>`}).join('')||'<tr><td colspan="5" class="table-empty">Aucun utilisateur trouvé.</td></tr>';
  }
  function renderContent() {
    const all=[...movies.map(x=>({...x,kind:'movie',media:x.video_asset_path})),...tracks.map(x=>({...x,kind:'track',media:x.audio_asset_path}))].filter(x=>contentFilter==='all'||x.kind===contentFilter).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    document.getElementById('contentTable').innerHTML=all.map(x=>`<tr><td><strong>${escapeHtml(x.title)}</strong><small>${escapeHtml(x.slug||'')}</small></td><td>${x.kind==='movie'?'Film / vidéo':'Musique / audio'}</td><td><span class="status-pill ${escapeHtml(x.status)}">${escapeHtml(x.status)}</span></td><td>${x.allow_offline_download?'<span class="status-pill active">Autorisé</span>':'<span class="muted-text">Non autorisé</span>'}</td><td><div class="admin-actions"><button class="small-action" data-status-id="${escapeHtml(x.id)}" data-status-kind="${x.kind}" data-next-status="${x.status==='published'?'draft':'published'}">${x.status==='published'?'Dépublier':'Publier'}</button><button class="small-action" data-download-id="${escapeHtml(x.id)}" data-download-kind="${x.kind}" data-next-download="${!x.allow_offline_download}">${x.allow_offline_download?'Retirer ELITE':'Autoriser ELITE'}</button></div></td></tr>`).join('')||'<tr><td colspan="5" class="table-empty">Aucun contenu enregistré. Utilise « Publier un média » pour commencer.</td></tr>';
  }
  async function publishContent(event) {
    event.preventDefault();
    const errorNode=document.getElementById('publishError');errorNode.textContent='';
    const type=document.getElementById('publishType').value,title=document.getElementById('publishTitle').value.trim(),file=document.getElementById('publishFile').files[0];
    if(!title||!file){errorNode.textContent='Le titre et le fichier média sont obligatoires.';return}
    const max=2*1024*1024*1024;
    if(file.size>max){errorNode.textContent='Le fichier dépasse la limite de 2 Go configurée.';return}
    if(type==='movie'&&!file.type.startsWith('video/')){errorNode.textContent='Choisis un fichier vidéo.';return}
    if(type==='track'&&!file.type.startsWith('audio/')){errorNode.textContent='Choisis un fichier audio.';return}
    const submit=document.getElementById('publishSubmit');submit.disabled=true;submit.textContent='Téléversement en cours…';
    try{
      const id=crypto.randomUUID(),safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_'),path=`${type==='movie'?'movies':'music'}/${id}/${safeName}`;
      const upload=await supabase.storage.from(BUCKET).upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false,cacheControl:'3600'});
      if(upload.error)throw upload.error;
      const published=document.getElementById('publishNow').checked,status=published?'published':'draft',download=document.getElementById('publishDownload').checked;
      const base={title,slug:`${slugify(title)||type}-${id.slice(0,8)}`,status,published_at:published?new Date().toISOString():null,allow_offline_download:download};
      if(type==='movie'){
        const payload={...base,synopsis:document.getElementById('publishSynopsis').value.trim()||null,poster_path:document.getElementById('publishPoster').value.trim()||null,release_year:Number(document.getElementById('publishYear').value)||null,video_asset_path:path,is_featured:document.getElementById('publishFeatured').checked,clip_start_seconds:Number(document.getElementById('clipStart').value)||0,clip_end_seconds:document.getElementById('clipEnd').value.trim()?Number(document.getElementById('clipEnd').value):null,subtitles:window.hvPreparedSubtitles?[window.hvPreparedSubtitles]:[]};
        const {error}=await supabase.from('movies').insert(payload);if(error)throw error;
      }else{
        const artistName=document.getElementById('publishArtist').value.trim();
        let artist_id=null;
        if(artistName){const {data:artist,error:artistError}=await supabase.from('artists').insert({name:artistName,slug:`${slugify(artistName)||'artiste'}-${id.slice(0,8)}`}).select('id').single();if(artistError)throw artistError;artist_id=artist.id}
        const {error}=await supabase.from('music_tracks').insert({...base,audio_asset_path:path,artist_id});if(error)throw error;
      }
      document.getElementById('publishForm').reset();document.getElementById('publishYear').value=new Date().getFullYear();document.getElementById('publishNow').checked=true;
      toast('Contenu enregistré.');notice('Le média a été téléversé dans le stockage privé et enregistré dans le catalogue.','success');await refreshAll();showPane('content');
    }catch(error){console.error('HOLYVIEW publish',error);errorNode.textContent=error.message||'Impossible de publier ce média. Vérifie les droits administrateur et les règles de stockage.'}
    finally{submit.disabled=false;submit.textContent='Téléverser et enregistrer ↗'}
  }

  openBtn.addEventListener('click',showAdmin);
  document.querySelector('.brand')?.addEventListener('click',()=>{if(!admin.hidden)showHome()});
  document.querySelectorAll('[data-admin-tab]').forEach(b=>b.addEventListener('click',()=>showPane(b.dataset.adminTab)));
  admin.addEventListener('click',async e=>{
    const jump=e.target.closest('[data-jump-tab]');if(jump){showPane(jump.dataset.jumpTab);return}
    const statusBtn=e.target.closest('[data-status-id]');if(statusBtn){const kind=statusBtn.dataset.statusKind,id=statusBtn.dataset.statusId,next=statusBtn.dataset.nextStatus;statusBtn.disabled=true;try{const table=kind==='movie'?'movies':'music_tracks';const {error}=await supabase.from(table).update({status:next,published_at:next==='published'?new Date().toISOString():null}).eq('id',id);if(error)throw error;toast(next==='published'?'Contenu publié.':'Contenu dépublié.');await refreshAll()}catch(error){notice(error.message||'Modification impossible.','error')}return}
    const dlBtn=e.target.closest('[data-download-id]');if(dlBtn){const table=dlBtn.dataset.downloadKind==='movie'?'movies':'music_tracks';const {error}=await supabase.from(table).update({allow_offline_download:dlBtn.dataset.nextDownload==='true'}).eq('id',dlBtn.dataset.downloadId);if(error)notice(error.message||'Modification impossible.','error');else{toast('Autorisation ELITE mise à jour.');await refreshAll()}}
  });
  navRefresh.addEventListener('click',async()=>{if(admin.hidden){await showAdmin()}else{await refreshAll()}});
  document.getElementById('revenuePeriod').addEventListener('change',renderRevenue);
  document.getElementById('userSearch').addEventListener('input',renderUsers);
  document.querySelectorAll('[data-content-filter]').forEach(b=>b.addEventListener('click',()=>{contentFilter=b.dataset.contentFilter;document.querySelectorAll('[data-content-filter]').forEach(x=>x.classList.toggle('active',x===b));renderContent()}));
  document.getElementById('publishType').addEventListener('change',e=>{const track=e.target.value==='track';document.getElementById('publishSynopsisWrap').hidden=track;document.getElementById('publishArtistWrap').hidden=!track;document.getElementById('publishFile').accept=track?'audio/mpeg,audio/mp4,audio/aac,audio/ogg':'video/mp4,video/webm';document.getElementById('publishFile').value=''});
  document.getElementById('publishForm').addEventListener('submit',publishContent);\n  const preview=document.getElementById('publishPreview'), previewFile=document.getElementById('publishFile'), previewEmpty=document.getElementById('previewEmpty'); let previewUrl=null, subtitleUrl=null;\n  previewFile.addEventListener('change',()=>{const file=previewFile.files?.[0];if(!file||!file.type.startsWith('video/')){preview.hidden=true;previewEmpty.hidden=false;return}if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(file);preview.src=previewUrl;preview.hidden=false;previewEmpty.hidden=true;document.getElementById('clipStart').value='0';document.getElementById('clipEnd').value='';});\n  preview.addEventListener('loadedmetadata',()=>{const end=document.getElementById('clipEnd');if(!end.value)end.placeholder='Durée : '+preview.duration.toFixed(1)+' s';});\n  document.getElementById('previewClip').addEventListener('click',async()=>{const start=Math.max(0,Number(document.getElementById('clipStart').value)||0),rawEnd=document.getElementById('clipEnd').value,end=rawEnd?Number(rawEnd):preview.duration;if(!preview.src||!Number.isFinite(preview.duration)){notice('Choisis d’abord une vidéo valide.','error');return}if(start>=end||end>preview.duration){notice('Vérifie les points de début et de fin : ils doivent être compris dans la durée de la vidéo.','error');return}preview.currentTime=start;try{await preview.play()}catch{}preview.dataset.clipEnd=String(end);});\n  preview.addEventListener('timeupdate',()=>{const end=Number(preview.dataset.clipEnd);if(end>0&&preview.currentTime>=end){preview.pause();preview.currentTime=Math.max(0,(Number(document.getElementById('clipStart').value)||0));}});\n  document.getElementById('resetClip').addEventListener('click',()=>{document.getElementById('clipStart').value='0';document.getElementById('clipEnd').value='';delete preview.dataset.clipEnd;if(preview.src)preview.currentTime=0;});\n  document.getElementById('publishSubtitles').addEventListener('change',async e=>{const file=e.target.files?.[0];window.hvPreparedSubtitles=null;if(subtitleUrl){URL.revokeObjectURL(subtitleUrl);subtitleUrl=null}if(!file){document.getElementById('subtitleStatus').textContent='Aucun sous-titre ajouté.';return}try{let content=await file.text();if(file.name.toLowerCase().endsWith('.srt'))content='WEBVTT\\n\\n'+content.replace(/\\r/g,'').replace(/^(\\d+)\\n/gm,'').replace(/(\\d{2}:\\d{2}:\\d{2}),(\\d{3})/g,'$1.$2');else if(!content.trimStart().startsWith('WEBVTT'))content='WEBVTT\\n\\n'+content;window.hvPreparedSubtitles={language:'fr',label:'Français',vtt:content};subtitleUrl=URL.createObjectURL(new Blob([content],{type:'text/vtt'}));const old=preview.querySelector('track');if(old)old.remove();const track=document.createElement('track');track.kind='subtitles';track.label='Français';track.srclang='fr';track.src=subtitleUrl;track.default=true;preview.append(track);track.track.mode='showing';document.getElementById('subtitleStatus').textContent='Sous-titres chargés : '+file.name+' (aperçu activé).';}catch{document.getElementById('subtitleStatus').textContent='Impossible de lire ce fichier de sous-titres.';}});
  async function checkAdmin(user) {
    isAdmin=false;openBtn.hidden=true;
    if(!user)return;
    try { const {data,error}=await supabase.from('admin_users').select('role').eq('user_id',user.id).maybeSingle();if(!error&&data){isAdmin=true;openBtn.hidden=false;openBtn.title=`Accès administrateur · ${data.role}`;} }
    catch(error){console.warn('Admin role check failed',error)}
    if(!isAdmin&&!admin.hidden)showHome();
  }
  const {data}=await supabase.auth.getUser();await checkAdmin(data.user);
  supabase.auth.onAuthStateChange((_event,session)=>{void checkAdmin(session?.user||null)});
}
