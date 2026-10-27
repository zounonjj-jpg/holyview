import './player.css';

export function attachPlayer({supabase,getUser,openAuth,toast}) {
  if(document.getElementById('hvPlayerModal')) return;
  document.body.insertAdjacentHTML('beforeend',`
    <div class="hv-player-modal" id="hvPlayerModal" hidden role="dialog" aria-modal="true" aria-labelledby="hvPlayerTitle">
      <div class="hv-player-window">
        <header class="hv-player-head"><div class="hv-player-heading"><strong id="hvPlayerTitle">HOLYVIEW</strong><small id="hvPlayerSubtitle">Lecture sécurisée</small></div><button type="button" class="hv-player-close" id="hvPlayerClose" aria-label="Fermer le lecteur">×</button></header>
        <div class="hv-player-media"><video id="hvVideo" controls playsinline preload="metadata" hidden></video><audio id="hvAudio" controls preload="metadata" hidden></audio></div>
        <p id="hvPlayerMessage" class="hv-player-message" role="status"></p>
      </div>
    </div>`);
  const modal=document.getElementById('hvPlayerModal'),video=document.getElementById('hvVideo'),audio=document.getElementById('hvAudio');
  const title=document.getElementById('hvPlayerTitle'),subtitle=document.getElementById('hvPlayerSubtitle'),message=document.getElementById('hvPlayerMessage');
  let sessionId=null, heartbeat=null, heartbeatTarget=null, opening=false, activeClipStart=0, activeClipEnd=null, subtitleUrl=null, activeMovieId=null, viewLogged=false;
  const clearHeartbeat=()=>{if(heartbeat){clearInterval(heartbeat);heartbeat=null}heartbeatTarget=null;};
  const sendHeartbeat=async()=>{
    if(!sessionId)return;
    try{
      const state=await invoke({action:'heartbeat',sessionId});
      if(state.stopped){
        const target=heartbeatTarget;
        clearHeartbeat();
        if(target)target.pause();
        message.textContent=state.error||'Accès interrompu.';
        message.className='hv-player-message error';
        return;
      }
      if(state.trialRemainingSeconds!==null&&state.trialRemainingSeconds!==undefined){
        message.textContent=`Essai gratuit : environ ${Math.floor(state.trialRemainingSeconds/3600)} h ${Math.floor((state.trialRemainingSeconds%3600)/60)} min restantes.`;
      }
    }catch(error){
      const target=heartbeatTarget;
      clearHeartbeat();
      if(target)target.pause();
      message.textContent=error.message||'La vérification de la session a échoué.';
      message.className='hv-player-message error';
    }
  };
  const startHeartbeat=target=>{
    heartbeatTarget=target;
    if(!heartbeat)heartbeat=setInterval(()=>{void sendHeartbeat()},30000);
  };
  const invoke=async body=>{
    const result=await supabase.functions.invoke('holyview-playback',{body});
    if(result.error) {
      const ctx=result.error.context;
      let detail='';
      try { if(ctx?.json) {const j=await ctx.json();detail=j.error||''} } catch {}
      throw new Error(detail||result.error.message||'Le contrôle de lecture est indisponible.');
    }
    if(result.data?.error && !result.data?.ok) throw new Error(result.data.error);
    return result.data||{};
  };
  const stopSession=async()=>{
    clearHeartbeat();
    const old=sessionId;sessionId=null;
    video.pause();audio.pause();
    if(old){try{await supabase.functions.invoke('holyview-playback',{body:{action:'stop',sessionId:old}})}catch{}}
  };
  const close=async()=>{await stopSession();modal.hidden=true;video.removeAttribute('src');audio.removeAttribute('src');video.querySelectorAll('track').forEach(t=>t.remove());if(subtitleUrl){URL.revokeObjectURL(subtitleUrl);subtitleUrl=null}video.load();audio.load();message.textContent='';message.className='hv-player-message'};
  async function play(detail) {
    if(opening)return;
    const user=getUser();
    if(!user){openAuth('login');toast('Connecte-toi pour accéder à ce média.');return}
    opening=true;activeMovieId=detail.kind==='movie'?detail.item.id:null;viewLogged=false;message.textContent='Vérification de tes droits de lecture…';message.className='hv-player-message';modal.hidden=false;
    title.textContent=detail.item.title||'HOLYVIEW';subtitle.textContent=detail.kind==='movie'?(detail.item.display_format==='short'?'Short · lecture sécurisée · cadrage 9:16':'Vidéo · lecture sécurisée · cadrage préservé'):'Musique · lecture sécurisée';video.classList.toggle('hv-short',detail.kind==='movie'&&detail.item.display_format==='short');
    try{
      await stopSession();
      const data=await invoke({action:'authorize',mediaType:detail.kind,mediaId:detail.item.id});
      sessionId=data.sessionId;
      video.hidden=detail.kind!=='movie';audio.hidden=detail.kind!=='track';
      const target=detail.kind==='movie'?video:audio;
      if(subtitleUrl){URL.revokeObjectURL(subtitleUrl);subtitleUrl=null}
      video.querySelectorAll('track').forEach(t=>t.remove());
      activeClipStart=detail.kind==='movie'?Math.max(0,Number(detail.item.clip_start_seconds)||0):0;
      activeClipEnd=detail.kind==='movie'&&detail.item.clip_end_seconds!==null&&detail.item.clip_end_seconds!==undefined?Number(detail.item.clip_end_seconds):null;
      if(detail.kind==='movie'&&Array.isArray(detail.item.subtitles)&&detail.item.subtitles[0]?.vtt){
        subtitleUrl=URL.createObjectURL(new Blob([detail.item.subtitles[0].vtt],{type:'text/vtt'}));
        const track=document.createElement('track');track.kind='subtitles';track.label=detail.item.subtitles[0].label||'Français';track.srclang=detail.item.subtitles[0].language||'fr';track.src=subtitleUrl;track.default=true;video.append(track);
        track.addEventListener('load',()=>{try{track.track.mode='showing'}catch{}});
      }
      target.src=data.url;target.load();
      if(detail.kind==='movie'&&activeClipStart>0)target.addEventListener('loadedmetadata',()=>{target.currentTime=activeClipStart},{once:true});
      const remain=data.trialRemainingSeconds;
      message.textContent=remain===null?'Accès autorisé · '+String(data.tier||'').toUpperCase():`Essai gratuit : environ ${Math.floor(remain/3600)} h ${Math.floor((remain%3600)/60)} min restantes.`;
      try{await target.play()}catch{message.textContent+=' Appuie sur Lecture pour démarrer.'}
    }catch(error){
      message.textContent=error.message||'Ce média ne peut pas être lu actuellement.';
      message.className='hv-player-message error';
      toast(error.message||'Lecture non autorisée.');
    }finally{opening=false}
  }
  document.getElementById('hvPlayerClose').addEventListener('click',close);
  modal.addEventListener('click',e=>{if(e.target===modal)close()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modal.hidden)close()});
  [video,audio].forEach(target=>{
    target.addEventListener('timeupdate',()=>{if(target===video&&activeClipEnd!==null&&Number.isFinite(activeClipEnd)&&target.currentTime>=activeClipEnd){target.pause();target.currentTime=activeClipStart;message.textContent='Fin de l’extrait.'}});
    target.addEventListener('playing',()=>{if(sessionId)startHeartbeat(target);if(target===video&&activeMovieId&&!viewLogged){const user=getUser();if(user){viewLogged=true;void supabase.from('video_views').insert({movie_id:activeMovieId,user_id:user.id,view_date:new Date().toISOString().slice(0,10)}).then(({error})=>{if(error&&error.code!=='23505')console.warn('HOLYVIEW view tracking',error);else window.dispatchEvent(new CustomEvent('holyview:view-recorded',{detail:{movieId:activeMovieId}}))})}}});
    target.addEventListener('pause',()=>{if(heartbeat){clearHeartbeat();void sendHeartbeat()}});
    target.addEventListener('ended',()=>{void stopSession()});
  });
  window.addEventListener('holyview:play',e=>{void play(e.detail)});
}
