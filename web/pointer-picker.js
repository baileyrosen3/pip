import {POINTERS, EYE_STYLES, createRig, stepRig, setEyeStyle, setEyeSize, drawMini, drawCursor, cursorBounds, makePalette} from '/avatar/pip.mjs';
import {defaultTheme} from './theme.js';

export function createPointerPicker(container, eyes = false) {
  const rig=createRig(42),reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const input={mood:'listening',state:'listening',gazeX:0,gazeY:0,talk:0,now:0,reducedMotion:false};
  const previews=[];
  let palette=makePalette(defaultTheme),size=44,lastTime=null,visible=false,destroyed=false;
  for(const pointer of eyes ? EYE_STYLES : POINTERS){
    const label=document.createElement('label'),radio=document.createElement('input'),option=document.createElement('span'),canvas=document.createElement('canvas'),name=document.createElement('b');
    radio.type='radio';radio.name=eyes?'eyeStyle':'pointer';radio.value=pointer.id;
    option.className='pointer-option';canvas.className='pointer-preview';canvas.setAttribute('aria-hidden','true');name.textContent=pointer.name;
    option.append(canvas,name);label.append(radio,option);container.append(label);
    const previewRig=eyes?createRig(42):rig;if(eyes)setEyeStyle(previewRig,pointer.id);
    previews.push({type:pointer.id,rig:previewRig,canvas,ctx:canvas.getContext('2d')});
  }
  const observer=new IntersectionObserver(entries=>visible=entries[0].isIntersecting);
  observer.observe(container);
  function tick(ms){
    if(destroyed)return;
    const now=ms/1000,dt=Math.min(now-(lastTime??now),.05);lastTime=now;
    if(visible&&document.visibilityState==='visible'){
      input.now=now;input.reducedMotion=reducedMotion.matches;stepRig(rig,dt,input);
      const dpr=Math.min(devicePixelRatio||1,3);
      for(const {canvas,ctx,type,rig:previewRig} of previews){
        const width=canvas.clientWidth,height=canvas.clientHeight;
        if(!width||!height)continue;
        if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);}
        ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
        if(eyes){
          stepRig(previewRig,dt,input);
          const side=Math.min(width,height);ctx.translate((width-side)/2,(height-side)/2);drawMini(ctx,previewRig,side,palette);
        }else{
          const bounds=cursorBounds(size,type),scale=Math.min(width/bounds.w,height/bounds.h);
          ctx.translate((width-bounds.w*scale)/2-bounds.x*scale,(height-bounds.h*scale)/2-bounds.y*scale);ctx.scale(scale,scale);
          drawCursor(ctx,rig,size,palette,type);
        }
      }
    }
    frame=requestAnimationFrame(tick);
  }
  let frame=requestAnimationFrame(tick);
  return {
    update(settings,theme){size=settings.cursorSize;palette=makePalette(theme,settings.color);if(!eyes)setEyeStyle(rig,settings.eyeStyle);setEyeSize(rig,settings.eyeSize);if(eyes)for(const p of previews)setEyeSize(p.rig,settings.eyeSize);},
    setFace(face){input.gazeX=face.gazeX;input.gazeY=face.gazeY;input.mood=face.mood;input.talk=face.talk;},
    destroy(){destroyed=true;cancelAnimationFrame(frame);observer.disconnect();},
  };
}
