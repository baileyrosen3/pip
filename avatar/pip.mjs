// Pip is two living ink blobs. Public API shared by browser and QML.
import {createPersona,stepPersona,pokePersona,reactPersona,activityPersona,EXPRESSIONS,ACTS} from './persona.mjs';
import {createEyes,createPose,stepEyes,drawEyes} from './eyes.mjs';
import {alpha,clamp,TAU} from './core.mjs';
export {makePalette} from './core.mjs';
export {EXPRESSIONS,ACTS};
export const POINTERS=[{id:'arrow',name:'Arrow'},{id:'orb',name:'Orb'},{id:'eyes',name:'Eyes'},{id:'face',name:'Tile'}];
export const EYE_STYLES=[{id:'flat',name:'Flat'},{id:'glass',name:'Glass'},{id:'glow',name:'Glow'}];
export function createRig(seed=147){
  const eyes=createEyes(96),smallEyes=createEyes(40);
  const events={dent:(side,angle,depth)=>{eyes.dent(side,angle,depth);smallEyes.dent(side,angle,depth);},jiggle:(side,amount)=>{eyes.jiggle(side,amount);smallEyes.jiggle(side,amount);},drip:(side,kind)=>{eyes.drip(side,kind);smallEyes.drip(side,kind);}};
  return {persona:createPersona(seed),eyes,smallEyes,events,eyeStyle:'flat',eyeSize:1,pose:createPose(),input:{},drawArea:{w:1,h:1,cx:.5,cy:.46,d:.22},poseOverride:null};
}
export function setEyeStyle(rig,id){if(id==='flat'||id==='glass'||id==='glow')rig.eyeStyle=id;}
export function setEyeSize(rig,n){if(typeof n==='number'&&isFinite(n)){rig.eyeSize=clamp(n,.7,1.5);rig.eyes.sizeTarget=rig.smallEyes.sizeTarget=rig.eyeSize;}}
export function stepRig(rig,dt,input={}){dt=clamp(dt,0,.1);rig.input=input;rig.pose=rig.poseOverride||stepPersona(rig.persona,dt,input,rig.events)||rig.persona.pose;stepEyes(rig.eyes,dt,rig.pose,input.reducedMotion);stepEyes(rig.smallEyes,dt,rig.pose,input.reducedMotion);}
export function poke(rig,x,y){
  const a=rig.drawArea,px=(x*a.w-a.cx)/a.d,py=(y*a.h-a.cy)/a.d;
  const dl=Math.hypot(px-rig.eyes.L.cx,py-rig.eyes.L.cy),dr=Math.hypot(px-rig.eyes.R.cx,py-rig.eyes.R.cy),side=dl<dr?'L':'R',q=rig.eyes[side];
  const hit=Math.min(dl,dr)<Math.max(.35,q.radius+.06)?side:Math.abs(py-(rig.eyes.L.cy+rig.eyes.R.cy)*.5)<.6&&px>Math.min(rig.eyes.L.cx,rig.eyes.R.cx)&&px<Math.max(rig.eyes.L.cx,rig.eyes.R.cx)?'both':'';
  if(hit==='L'||hit==='R')rig.events.dent(side,Math.atan2(py-q.cy,px-q.cx),.22);
  pokePersona(rig.persona,x,y,hit);
}
export function react(rig,name){reactPersona(rig.persona,name);}
export function activity(rig,name){activityPersona(rig.persona,name);}
export function drawFace(ctx,rig,w,h,palette){ctx.fillStyle=palette.face;ctx.fillRect(0,0,w,h);const d=Math.min(w,h)*.22;rig.drawArea.w=w;rig.drawArea.h=h;rig.drawArea.cx=w*.5;rig.drawArea.cy=h*.46;rig.drawArea.d=d;rig.eyes.boundX=w*.5/d;rig.eyes.boundTop=h*.46/d;rig.eyes.boundBottom=h*.54/d;drawEyes(ctx,rig.eyes,w*.5,h*.46,d,palette,rig.eyeStyle);}
const ARROW=[[0,0,.045],[.9,.4,.13],[.53,.53,.09],[.4,.9,.13]];
function arrowPath(ctx,s){ctx.beginPath();for(let i=0;i<4;i++){const [x,y,r]=ARROW[i],[px,py]=ARROW[(i+3)%4],[nx,ny]=ARROW[(i+1)%4],a=Math.min(r,Math.hypot(px-x,py-y)*.45),b=Math.min(r,Math.hypot(nx-x,ny-y)*.45),il=Math.hypot(px-x,py-y),ol=Math.hypot(nx-x,ny-y),ax=(x+(px-x)*a/il)*s,ay=(y+(py-y)*a/il)*s;if(i===0)ctx.moveTo(ax,ay);else ctx.lineTo(ax,ay);ctx.quadraticCurveTo(x*s,y*s,(x+(nx-x)*b/ol)*s,(y+(ny-y)*b/ol)*s);}ctx.closePath();}
function tilePath(ctx,s){const r=s*.24;ctx.beginPath();ctx.moveTo(r,0);ctx.lineTo(s-r,0);ctx.quadraticCurveTo(s,0,s,r);ctx.lineTo(s,s-r);ctx.quadraticCurveTo(s,s,s-r,s);ctx.lineTo(r,s);ctx.quadraticCurveTo(0,s,0,s-r);ctx.lineTo(0,r);ctx.quadraticCurveTo(0,0,r,0);ctx.closePath();}
// Desktop pointers sit on the user's windows, which share the theme background, so the rim carries
// the contrast: the theme's eye colour on dark themes, white on light ones.
function body(ctx,palette,size){ctx.fillStyle=palette.faceLift;ctx.fill();ctx.strokeStyle=palette.dark?alpha(palette.ink,.95):'rgba(255,255,255,.95)';ctx.lineWidth=Math.max(1.25,size*.035);ctx.lineJoin='round';ctx.stroke();}
function hotspot(ctx,size,p){ctx.fillStyle=p.ink;ctx.beginPath();ctx.arc(0,0,Math.max(1.1,size*.025),0,TAU);ctx.fill();}
export function drawCursor(ctx,rig,size,palette,type='arrow'){
  ctx.save();ctx.fillStyle=palette.face;
  if(type==='face'){tilePath(ctx,size);body(ctx,palette,size);drawEyes(ctx,rig.smallEyes,size*.5,size*.47,Math.max(3.4,size*.23),palette,rig.eyeStyle);}
  else if(type==='orb'){ctx.beginPath();ctx.arc(size*.33,size*.33,size*.33*Math.SQRT2,0,TAU);body(ctx,palette,size);drawEyes(ctx,rig.smallEyes,size*.33,size*.34,Math.max(3.4,size*.21),palette,rig.eyeStyle);hotspot(ctx,size,palette);}
  else if(type==='eyes'){
    // Two body-colour pads keep the ink legible, without a surrounding orb.
    const d=Math.max(3.4,size*.22),pad=d*.78;
    ctx.beginPath();ctx.arc(size*.45-d*.85,size*.27,pad,0,TAU);ctx.moveTo(size*.45+d*.85+pad,size*.27);ctx.arc(size*.45+d*.85,size*.27,pad,0,TAU);body(ctx,palette,size);
    drawEyes(ctx,rig.smallEyes,size*.45,size*.27,d,palette,rig.eyeStyle);hotspot(ctx,size,palette);
  }else{arrowPath(ctx,size);body(ctx,palette,size);drawEyes(ctx,rig.smallEyes,size*.44,size*.4,Math.max(3.4,size*.19),palette,rig.eyeStyle);}
  ctx.restore();
}
export function cursorBounds(size,type='arrow'){const m=size*.17;return{x:-m,y:-m,w:size+2*m,h:size+2*m};}
export function drawMini(ctx,rig,size,palette){ctx.save();ctx.translate(size*.03,size*.03);tilePath(ctx,size*.94);body(ctx,palette,size);drawEyes(ctx,rig.smallEyes,size*.47,size*.46,Math.max(3,size*.22),palette,rig.eyeStyle);ctx.restore();}
