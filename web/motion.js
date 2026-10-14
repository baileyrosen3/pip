import {tokens} from './tokens.js';
const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
export function enter(element,{kind='default',distance=64,scale=1}={}) {
  element.getAnimations().forEach(animation=>animation.cancel());
  if(reduced.matches){element.animate([{opacity:0},{opacity:1}],{duration:tokens.bubble.wordFadeMs});return;}
  const {stiffness,damping}=tokens.spring[kind],omega=Math.sqrt(stiffness),wd=omega*Math.sqrt(1-damping*damping),frames=[];
  const duration=600;
  for(let i=0;i<=40;i++){
    const t=i/40*duration/1000,settled=1-Math.exp(-damping*omega*t)*(Math.cos(wd*t)+damping*omega/wd*Math.sin(wd*t));
    frames.push({offset:i/40,transform:`translateY(${distance*(1-settled)}px) scale(${scale+(1-scale)*settled})`,opacity:Math.min(1,i/8)});
  }
  frames[frames.length-1]={offset:1,transform:'translateY(0) scale(1)',opacity:1};
  element.animate(frames,{duration,easing:'linear'});
}
export function showCaption(element,text) {
  const wasHidden=element.hidden,oldWords=Array.from(element.children).map(e=>e.textContent),words=text.match(/\S+\s*/g)||[];
  element.getAnimations({subtree:true}).forEach(animation=>animation.cancel());
  element.hidden=!text;
  element.replaceChildren();
  words.forEach((word,index)=>{
    const span=document.createElement('span');span.className='word';span.textContent=word;element.append(span);
    if(oldWords[index]!==word)span.animate(reduced.matches?[{opacity:0},{opacity:1}]:[{opacity:0,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],{duration:tokens.bubble.wordFadeMs,delay:Math.max(0,index-oldWords.length)*tokens.bubble.wordStaggerMs,fill:'backwards'});
  });
  element.style.fontSize='23px';
  while(element.scrollHeight>parseFloat(getComputedStyle(element).lineHeight)*3+2&&parseFloat(element.style.fontSize)>14)element.style.fontSize=`${parseFloat(element.style.fontSize)-1}px`;
  if(text&&wasHidden)element.animate([{opacity:0},{opacity:1}],{duration:160});
}
export function hideCaption(element) {
  const words=Array.from(element.children);if(!words.length){element.hidden=true;return;}
  words.forEach((word,index)=>{
    const animation=word.animate([{opacity:1},{opacity:0}],{duration:tokens.bubble.exitMs,delay:reduced.matches?0:Math.min(index*24,index/Math.max(1,words.length-1)*400),fill:'forwards'});
    if(index===words.length-1)animation.onfinish=()=>{if(element.lastChild===word){element.hidden=true;element.replaceChildren();}};
  });
}
export function springEasing() {
  const {stiffness,damping}=tokens.spring.default,w=Math.sqrt(stiffness),wd=w*Math.sqrt(1-damping*damping),values=[];
  for(let i=0;i<=30;i++){const t=i/30*.4;values.push((1-Math.exp(-damping*w*t)*(Math.cos(wd*t)+damping*w/wd*Math.sin(wd*t))).toFixed(4));}
  values[0]='0';values[30]='1';
  return `linear(${values.join(',')})`;
}
