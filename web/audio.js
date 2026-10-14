export class PipAudio {
  constructor(send,sendPCM,notice,unlockPrompt){Object.assign(this,{send,sendPCM,notice,unlockPrompt});this.wanted=false;this.generation=0;this.volume=1;this.sources=new Set();this.speechQueue=[];this.speechSources=new Map();this.speechItems=new Map();this.currentItem=null;this.playbackGeneration=0;this.playbackActive=false;this.onPlayback=null;this.duplex=false;this.ducked=false;this.quietSince=0;}
  context(){
    if(!this.ctx){const Context=window.AudioContext||window.webkitAudioContext;if(!Context)throw new Error('This browser does not support Web Audio.');this.ctx=new Context();this.gain=this.ctx.createGain();this.gain.gain.value=this.volume;this.analyser=this.ctx.createAnalyser();this.analyser.fftSize=256;this.levelData=new Float32Array(256);this.gain.connect(this.analyser);this.analyser.connect(this.ctx.destination);}
    return this.ctx;
  }
  unlock(){
    // Call resume immediately within the trusted pointer/key event, before any asynchronous permission work.
    try{const ctx=this.context();const resumed=ctx.resume();resumed.then(()=>{this.unlockPrompt(false);if(this.wanted&&!this.stream)this.start();if(this.pendingChirp){const n=this.pendingChirp;this.pendingChirp=0;this.chirp(n);}this.flushSpeech();}).catch(()=>this.unlockPrompt(true));}catch(error){this.notice(error.message);}
  }
  setVolume(volume){this.volume=Number(volume);if(this.gain)this.gain.gain.setValueAtTime(this.volume,this.ctx.currentTime);}
  setDuplex(on){this.duplex=Boolean(on);this.ducked=false;this.quietSince=0;}
  item(id,index=0){this.currentItem={id,index,key:JSON.stringify([id,index])};}
  setPlayback(on,items){if(this.playbackActive===on){if(!on&&items?.length)this.send({t:'playback',on,items});return;}this.playbackActive=on;const message={t:'playback',on};if(items?.length)message.items=items;this.send(message);this.onPlayback?.(on);}
  playing(){return this.playbackActive;}
  speech(bytes){
    if(this.ducked){this.send({t:'playback',on:false});return;}
    const input=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
    const samples=Math.floor(input.byteLength/2);if(!samples)return;
    const ctx=this.context(),buffer=ctx.createBuffer(1,samples,24000),output=buffer.getChannelData(0),view=new DataView(input.buffer,input.byteOffset,input.byteLength);
    for(let i=0;i<samples;i++)output[i]=view.getInt16(i*2,true)/32768;
    const key=this.currentItem?.key||null;
    let item=null;if(key){item=this.speechItems.get(key);if(!item){item={...this.currentItem,key,playedMs:0};this.speechItems.set(key,item);}}
    this.speechQueue.push({buffer,item});if(ctx.state!=='running')this.unlockPrompt(true);this.flushSpeech();
  }
  flushSpeech(){
    if(!this.speechQueue.length||!this.ctx||this.ctx.state!=='running')return;
    const ctx=this.ctx;
    while(this.speechQueue.length){
      const queued=this.speechQueue.shift(),{buffer,item}=queued,source=ctx.createBufferSource();source.buffer=buffer;source.connect(this.gain);this.sources.add(source);
      const now=ctx.currentTime,when=Math.max(now,this.nextPlaybackTime||now),duration=buffer.duration;this.nextPlaybackTime=when+duration;
      if(item)this.speechSources.set(source,{item,startAt:when,duration});
      const generation=this.playbackGeneration;source.onended=()=>{source.disconnect();this.sources.delete(source);const progress=this.speechSources.get(source);if(progress){if(generation===this.playbackGeneration)progress.item.playedMs+=duration*1000;this.speechSources.delete(source);}if(generation===this.playbackGeneration&&!this.sources.size&&!this.speechQueue.length){this.nextPlaybackTime=0;const items=[...this.speechItems.values()].map(item=>({id:item.id,index:item.index,playedMs:item.playedMs}));for(const key of this.speechItems.keys())if(key!==this.currentItem?.key)this.speechItems.delete(key);this.setPlayback(false,items);}};
      source.start(when);
    }
    this.setPlayback(true);
  }
  level(){if(!this.analyser||!this.sources.size)return 0;this.analyser.getFloatTimeDomainData(this.levelData);let sum=0;for(const value of this.levelData)sum+=value*value;return Math.min(1,Math.sqrt(sum/this.levelData.length)*8);}
  hearLevel(){
    if(!this.micAnalyser||!this.stream)return 0;
    this.micAnalyser.getFloatTimeDomainData(this.micData);let sum=0;for(const value of this.micData)sum+=value*value;const level=Math.min(1,Math.sqrt(sum/this.micData.length)*8);
    if(this.duplex&&this.ducked){if(level<.10){if(!this.quietSince)this.quietSince=performance.now();else if(performance.now()-this.quietSince>=400){this.ducked=false;this.quietSince=0;}}else this.quietSince=0;}
    else if(this.duplex&&this.playbackActive&&level>.20){this.ducked=true;this.quietSince=0;this.send({t:'bargeIn'});this.silence();}
    return level;
  }
  mic(on){this.wanted=on;if(on)this.start();else this.stop();}
  async start(){
    if(this.stream||this.starting)return;
    const generation=this.generation;this.starting=true;
    let stream;
    try{
      const ctx=this.context();if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone access needs HTTPS. Open the secure pairing URL.');
      stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      if(!this.wanted||generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return;}
      this.stream=stream;if(ctx.state!=='running')this.unlockPrompt(true);
      if(!this.workletReady)this.workletReady=ctx.audioWorklet.addModule('/pcm-worklet.js');await this.workletReady;
      if(!this.wanted||generation!==this.generation)return;
      this.input=ctx.createMediaStreamSource(stream);this.worklet=new AudioWorkletNode(ctx,'pcm24',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
      this.micAnalyser=ctx.createAnalyser();this.micAnalyser.fftSize=256;this.micData=new Float32Array(256);
      this.worklet.port.onmessage=({data})=>{if(this.wanted&&generation===this.generation)this.sendPCM(data);};this.input.connect(this.micAnalyser);this.micAnalyser.connect(this.worklet);this.worklet.connect(ctx.destination);
    }catch(error){
      if(stream)stream.getTracks().forEach(t=>t.stop());
      if(generation===this.generation&&this.wanted){this.stop();this.wanted=false;const message=error.name==='NotAllowedError'?"I couldn't use your microphone. Allow microphone access in your browser, then double tap to try again.":error.name==='NotFoundError'?"I couldn't find a microphone. Connect one, then double tap to try again.":`I couldn't start listening. ${error.message}`;this.send({t:'micError',message});this.notice(message);}
    }finally{this.starting=false;if(this.wanted&&!this.stream&&generation!==this.generation)this.start();}
  }
  stop(){
    this.ducked=false;this.quietSince=0;this.silence();this.generation++;this.unlockPrompt(false);if(this.stream)this.stream.getTracks().forEach(t=>t.stop());this.stream=null;this.input?.disconnect();this.input=null;this.micAnalyser?.disconnect();this.micAnalyser=null;if(this.worklet){this.worklet.port.onmessage=null;this.worklet.disconnect();this.worklet.port.close();this.worklet=null;}
  }
  silence(){
    const ctx=this.ctx,items=[...this.speechItems.values()].map(item=>{let playedMs=item.playedMs;for(const progress of this.speechSources.values())if(progress.item===item)playedMs+=Math.max(0,Math.min(progress.duration,ctx.currentTime-progress.startAt))*1000;return{id:item.id,index:item.index,playedMs};});
    this.playbackGeneration++;this.speechQueue.length=0;this.nextPlaybackTime=0;for(const source of this.sources)try{source.stop();}catch{}this.sources.clear();this.speechSources.clear();this.speechItems.clear();this.currentItem=null;this.pendingChirp=0;this.setPlayback(false,items);
  }
  chirp(syllables){
    const ctx=this.context();if(ctx.state!=='running'){this.pendingChirp=syllables;this.unlockPrompt(true);return;}
    const rate=ctx.sampleRate,scale=[1046.5,1174.7,1318.5,1568,1760,2093,2349.3,2637];let index=1+Math.floor(Math.random()*3);const notes=[];let total=0;
    for(let i=0;i<syllables;i++){if(i)index=Math.min(7,Math.max(0,index+[-1,1,1,2][Math.floor(Math.random()*4)]));const count=Math.floor((i===syllables-1?.13:.07+Math.random()*.02)*rate),gap=Math.floor(rate*.028);notes.push({note:scale[index]*.5,count,gap});total+=count+gap;}
    if(!total)return;const buffer=ctx.createBuffer(1,total,rate),out=buffer.getChannelData(0);let offset=0;
    notes.forEach(({note,count,gap},i)=>{let phase=0;for(let n=0;n<count;n++){const time=n/rate,t=n/count,scoop=1-.18*Math.exp(-time/.012),wobble=i===notes.length-1?1+.012*Math.sin(time*2*Math.PI*18):1;phase+=2*Math.PI*note*scoop*wobble/rate;const envelope=Math.min(1,time/.006)*Math.exp(-t*3.2)*(1-t**6);out[offset+n]=(Math.sin(phase)+.12*Math.sin(2*phase))*envelope*.26;}offset+=count+gap;});
    const source=ctx.createBufferSource();source.buffer=buffer;source.connect(this.gain);this.sources.add(source);const generation=this.playbackGeneration;source.onended=()=>{source.disconnect();this.sources.delete(source);if(generation===this.playbackGeneration&&!this.sources.size&&!this.speechQueue.length){this.nextPlaybackTime=0;this.setPlayback(false);}};const now=ctx.currentTime,when=Math.max(now,this.nextPlaybackTime||now);this.nextPlaybackTime=when+buffer.duration;source.start(when);this.setPlayback(true);
  }
}
