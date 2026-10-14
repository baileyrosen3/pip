import {createAvatar} from './avatar.js';
import {PipAudio} from './audio.js';
import {applyTheme, defaultTheme} from './theme.js';
import {enter, showCaption, hideCaption, springEasing} from './motion.js';
import {createPointerPicker} from './pointer-picker.js';
const $=id=>document.getElementById(id);
const storage={
  get(key){try{return localStorage.getItem(`pip.${key}`);}catch{return null;}},
  set(key,value){try{localStorage.setItem(`pip.${key}`,value);}catch{notice('Allow browser storage to remember your connection.');}},
  remove(key){try{localStorage.removeItem(`pip.${key}`);}catch{}}
};
let token=storage.get('token');
const hash=new URLSearchParams(location.hash.slice(1));
if(hash.has('token')){token=hash.get('token');storage.set('token',token);history.replaceState(null,'',location.pathname+location.search);}
let clientId=storage.get('clientId');
if(!clientId){clientId=crypto.randomUUID();storage.set('clientId',clientId);}
let ws,connected=false,host='',state='asleep',retries=0,reconnectTimer,wakeLock,noticeTimer;
let detailId,detailData,sessions=[],captionTimer,holding=false,pointerId=null,holdTimer,pokeTimer,lastTap=0,lastPoint=null;
const settings={provider:'gemini',voice:true,voiceName:'Puck',color:'theme',pointer:'arrow',eyeStyle:'flat',eyeSize:1,cursorSize:44,showCursor:true,followMouse:true,computerControl:true,monitor:'auto',personality:'',volume:1,replyMode:'talk'};
const keys={openai:null,gemini:null};
const providerNames={openai:'OpenAI Realtime',gemini:'Gemini',gptlive:'GPT-Live'};
const voices={openai:['marin','cedar','alloy','ash','ballad','coral','echo','sage','shimmer','verse'],gemini:['Puck','Kore','Charon','Fenrir','Aoede','Leda','Orus','Zephyr'],gptlive:['vesper','marin','ripple','quartz','willow','stone','gleam','meridian','beacon','delta','cinder','bossa','tempo']};
const keyProvider=()=>settings.provider==='gemini'?'gemini':'openai';
let captionText='',captionFinished=false;
let theme=defaultTheme,swatchKey='';
function notice(message,persistent=false){clearTimeout(noticeTimer);$('notice').textContent=message;$('notice').hidden=!message;if(message&&!persistent)noticeTimer=setTimeout(()=>$('notice').hidden=true,7000);}
function send(message){if(ws?.readyState===WebSocket.OPEN){ws.send(JSON.stringify(message));return true;}return false;}
const audio=new PipAudio(send,data=>{if(ws?.readyState===WebSocket.OPEN&&ws.bufferedAmount<96000)ws.send(data);},notice,on=>{$('audio-unlock').hidden=!on;});
audio.onPlayback=on=>{avatar.setState(on?'speaking':state);scheduleCaptionHide();};
function fitCaption(){
  const caption=$('caption');if(caption.hidden)return;
  caption.style.fontSize='23px';
  while(caption.scrollHeight>caption.clientHeight+1&&parseFloat(caption.style.fontSize)>15)caption.style.fontSize=`${parseFloat(caption.style.fontSize)-1}px`;
}
function scheduleCaptionHide(){
  clearTimeout(captionTimer);
  if(!captionText||!captionFinished||audio.playing())return;
  const duration=Math.max(4000,captionText.trim().split(/\s+/).length*300);
  captionTimer=setTimeout(()=>{if(!audio.playing()){captionText='';hideCaption($('caption'));}},duration);
}
function receiveCaption(text,done){
  const continuing=captionText&&text.startsWith(captionText);
  clearTimeout(captionTimer);captionText=text;captionFinished=!!done;
  if(!text){const caption=$('caption');caption.getAnimations({subtree:true}).forEach(animation=>animation.cancel());caption.replaceChildren();caption.hidden=true;return;}
  // A new reply starts at the top; while it streams, keep the newest words in view.
  showCaption($('caption'),text);fitCaption();const caption=$('caption');caption.scrollTop=continuing?caption.scrollHeight:0;scheduleCaptionHide();
}
const avatar=createAvatar($('face')),pairAvatar=createAvatar($('pair-avatar'));
const pointerPicker=createPointerPicker($('pointer-picker'));
const eyePicker=createPointerPicker($('eye-picker'),true);
pairAvatar.setState('asleep');
setInterval(()=>{avatar.setLevel(audio.level());avatar.setHear(audio.hearLevel());},1000/30);
window.addEventListener('resize',()=>{avatar.resize();pairAvatar.resize();fitCaption();});
document.fonts.ready.then(fitCaption);
function setState(value){
  state=value;avatar.setState(audio.playing()?'speaking':value);$('face-screen').dataset.state=value;
  $('say-hi').textContent=value==='asleep'?'Wake Pip up':'Say hi';
  $('session-toggle').textContent=value==='asleep'?'Start a session':'End session';
  $('session-help').textContent=value==='asleep'?'Double tap to begin. Hold to ask, then let go.':'Pip is listening. Your conversation is saved here.';
  if(value==='asleep')captionFinished=true;
  scheduleCaptionHide();
}
function syncSegments(){
  for(const segment of document.querySelectorAll('.segmented')){
    const radios=Array.from(segment.querySelectorAll('input[type=radio]'));if(!radios.length)continue;
    let thumb=segment.querySelector('.segment-thumb');
    if(!thumb){thumb=document.createElement('i');thumb.className='segment-thumb';thumb.setAttribute('aria-hidden','true');segment.prepend(thumb);}
    thumb.style.width=`calc((100% - 8px) / ${radios.length})`;
    thumb.style.transform=`translateX(${Math.max(0,radios.findIndex(r=>r.checked))*100}%)`;
  }
}
function applySettings(update){
  const {theme:nextTheme,keys:nextKeys,hasKey,...values}=update;Object.assign(settings,values);
  if(settings.provider==='gptlive')settings.voice=true;
  audio.setDuplex(settings.provider==='gptlive');
  const choices=voices[settings.provider];
  if(!choices.includes(settings.voiceName))settings.voiceName=choices[0];
  const voicePicker=$('voiceName');
  if(voicePicker.dataset.provider!==settings.provider){
    voicePicker.replaceChildren(...choices.map(name=>new Option(name,name)));
    voicePicker.dataset.provider=settings.provider;
  }
  $('voice').disabled=settings.provider==='gptlive';
  $('voice-help').textContent=settings.provider==='gptlive'?'GPT-Live always speaks. Captions stay visible while you listen.':'Spoken replies with full captions. Turn off for captions and a quiet chirp.';
  for(const provider of Object.keys(providerNames))$(`${provider}-pricing`).hidden=provider!==settings.provider;
  for(const rig of [avatar,pairAvatar]){rig.setColor(settings.color);rig.setEyeStyle(settings.eyeStyle);rig.setEyeSize(settings.eyeSize);}
  if(nextTheme){theme=applyTheme(nextTheme);avatar.setTheme(theme);pairAvatar.setTheme(theme);}
  pointerPicker.update(settings,theme);
  eyePicker.update(settings,theme);
  renderSwatches();
  audio.setVolume(settings.volume);$('volume').value=settings.volume;$('volume-value').value=`${Math.round(settings.volume*100)}%`;
  for(const control of $('settings-form').elements){
    if(!control.name)continue;
    if(control.type==='radio')control.checked=control.value===settings[control.name];
    else if(control.type==='checkbox')control.checked=!!settings[control.name];
    else if(document.activeElement!==control)control.value=settings[control.name]??'';
  }
  $('cursorSize-value').value=`${settings.cursorSize}px`;
  $('eyeSize-value').value=`${Math.round(settings.eyeSize*100)}%`;
  $('custom-color').value=/^#[0-9a-f]{6}$/i.test(settings.color)?settings.color:settings.color==='accent'?theme.accent:theme.background;
  for(const button of document.querySelectorAll('[data-color]')){const active=button.dataset.color===settings.color;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));}
  $('name-mode-help').hidden=settings.provider!=='gemini';
  keyStatus({keys:nextKeys,hasKey});
  syncSegments();
}
function changeSettings(update){
  if(update.provider){update.voiceName=voices[update.provider][0];if(update.provider==='gptlive')update.voice=true;}
  applySettings(update);if(!send({t:'settings',...update}))notice('Reconnect to your computer to save these preferences.');
}
function status(text){$('connection').textContent=connected?'':text;$('connection').hidden=connected||!text;$('session-host').textContent=connected?host:text;$('session-toggle').disabled=!connected;$('say-hi').disabled=!connected;}
async function keepAwake(){
  if(!connected||document.visibilityState!=='visible'||wakeLock)return;
  if(!navigator.wakeLock){notice('Keep this tab open. Your browser cannot keep the screen awake automatically.');return;}
  try{wakeLock=await navigator.wakeLock.request('screen');wakeLock.addEventListener('release',()=>wakeLock=null);}
  catch{notice('If the screen dims, disable auto-lock while Pip listens.');}
}
function connect(){
  if(ws&&[WebSocket.OPEN,WebSocket.CONNECTING].includes(ws.readyState))return;
  clearTimeout(reconnectTimer);status(retries?'Reconnecting…':'Connecting to your computer…');
  const socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws${token?`?token=${encodeURIComponent(token)}`:''}`);ws=socket;
  socket.binaryType='arraybuffer';
  socket.onopen=()=>{if(ws===socket)send({t:'hello',name:/iPhone|iPad|iPod/.test(navigator.userAgent)?'iPhone':/Android/.test(navigator.userAgent)?'Android':'Phone browser',clientId});};
  socket.onmessage=({data})=>{
    if(ws!==socket)return;
    if(data instanceof ArrayBuffer){audio.speech(data);return;}
    if(typeof data!=='string')return;
    let packet;try{packet=JSON.parse(data);}catch{return;}
    switch(packet.t){
      case'hello':
        if(packet.pairToken){token=packet.pairToken;storage.set('token',token);}
        connected=true;retries=0;host=packet.host||'Your computer';
        applySettings({...packet.settings,keys:packet.keys,hasKey:packet.hasKey,...(packet.theme?{theme:packet.theme}:{})});setState(packet.state||'asleep');
        status('');$('pairing').hidden=true;if(!packet.hasKey)openSheet('settings-screen');keepAwake();refreshSessions();showGestureHint();break;
      case'face':avatar.setFace(settings.voice?{...packet,talk:0}:packet);pointerPicker.setFace(packet);break;
      case'activity':avatar.activity(packet.name);break;
      case'state':setState(packet.state);if(packet.state==='asleep'){audio.mic(false);audio.silence();}break;
      case'mic':audio.mic(packet.on);break;
      case'chirp':if(!settings.voice)audio.chirp(packet.syllables);break;
      case'audioItem':audio.item(packet.id,packet.index);break;
      case'audioStop':audio.silence();break;
      case'caption':receiveCaption(packet.text||'',packet.done);break;
      case'settings':{const {t,...update}=packet;applySettings(update);break;}
      case'sessions':refreshSessions();if(detailId)loadDetail(detailId);break;
      case'error':notice(packet.message);break;
    }
  };
  socket.onclose=event=>{
    if(ws!==socket)return;connected=false;cancelHold();audio.mic(false);audio.silence();wakeLock?.release();wakeLock=null;
    captionFinished=true;scheduleCaptionHide();
    if(event.code===4401){token=null;storage.remove('token');closeSheets();status('Sign in to Tailscale or scan a pairing QR');$('pairing').hidden=false;enter($('pairing'),{distance:0});return;}
    status(event.code===1006?"Can't reach your computer — is Tailscale on?":'Computer disconnected. Reconnecting…');
    reconnectTimer=setTimeout(connect,Math.min(30000,500*2**Math.min(retries++,6))*(.8+Math.random()*.4));
  };
}
function keyStatus(packet={}){
  if(packet.keys)Object.assign(keys,packet.keys);
  if(typeof packet.hasKey==='boolean')keys[keyProvider()]=packet.hasKey;
  for(const provider of Object.keys(keys)){
    const saved=keys[provider],selected=provider===keyProvider(),name=provider==='openai'?'OpenAI':providerNames[provider];
    $(`${provider}-key-form`).classList.toggle('needed',selected&&saved===false);
    $(`${provider}-key-status`).textContent=saved===null?'Checking saved key…':saved?'Key saved on your computer.':`No ${name} key saved.`;
  }
  const saved=keys[keyProvider()],name=providerNames[settings.provider],keyName=keyProvider()==='openai'?'OpenAI':'Gemini';
  $('brain-status').textContent=saved===null?'Connect to your computer to check saved keys.':saved?`${name} is ready with your ${keyName} key.`:`Add your ${keyName} key below to use ${name}.`;
}
function showGestureHint(){if(!connected||storage.get('gestureHint')||document.querySelector('.sheet:not([hidden])'))return;$('gesture-hint').hidden=false;storage.set('gestureHint','1');setTimeout(()=>$('gesture-hint').hidden=true,9000);}
function openSheet(id){cancelHold();touches.clear();gesture=null;$('face-screen').inert=true;$('pairing').inert=true;for(const sheet of document.querySelectorAll('.sheet'))sheet.hidden=sheet.id!==id;enter($(id));$(id).querySelector('button,input,textarea')?.focus({preventScroll:true});}
function closeSheets(){for(const sheet of document.querySelectorAll('.sheet'))sheet.hidden=true;$('face-screen').inert=false;$('pairing').inert=false;detailId=null;$('face-screen').focus({preventScroll:true});showGestureHint();}
for(const button of document.querySelectorAll('[data-close]'))button.addEventListener('click',closeSheets);
for(const sheet of document.querySelectorAll('.sheet')){sheet.setAttribute('role','dialog');sheet.setAttribute('aria-modal','true');}
document.addEventListener('keydown',event=>{
  const sheet=document.querySelector('.sheet:not([hidden])');if(!sheet)return;
  if(event.key==='Escape'){event.preventDefault();closeSheets();return;}
  if(event.key!=='Tab')return;
  const controls=Array.from(sheet.querySelectorAll('button,input,textarea,select,a[href],[tabindex="0"]')).filter(control=>!control.disabled&&(control.offsetWidth||control.offsetHeight)),first=controls[0],last=controls[controls.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
});
$('volume').oninput=()=>changeSettings({volume:Number($('volume').value)});
$('say-hi').onclick=()=>{audio.unlock();send({t:state==='asleep'?'wake':'sayHi'});};
for(const provider of Object.keys(keys)){
  $(`${provider}-key-form`).onsubmit=event=>{
    event.preventDefault();const input=$(`${provider}-key`),key=input.value.trim();
    if(!key){notice(`Enter your ${providerNames[provider]} API key first.`);input.focus();return;}
    if(send({t:'setKey',provider,key})){input.value='';$(`${provider}-key-status`).textContent='Key sent. Waiting for confirmation…';}
    else notice('Connect to your computer before saving a key.');
  };
}
$('settings-form').onsubmit=event=>event.preventDefault();
$('settings-form').onchange=event=>{const control=event.target,key=control.name;if(!key)return;changeSettings({[key]:control.type==='checkbox'?control.checked:control.type==='range'?Number(control.value):control.value});};
$('settings-form').oninput=event=>{const control=event.target;if(control.name==='cursorSize')$('cursorSize-value').value=`${control.value}px`;if(control.name==='eyeSize')changeSettings({eyeSize:Number(control.value)});};
function renderSwatches(){
  const key=['accent','red','green','cyan','magenta','yellow'].map(k=>theme[k]).join('|');if(swatchKey===key)return;swatchKey=key;
  const swatches=$('color-swatches');swatches.replaceChildren();
  const colors=[...new Set(['accent','red','green','cyan','magenta','yellow'].map(key=>theme[key]).filter(Boolean))];
  for(const color of colors){const button=document.createElement('button');button.type='button';button.className='swatch';button.dataset.color=color;button.style.setProperty('--swatch',color);button.setAttribute('aria-label',`Body colour ${color}`);button.onclick=()=>changeSettings({color});swatches.append(button);}
}
for(const button of document.querySelectorAll('[data-color=theme],[data-color=accent]'))button.onclick=()=>changeSettings({color:button.dataset.color});
$('custom-color').onchange=()=>changeSettings({color:$('custom-color').value});
$('forget-pairing').onclick=()=>{storage.remove('token');token=null;clearTimeout(reconnectTimer);const old=ws;ws=null;old?.close();connected=false;audio.mic(false);audio.silence();wakeLock?.release();closeSheets();$('pairing').hidden=false;status('Disconnected');};
 $('play-alone').onclick=()=>{$('pairing').hidden=true;avatar.setState('asleep');notice('Tap to meet Pip. Hold a top corner for settings or sessions.');};
$('retry-pairing').onclick=()=>{if(ws?.readyState===WebSocket.CLOSED)ws=null;connect();};
$('copy-command').onclick=async()=>{try{await navigator.clipboard.writeText('pipctl pair');notice('Pairing command copied.');}catch{notice('Run pipctl pair in a terminal on your computer.');}};
$('audio-unlock').onclick=()=>audio.unlock();
if(CSS.supports('animation-timing-function',springEasing()))document.documentElement.style.setProperty('--spring-ease',springEasing());
const surface=$('face'),touches=new Map();
let gesture=null,gestureOpened=false;
function openSessions(){openSheet('sessions-screen');refreshSessions();}
function startGesture(event){
  if(event.button>0)return;event.preventDefault();audio.unlock();
  touches.set(event.pointerId,{x:event.clientX,y:event.clientY});
  event.currentTarget.setPointerCapture(event.pointerId);
  if(touches.size===2){cancelHold();gesture={kind:'two',at:performance.now(),moved:false};return;}
  if(touches.size!==1)return;
  gestureOpened=false;pointerId=event.pointerId;
  const corner=event.clientY<Math.max(64,innerHeight*.09)&&(event.clientX<72||event.clientX>innerWidth-72);
  gesture={kind:corner?(event.clientX<innerWidth/2?'sessions':'settings'):event.clientY>innerHeight-64?'edge':'ask',x:event.clientX,y:event.clientY,at:performance.now(),moved:false};
  if(gesture.kind==='edge')return;
  holdTimer=setTimeout(()=>{
    if(!gesture||gesture.moved)return;
    if(gesture.kind==='sessions'||gesture.kind==='settings'){gestureOpened=true;gesture.kind==='sessions'?openSessions():openSheet('settings-screen');return;}
    clearTimeout(pokeTimer);holding=true;avatar.setHolding(true);lastTap=0;navigator.vibrate?.(15);if(send({t:'askStart'}))setState('asking');
  },corner?650:350);
}
function moveGesture(event){
  const start=touches.get(event.pointerId);if(!start||!gesture)return;
  if(Math.hypot(event.clientX-start.x,event.clientY-start.y)>20){gesture.moved=true;clearTimeout(holdTimer);}
  if(gesture.kind==='edge'&&!gestureOpened&&start.y-event.clientY>70&&Math.abs(start.x-event.clientX)<90){gestureOpened=true;openSessions();}
}
function endGesture(event){
  if(!touches.has(event.pointerId))return;event.preventDefault();touches.delete(event.pointerId);clearTimeout(holdTimer);
  if(gesture?.kind==='two'){if(!touches.size){if(!gesture.moved&&performance.now()-gesture.at<450)openSheet('settings-screen');gesture=null;}return;}
  if(touches.size)return;pointerId=null;
  if(holding){holding=false;avatar.setHolding(false);send({t:'askEnd'});navigator.vibrate?.(10);lastTap=0;gesture=null;return;}
  if(gestureOpened||gesture?.moved){gesture=null;return;}
  gesture=null;
  const now=performance.now(),point={x:event.clientX,y:event.clientY};
  if(now-lastTap<350&&lastPoint&&Math.hypot(point.x-lastPoint.x,point.y-lastPoint.y)<60){clearTimeout(pokeTimer);send({t:'toggle'});lastTap=0;}
  else{lastTap=now;lastPoint=point;pokeTimer=setTimeout(()=>avatar.poke(point.x/innerWidth,point.y/innerHeight),350);}
}
function cancelHold(){clearTimeout(holdTimer);clearTimeout(pokeTimer);if(holding){holding=false;avatar.setHolding(false);send({t:'askEnd'});}pointerId=null;lastTap=0;}
for(const target of [surface,$('sessions-button'),$('sound-button')]){
  target.addEventListener('pointerdown',startGesture);target.addEventListener('pointermove',moveGesture);target.addEventListener('pointerup',endGesture);
  target.addEventListener('pointercancel',()=>{cancelHold();touches.clear();gesture=null;});
}
// Keyboard and assistive activation provide the same hidden navigation.
$('sessions-button').onclick=event=>{if(event.detail===0)openSessions();};
$('sound-button').onclick=event=>{if(event.detail===0)openSheet('settings-screen');};
$('open-sessions').onclick=openSessions;
$('face-screen').addEventListener('keydown',event=>{if(event.target!==$('face-screen'))return;if(event.key==='s'){event.preventDefault();openSheet('settings-screen');}if(event.key==='ArrowUp'){event.preventDefault();openSessions();}if(event.key==='Enter'){event.preventDefault();audio.unlock();send({t:'toggle'});}if(event.code==='Space'&&!event.repeat){event.preventDefault();audio.unlock();holding=true;avatar.setHolding(true);send({t:'askStart'});}});
$('face-screen').addEventListener('keyup',event=>{if(event.code==='Space'&&holding){event.preventDefault();cancelHold();}});
surface.addEventListener('contextmenu',event=>event.preventDefault());document.addEventListener('gesturestart',event=>event.preventDefault());
const date=seconds=>new Date(seconds*1000).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const duration=session=>{const seconds=Math.max(0,Math.floor((session.ended||Date.now()/1000)-session.started)),m=Math.floor(seconds/60);return seconds>=3600?`${Math.floor(m/60)}:${String(m%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`:`${m}:${String(seconds%60).padStart(2,'0')}`;};
const transcribing=n=>n>0?` · transcribing ${n} chunk${n===1?'':'s'}…`:'';
async function api(path){const response=await fetch(path,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});if(!response.ok)throw new Error(response.status===401?'Connection expired. Sign in to Tailscale or scan a fresh pairing QR.':`Couldn't load sessions (${response.status}).`);return response.json();}
function element(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;}
async function refreshSessions(){if(!token)return;try{sessions=await api('/api/sessions');renderSessions();}catch(error){if(!$('sessions-screen').hidden)notice(error.message);}}
function renderSessions(){
  const list=$('session-list');list.replaceChildren();$('session-count').textContent=sessions.length;
  if(!sessions.length){list.append(element('h2','','A fresh page'),element('p','small','Start a session. Your conversation, questions and replies will be waiting here.'));return;}
  for(const session of sessions){const row=element('button','session-row'),title=element('span','',date(session.started)),count=session.questionCount||0;if(!session.ended)title.append(element('span','live','LIVE'));row.append(title,element('span','mono',duration(session)),element('p','summary',session.summary||'Conversation with Pip'),element('span','transcribing',`${count} question${count===1?'':'s'}${transcribing(session.transcribing)}`));row.onclick=()=>loadDetail(session.id,true);list.append(row);}
}
$('session-toggle').onclick=()=>{audio.unlock();send({t:'toggle'});if(state==='asleep')closeSheets();};
async function loadDetail(id,open=false){
  detailId=id;if(open)openSheet('detail-screen');
  try{
    const data=await api(`/api/sessions/${encodeURIComponent(id)}`);if(detailId!==id)return;detailData=data;
    $('detail-title').textContent=date(data.started);const count=data.entries.filter(e=>e.kind==='asked').length;
    $('detail-meta').textContent=`${duration(data)} · ${count} question${count===1?'':'s'}${transcribing(data.transcribing)}`;$('copy-prompt').textContent='Copy prompt for agent';
    const entries=$('entries');entries.replaceChildren();
    for(const entry of data.entries){
      const block=element(entry.kind==='report'?'details':'div',`entry ${entry.kind}`);
      if(entry.kind==='report'){const [title,...body]=entry.text.split('\n\n');block.append(element('summary','',title),element('p','',body.join('\n\n')));}
      else{const time=new Date(entry.time*1000).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}),speaker=entry.speaker?`Speaker ${entry.speaker}`:'Speaker',label=entry.kind==='asked'?'You asked':entry.kind==='reply'?'Pip':entry.kind==='transcript'?speaker:'Heard';block.append(element('span','entry-meta',`${label} · ${time}`),element('span','',entry.text));}
      entries.append(block);
    }
  }catch(error){notice(error.message);}
}
$('detail-back').onclick=()=>{detailId=null;openSheet('sessions-screen');};
$('copy-prompt').onclick=async()=>{
  if(!detailData)return;
  try{await navigator.clipboard.writeText(detailData.agentPrompt);$('copy-prompt').textContent='Copied';setTimeout(()=>$('copy-prompt').textContent='Copy prompt for agent',2000);}
  catch{const input=element('textarea');input.value=detailData.agentPrompt;input.style.position='fixed';input.style.top='0';$('detail-screen').append(input);input.focus();input.select();const copied=document.execCommand('copy');input.remove();if(copied)$('copy-prompt').textContent='Copied';else notice('Your browser blocked copying. Allow clipboard access and try again.');}
};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){connect();keepAwake();}else cancelHold();});
window.addEventListener('online',connect);window.addEventListener('pagehide',()=>{cancelHold();audio.mic(false);audio.silence();ws?.close();});window.addEventListener('pageshow',connect);
theme=applyTheme(defaultTheme);avatar.setTheme(theme);pairAvatar.setTheme(theme);applySettings(settings);setState('asleep');$('pairing').hidden=true;connect();
