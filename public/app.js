const $ = id => document.getElementById(id);
const socket = io();
const palette = ['#8e7cdc','#cf8fb4','#699f9a','#d79572','#748eca','#b17fca'];
let myName = '', currentRoom = '', people = [], toastTimer, audioContext = null;
const speakingPeople = new Set(), speechMonitors = new Map();
const welcomeDialog = $('welcome-dialog');
welcomeDialog.showModal();

function toast(message) {
  const el = $('toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
function avatarColor(name) { let n = 0; for (const c of name) n += c.charCodeAt(0); return palette[n % palette.length]; }
function addMessage(msg) {
  const row = document.createElement('article'); row.className = 'message';
  const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.style.background = avatarColor(msg.name); avatar.textContent = msg.name.slice(0,1).toUpperCase();
  const body = document.createElement('div'); body.className = 'message-body';
  const meta = document.createElement('div'); meta.className = 'message-meta';
  const name = document.createElement('strong'); name.textContent = msg.name;
  const time = document.createElement('time'); time.textContent = new Date(msg.at).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
  const text = document.createElement('div'); text.textContent = msg.body;
  meta.append(name, time); body.append(meta, text); row.append(avatar, body); $('messages').append(row); $('chat').scrollTop = $('chat').scrollHeight;
}
function renderPeople() {
  $('online-count').innerHTML = `<i></i> ${people.length} here`;
  $('voice-members').replaceChildren();
  for (const person of people) {
    const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.style.background = avatarColor(person.name); avatar.textContent = person.name.slice(0,1).toUpperCase();
    if (person.voice) { const mini=document.createElement('div'); mini.className=`voice-member ${speakingPeople.has(person.id)?'speaking':''}`; mini.dataset.personId=person.id; const a=avatar.cloneNode(true); const miniName=document.createElement('span');miniName.className='voice-member-name';miniName.textContent=person.name;mini.append(a,miniName);if(person.live)addLiveBadge(mini,person);$('voice-members').append(mini); }
  }
  if(previewingPersonId&&!people.some(person=>person.id===previewingPersonId&&person.live))closeStreamPreview();
  setScreenShareLayout();
}
function joinRoom(name, room) {
  myName = name.trim() || 'Friend'; currentRoom = room.trim().toLowerCase().replace(/[^a-z0-9-]/g,'-') || 'hangout';
  $('self-name').textContent = myName; $('self-avatar').textContent = myName.slice(0,1).toUpperCase(); $('room-title').textContent = `${currentRoom} hangout`;
  history.replaceState({}, '', `/${encodeURIComponent(currentRoom)}`); socket.emit('room:join',{name:myName,room:currentRoom});
}
$('join-form').addEventListener('submit', e => { e.preventDefault(); const name=$('name-input').value.trim()||'Friend'; const room=$('room-input').value.trim()||'hangout'; welcomeDialog.close(); joinRoom(name,room); });
socket.on('connect', () => { $('connection-state').textContent = 'Online'; $('self-avatar').dataset.speakerId=socket.id; });
socket.on('disconnect', () => { $('connection-state').textContent = 'Reconnecting…'; toast('Connection lost. Trying to reconnect…'); });
socket.on('room:ready', ({room,messages}) => { currentRoom=room; $('room-title').textContent=`${room} hangout`; $('messages').replaceChildren(); messages.forEach(addMessage); $('connection-state').textContent='Online'; });
socket.on('people', list => {
  const endedShares=people.filter(previous=>previous.live&&!list.some(current=>current.id===previous.id&&current.live));
  people=list;
  for(const previous of endedShares){
    const current=people.find(person=>person.id===previous.id);
    if(current?.camera)continue;
    const oldTile=document.getElementById(`tile-${previous.id}`),video=oldTile?.querySelector('video');
    closeTheaterFor(video?.srcObject);oldTile?.remove();
  }
  renderPeople();
});
socket.on('chat:message', addMessage);
$('chat-form').addEventListener('submit', e => { e.preventDefault(); const input=$('message-input'); const body=input.value.trim(); if(body){socket.emit('chat:send',body);input.value='';} });
$('invite-button').addEventListener('click', async () => { const url = `${location.origin}/${encodeURIComponent(currentRoom)}`; try { await navigator.clipboard.writeText(url); toast('Invite link copied — send it to your friends.'); } catch { toast(`Share this link: ${url}`); } });
$('settings-button').addEventListener('click', () => { $('edit-name-input').value=myName; $('media-dialog').showModal(); });
$('save-name').addEventListener('click', () => { const next=$('edit-name-input').value.trim(); if(next){myName=next;$('self-name').textContent=next;$('self-avatar').textContent=next.slice(0,1).toUpperCase(); socket.emit('profile:rename',next); toast('Name updated for this session.');} $('media-dialog').close(); });
socket.on('profile:renamed', ({id,name}) => { const p=people.find(x=>x.id===id); if(p){p.name=name;renderPeople();} });
$('self-name').addEventListener('click',()=>{ $('edit-name-input').value=myName; $('media-dialog').showModal(); });
document.querySelector('.voice-channel').addEventListener('click',()=>{showCallPanel(true);setCallStatus(inVoice?`${peers.size+1} in the lounge`:'Ready when you are — join voice to start chatting.');$('call-panel').scrollIntoView({behavior:'smooth',block:'nearest'});});

// WebRTC carries audio, camera, and screen media directly between people in a room.
const peers = new Map();
let localStream = null, cameraTrack = null, screenTrack = null, inVoice = false;
let previewingPersonId = null, watchingStreamId = null;
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
function showCallPanel(show) { $('call-panel').hidden = !show; }
function setCallStatus(text) { $('call-status').textContent = text; }
function renderScreenParticipants() {
  const row=$('screen-participants'); row.replaceChildren();
  for(const person of people.filter(item=>item.voice)){
    const card=document.createElement('div');card.className=`screen-user-card ${speakingPeople.has(person.id)?'speaking':''}`;card.dataset.speakerId=person.id;
    const source=person.live?null:document.getElementById(`tile-${person.id}`)?.querySelector('video');
    const stream=source?.srcObject, hasVideo=stream?.getVideoTracks?.().some(track=>track.readyState==='live');
    if(hasVideo){const video=document.createElement('video');video.autoplay=true;video.playsInline=true;video.muted=person.id===socket.id;video.srcObject=stream;card.append(video);}
    else {const avatar=document.createElement('div');avatar.className='screen-user-avatar';avatar.style.background=avatarColor(person.name);avatar.textContent=person.name.slice(0,1).toUpperCase();card.append(avatar);}
    const name=document.createElement('span');name.textContent=person.id===socket.id?`${person.name} (you)`:person.name;card.append(name);row.append(card);
  }
}
function setScreenShareLayout() {
  const sharer=people.find(person=>person.id===watchingStreamId&&person.live), app=$('app-shell'), view=$('screen-call-view'), panel=$('call-panel');
  document.querySelectorAll('.video-tile').forEach(box=>{
    const person=people.find(item=>item.id===box.dataset.speakerId);
    box.classList.toggle('stream-hidden',Boolean(person?.live&&person.id!==watchingStreamId));
  });
  if(!sharer){
    if(watchingStreamId&&!people.some(person=>person.id===watchingStreamId&&person.live))watchingStreamId=null;
    app.classList.remove('screen-share-active');view.hidden=true;
    if(panel.parentElement!==$('main-area'))$('chat').insertAdjacentElement('afterend',panel);
    $('screen-stage-video').srcObject=null;setCallStatus(inVoice?`${peers.size+1} in the lounge`:'Lounge is quiet');return;
  }
  app.classList.add('screen-share-active');view.hidden=false;
  if(panel.parentElement!==view)view.append(panel);
  if(panel.hidden)showCallPanel(true);
  $('screen-stage-title').textContent=`${sharer.name} is sharing`;
  const source=document.getElementById(`tile-${sharer.id}`)?.querySelector('video'),stream=source?.srcObject||null;
  $('screen-stage-video').srcObject=stream;$('screen-stage-wait').hidden=Boolean(stream);
  if(!stream){const message=inVoice?'Waiting for the stream…':'Join voice to watch this stream.';setCallStatus(message);$('screen-stage-wait').textContent=message;}
  renderScreenParticipants();
}
function setSpeaking(id, active) {
  if(active)speakingPeople.add(id); else speakingPeople.delete(id);
  document.querySelectorAll('.person, .voice-member, .video-tile, .screen-user-card, #self-avatar').forEach(el=>{
    if(el.dataset.personId===id||el.dataset.speakerId===id)el.classList.toggle('speaking',active);
  });
}
function monitorSpeech(id, stream) {
  if(!audioContext||speechMonitors.has(id)||!stream.getAudioTracks().length)return;
  try {
    const source=audioContext.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    const analyser=audioContext.createAnalyser(); analyser.fftSize=512; source.connect(analyser);
    const samples=new Uint8Array(analyser.fftSize); let frame=0, active=false;
    const check=()=>{
      analyser.getByteTimeDomainData(samples); let sum=0;
      for(const sample of samples){const value=(sample-128)/128;sum+=value*value;}
      const rms=Math.sqrt(sum/samples.length), enabled=stream.getAudioTracks().some(track=>track.enabled&&track.readyState==='live');
      const next=enabled&&(active?rms>0.021:rms>0.038);
      if(next!==active){active=next;setSpeaking(id,active);}
      frame=requestAnimationFrame(check);
    };
    const monitor={source,analyser,stop:()=>{cancelAnimationFrame(frame);source.disconnect();analyser.disconnect();setSpeaking(id,false);}};
    speechMonitors.set(id,monitor); check();
  } catch(err) { console.warn('Speaking indicator:',err); }
}
function stopSpeechMonitor(id) { const monitor=speechMonitors.get(id); if(monitor){monitor.stop();speechMonitors.delete(id);} }
function tile(id, name, stream, local = false) {
  let box = document.getElementById(`tile-${id}`);
  if (!box) { box=document.createElement('div'); box.className=`video-tile ${speakingPeople.has(id)?'speaking':''}`; box.id=`tile-${id}`; box.dataset.speakerId=id; const video=document.createElement('video'); video.autoplay=true; video.playsInline=true; if(local) video.muted=true; const label=document.createElement('span'); label.textContent=name; box.append(video,label); $('video-grid').append(box); }
  box.querySelector('span').textContent=name; box.querySelector('video').srcObject=stream;
  if(previewingPersonId===id)updateStreamPreview();
  if(people.some(person=>person.live))setScreenShareLayout();
}
function addLiveBadge(parent,person) {
  const badge=document.createElement('button'); badge.type='button'; badge.className='live-pill live-pill-button'; badge.textContent='LIVE'; badge.setAttribute('aria-label',`Preview ${person.name}'s live stream`);
  badge.addEventListener('click',event=>{event.stopPropagation();showStreamPreview(person.id,person.name,badge);}); parent.append(badge);
}
function updateStreamPreview() {
  if(!previewingPersonId)return;
  const video=document.getElementById(`tile-${previewingPersonId}`)?.querySelector('video');
  const stream=video?.srcObject||null;
  $('stream-preview-video').srcObject=stream;
  $('stream-preview-placeholder').hidden=Boolean(stream);
  $('watch-stream-button').disabled=!stream;
}
function showStreamPreview(id,name,anchor) {
  previewingPersonId=id; $('stream-preview-name').textContent=`${name}'s screen`;
  const popover=$('stream-popover'), rect=anchor.getBoundingClientRect(), width=Math.min(320,window.innerWidth-24);
  popover.style.width=`${width}px`;
  const left=Math.min(window.innerWidth-width-12,Math.max(12,rect.right+12));
  const top=Math.min(window.innerHeight-250,Math.max(12,rect.top-28));
  popover.style.left=`${left}px`;popover.style.top=`${top}px`;popover.hidden=false;updateStreamPreview();
}
function closeStreamPreview() { $('stream-popover').hidden=true;$('stream-preview-video').srcObject=null;$('watch-stream-button').disabled=true;previewingPersonId=null; }
document.addEventListener('click',event=>{if(!$('stream-popover').hidden&&!event.target.closest('#stream-popover, .live-pill-button'))closeStreamPreview();});
$('watch-stream-button').addEventListener('click',async()=>{
  const id=previewingPersonId,person=people.find(item=>item.id===id),video=document.getElementById(`tile-${id}`)?.querySelector('video');
  if(!video?.srcObject)return;
  watchingStreamId=id;closeStreamPreview();setScreenShareLayout();
});
$('screen-stage-exit').addEventListener('click',()=>{watchingStreamId=null;setScreenShareLayout();});
function openTheater(video, title) {
  $('theater-title').textContent=title; $('theater-video').srcObject=video.srcObject;
  if(!$('theater-dialog').open)$('theater-dialog').showModal();
}
$('video-grid').addEventListener('click',e=>{const box=e.target.closest('.video-tile');if(box)openTheater(box.querySelector('video'),box.querySelector('span').textContent);});
$('theater-close').addEventListener('click',()=>$('theater-dialog').close());
$('theater-dialog').addEventListener('close',()=>{$('theater-video').srcObject=null;});
$('theater-video').addEventListener('dblclick',async()=>{try{if(document.fullscreenElement!==$('theater-dialog'))await $('theater-dialog').requestFullscreen();else await document.exitFullscreen();}catch{}});
function closeTheaterFor(stream) { if($('theater-video').srcObject===stream)$('theater-dialog').close(); }
function removePeer(id) {
  stopSpeechMonitor(id);
  const peer=peers.get(id); if(peer){closeTheaterFor(peer.remote);peer.pc.close();peer.audio.remove();peers.delete(id);}
  document.getElementById(`tile-${id}`)?.remove();
  setCallStatus(inVoice ? `${peers.size + 1} in the lounge` : 'Lounge is quiet');
}
function getVideoSender(pc) {
  return pc.getSenders().find(sender=>sender.track?.kind==='video')
    || pc.getTransceivers().find(transceiver=>transceiver.receiver.track.kind==='video')?.sender
    || null;
}
function makePeer(id, name) {
  if(peers.has(id)) return peers.get(id);
  const pc=new RTCPeerConnection(rtcConfig), remote=new MediaStream(), audio=document.createElement('audio');
  audio.autoplay=true; audio.playsInline=true; audio.srcObject=remote; document.body.append(audio);
  const state={pc,remote,audio,name,makingOffer:false,ignoreOffer:false,polite:socket.id.localeCompare(id)>0}; peers.set(id,state);
  if(localStream) for(const track of localStream.getTracks()) pc.addTrack(track,localStream);
  pc.ontrack=e=>{ e.streams[0]?.getTracks().forEach(t=>{if(!remote.getTracks().some(x=>x.id===t.id))remote.addTrack(t);}); audio.srcObject=remote; monitorSpeech(id,remote); if(remote.getVideoTracks().length)tile(id,state.name,remote); };
  pc.onicecandidate=e=>{if(e.candidate)socket.emit('rtc:signal',{to:id,data:{candidate:e.candidate}});};
  pc.onnegotiationneeded=async()=>{try{state.makingOffer=true;await pc.setLocalDescription();socket.emit('rtc:signal',{to:id,data:{description:pc.localDescription}});}catch(err){console.warn('Call setup:',err);}finally{state.makingOffer=false;}};
  return state;
}
async function enableVoice() {
  try {
    if(!audioContext)audioContext=new(window.AudioContext||window.webkitAudioContext)();
    if(audioContext.state==='suspended')await audioContext.resume();
    localStream=await navigator.mediaDevices.getUserMedia({audio:true});
    $('self-avatar').dataset.speakerId=socket.id; monitorSpeech(socket.id,localStream);
    inVoice=true; socket.emit('voice:join'); showCallPanel(true);
    $('mic-button').textContent='🎙 Mute'; $('mic-button').title='Mute microphone'; $('camera-button').disabled=false; $('screen-button').disabled=false; $('leave-button').disabled=false;
    setCallStatus('Connecting to the lounge…');
  } catch(err) { toast(err.name==='NotAllowedError'?'Microphone access was blocked. Allow it in your browser settings.':'Could not start your microphone. Check that it is connected.'); }
}
$('mic-button').addEventListener('click', async()=>{
  if(!inVoice){await enableVoice();return;}
  const track=localStream?.getAudioTracks()[0]; if(track){track.enabled=!track.enabled;$('mic-button').textContent=track.enabled?'🎙 Mute':'🎙 Unmute';}
});
socket.on('voice:peers', list=>{for(const p of list)makePeer(p.id,p.name);setCallStatus(`${list.length+1} in the lounge`);});
socket.on('voice:peer-joined', p=>{const state=makePeer(p.id,p.name);state.name=p.name;setCallStatus('A friend is joining…');});
socket.on('voice:peer-left',id=>removePeer(id));
socket.on('rtc:signal',async({from,data})=>{
  const person=people.find(x=>x.id===from); const state=makePeer(from,person?.name||'Friend'); const pc=state.pc;
  try {
    if(data.description){
      const description=data.description, collision=description.type==='offer'&&(state.makingOffer||pc.signalingState!=='stable');
      state.ignoreOffer=!state.polite&&collision; if(state.ignoreOffer)return;
      if(collision)await pc.setLocalDescription({type:'rollback'});
      await pc.setRemoteDescription(description);
      if(description.type==='offer'){await pc.setLocalDescription();socket.emit('rtc:signal',{to:from,data:{description:pc.localDescription}});}
    } else if(data.candidate) { try{await pc.addIceCandidate(data.candidate);}catch(err){if(!state.ignoreOffer)throw err;} }
  } catch(err){console.warn('Call signal:',err);}
});
$('camera-button').addEventListener('click',async()=>{
  try{
    if(cameraTrack){cameraTrack.stop();cameraTrack=null;$('camera-button').textContent='▣ Camera';closeTheaterFor(localStream);document.getElementById(`tile-${socket.id}`)?.remove();for(const state of peers.values()){const sender=getVideoSender(state.pc);if(sender)await sender.replaceTrack(null);}socket.emit('camera:state',false);return;}
    const stream=await navigator.mediaDevices.getUserMedia({video:true});cameraTrack=stream.getVideoTracks()[0];
    if(!localStream)localStream=new MediaStream(); localStream.addTrack(cameraTrack); tile(socket.id,`${myName} (you)`,localStream,true);
    for(const state of peers.values()){const sender=getVideoSender(state.pc);if(sender)await sender.replaceTrack(cameraTrack);else state.pc.addTrack(cameraTrack,localStream);}
    $('camera-button').textContent='▣ Stop camera';socket.emit('camera:state',true);
  }catch(err){toast(err.name==='NotAllowedError'?'Allow camera access to turn video on.':'Could not start your camera.');}
});
async function stopScreenShare() {
  const track=screenTrack;
  if(!track)return;
  screenTrack=null;
  track.onended=null;
  if(track.readyState==='live')track.stop();
  const localVideo=document.getElementById(`tile-${socket.id}`)?.querySelector('video');
  closeTheaterFor(localVideo?.srcObject);
  if(cameraTrack&&localStream)tile(socket.id,`${myName} (you)`,localStream,true);
  else document.getElementById(`tile-${socket.id}`)?.remove();
  const self=people.find(person=>person.id===socket.id);
  if(self)self.live=false;
  renderPeople();
  $('screen-button').textContent='▤ Share screen';
  for(const state of peers.values()){
    const sender=getVideoSender(state.pc);
    if(sender){try{await sender.replaceTrack(cameraTrack||null);}catch(err){console.warn('Could not restore video after screen share:',err);}}
  }
  socket.emit('stream:state',false);
}
$('screen-button').addEventListener('click',async()=>{
  try{
    if(screenTrack){await stopScreenShare();return;}
    const stream=await navigator.mediaDevices.getDisplayMedia({video:true}); screenTrack=stream.getVideoTracks()[0];
    socket.emit('stream:state',true);
    const self=people.find(person=>person.id===socket.id);if(self)self.live=true;renderPeople();
    for(const state of peers.values()){const sender=getVideoSender(state.pc);if(sender)await sender.replaceTrack(screenTrack);else state.pc.addTrack(screenTrack,stream);}
    tile(socket.id,`${myName} is sharing`,stream,true); $('screen-button').textContent='▤ Stop sharing';
    screenTrack.onended=()=>{void stopScreenShare();};
  }catch(err){if(err.name!=='NotAllowedError')toast('Screen sharing could not start.');}
});
$('leave-button').addEventListener('click',async()=>{
  if(screenTrack)await stopScreenShare();
  socket.emit('voice:leave'); for(const id of [...peers.keys()])removePeer(id);
  stopSpeechMonitor(socket.id);
  closeTheaterFor(localStream);
  localStream?.getTracks().forEach(t=>t.stop());localStream=null;cameraTrack=null;screenTrack=null;inVoice=false;
  $('mic-button').textContent='🎙 Join voice';$('mic-button').title='Join voice';$('camera-button').textContent='▣ Camera';$('screen-button').textContent='▤ Share screen';$('camera-button').disabled=true;$('screen-button').disabled=true;$('leave-button').disabled=true;
  $('video-grid').replaceChildren();setCallStatus('Lounge is quiet');showCallPanel(false);
});
socket.on('connect_error',()=>{ $('connection-state').textContent='Offline'; });

// Read a room name from a shared URL, while leaving name selection to the visitor.
const pathRoom = decodeURIComponent(location.pathname.slice(1)).replace(/[^a-z0-9-]/gi,'').slice(0,32);
if (pathRoom) $('room-input').value = pathRoom;
