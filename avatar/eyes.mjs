// Liquid ink contours. Plain Canvas subset shared with Qt Context2D.
import { clamp, TAU, mix } from './core.mjs';

export const SHAPES = ['dot','pill','wide','pin','line','happy','content','half','angry','sad','heart','star','cross','chevronL','chevronR','drop','bar','squircle'];
const libraries = {};
const MIRROR = { angry: true, sad: true, chevronL: true, chevronR: true };
const blankEye = () => ({shape:'dot',x:0,y:0,s:1,sx:1,sy:1,rot:0,open:1});
export function createPose() { return { L:blankEye(),R:blankEye(),merge:0,mergeX:0,mergeY:0,spin:0,tension:1 }; }

function roundPolygon(p, passes = 3) {
  for (let k=0;k<passes;k++) {
    const q=[];
    for(let i=0;i<p.length;i++) { const a=p[i],b=p[(i+1)%p.length]; q.push([a[0]*.75+b[0]*.25,a[1]*.75+b[1]*.25],[a[0]*.25+b[0]*.75,a[1]*.25+b[1]*.75]); }
    p=q;
  }
  return p;
}
function capsule(rx,ry) {
  const p=[]; const r=Math.min(rx,ry);
  for(let i=0;i<128;i++) { const a=-Math.PI/2+TAU*i/128,c=Math.cos(a),s=Math.sin(a);p.push([c*r+Math.sign(c)*(rx-r),s*r+Math.sign(s)*(ry-r)]); }
  return p;
}
function arcShape(up) {
  const p=[],r=.42,thick=.105;
  // A round-ended ribbon, not a line stroke: the concave side morphs with the whole contour.
  for(let i=0;i<=48;i++){const a=Math.PI+Math.PI*i/48;p.push([(r+thick)*Math.cos(a),(r+thick)*Math.sin(a)+.18]);}
  for(let i=1;i<=16;i++){const a=-Math.PI/2+Math.PI*i/16;p.push([r+thick*Math.cos(a),.18+thick*Math.sin(a)]);}
  for(let i=1;i<=48;i++){const a=TAU-Math.PI*i/48;p.push([(r-thick)*Math.cos(a),(r-thick)*Math.sin(a)+.18]);}
  for(let i=1;i<=16;i++){const a=Math.PI/2+Math.PI*i/16;p.push([-r+thick*Math.cos(a),.18+thick*Math.sin(a)]);}
  if(!up) for(const v of p) v[1]*=-1;
  return p;
}
function rawShape(name) {
  if(name==='pill'||name==='bar') return capsule(.285,.5);
  if(name==='line') return capsule(.5,.065);
  if(name==='happy'||name==='content') return arcShape(name==='happy');
  if(name==='star'){const p=[];for(let i=0;i<10;i++){const a=-Math.PI/2+TAU*i/10,r=i%2?.235:.54;p.push([Math.cos(a)*r,Math.sin(a)*r]);}return roundPolygon(p,3);}
  if(name==='cross') return roundPolygon([[-.35,-.48],[0,-.13],[.35,-.48],[.48,-.35],[.13,0],[.48,.35],[.35,.48],[0,.13],[-.35,.48],[-.48,.35],[-.13,0],[-.48,-.35]],3);
  if(name==='chevronL'||name==='chevronR') {const p=roundPolygon([[.23,-.5],[.4,-.34],[.03,0],[.4,.34],[.23,.5],[-.32,0]],3);if(name==='chevronR')for(const v of p)v[0]*=-1;return p;}
  const p=[];
  for(let i=0;i<256;i++){
    const a=-Math.PI/2+TAU*i/256,c=Math.cos(a),s=Math.sin(a);let x=c*.5,y=s*.5;
    if(name==='pin'){x*=.48;y*=.48;}
    if(name==='wide'){x*=1.08;y=Math.min(y*1.08,.43);}
    if(name==='half')y=Math.max(y,-.08);
    if(name==='angry')y=Math.max(y,-.2+x*.45);
    if(name==='sad')y=Math.max(y,-.2-x*.45);
    if(name==='squircle'){x=Math.sign(c)*Math.pow(Math.abs(c),.5)*.46;y=Math.sign(s)*Math.pow(Math.abs(s),.5)*.46;}
    if(name==='drop'){x*=.75+.4*s;y=s*.53;}
    if(name==='heart'){const t=TAU*i/256;x=16*Math.pow(Math.sin(t),3)/34;y=-(13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t))/34;}
    p.push([x,y]);
  }
  return p;
}
function resample(p,n) {
  let area=0;for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];area+=a[0]*b[1]-b[0]*a[1];}if(area<0)p.reverse();
  let top=0;for(let i=1;i<p.length;i++)if(p[i][1]<p[top][1]-1e-6||(Math.abs(p[i][1]-p[top][1])<1e-6&&Math.abs(p[i][0])<Math.abs(p[top][0])))top=i;
  p=p.slice(top).concat(p.slice(0,top));
  const lens=[0];for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];lens.push(lens[i]+Math.hypot(b[0]-a[0],b[1]-a[1]));}
  const out=new Float64Array(n*2);let j=0;
  for(let i=0;i<n;i++){const d=lens[p.length]*i/n;while(j<p.length-1&&lens[j+1]<d)j++;const f=(d-lens[j])/(lens[j+1]-lens[j]||1),a=p[j],b=p[(j+1)%p.length];out[i*2]=a[0]+(b[0]-a[0])*f;out[i*2+1]=a[1]+(b[1]-a[1])*f;}
  // Centre by the bounding box: half lids and hearts must not drift when they morph.
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(let i=0;i<n;i++){minX=Math.min(minX,out[i*2]);maxX=Math.max(maxX,out[i*2]);minY=Math.min(minY,out[i*2+1]);maxY=Math.max(maxY,out[i*2+1]);}
  for(let i=0;i<n;i++){out[i*2]-=(minX+maxX)/2;out[i*2+1]-=(minY+maxY)/2;}
  out.bottom=(maxY-minY)*.5;
  return out;
}
function library(n){if(!libraries[n]){const l={};for(const s of SHAPES)l[s]=resample(rawShape(s),n);libraries[n]=l;}return libraries[n];}
export function shapeContour(name,n=96){return library(n)[name]||library(n).dot;}
function eyeState(n,home) {const p=new Float64Array(shapeContour('dot',n));return {p,v:new Float64Array(n*2),cx:home,cy:0,vx:0,vy:0,home,radius:.5,drawScale:1};}
export function createEyes(n=96) {
  const home=n===96?1.0454545:.85;
  const e={n,t:0,spin:0,spinSpeed:0,merge:0,mergeV:0,size:1,sizeV:0,sizeTarget:1,boundX:2.27,boundTop:4,boundBottom:4,reducedMotion:false,L:eyeState(n,-home),R:eyeState(n,home),drips:[],bridge:false};
  for(let i=0;i<12;i++)e.drips.push({live:false,attached:false,age:0,x:0,y:0,vx:0,vy:0,r:0,kind:'tear',side:'L'});
  e.dent=(side,angle,depth=.18)=>dent(e,side,angle,depth);
  e.jiggle=(side,amount=.2)=>jiggle(e,side,amount);
  e.drip=(side,kind)=>drip(e,side,kind);
  return e;
}
export function dent(e,side,angle,depth=.18){const q=e[side==='R'?'R':'L'];for(let i=0;i<e.n;i++){const x=q.p[i*2],y=q.p[i*2+1],a=Math.atan2(y,x);const d=Math.atan2(Math.sin(a-angle),Math.cos(a-angle));const w=Math.exp(-d*d/ .18);q.p[i*2]-=Math.cos(angle)*depth*w;q.p[i*2+1]-=Math.sin(angle)*depth*w;q.v[i*2]-=Math.cos(angle)*depth*5*w;q.v[i*2+1]-=Math.sin(angle)*depth*5*w;}}
export function jiggle(e,side='both',amount=.2){for(const key of ['L','R'])if(side==='both'||side===key){const q=e[key];for(let i=0;i<e.n;i++){const a=TAU*i/e.n,w=Math.cos(a*3+e.t*4)*amount*8;q.v[i*2]+=Math.sin(a)*w;q.v[i*2+1]-=Math.cos(a)*w;}}}
export function drip(e,side='L',kind='tear'){let d=null;for(let i=0;i<e.drips.length;i++)if(!e.drips[i].live){d=e.drips[i];break;}if(!d)return;const q=e[side==='R'?'R':'L'];d.live=true;d.attached=true;d.kind=kind;d.side=side;d.age=0;d.r=kind==='spark'?.14:.12;d.x=q.cx+(kind==='sweat'?(side==='L'?-.42:.42):.12);d.y=q.cy+(kind==='bubble'||kind==='spark'?-.37:.37);d.vx=kind==='spark'?.3:0;d.vy=kind==='bubble'?-.6:kind==='spark'?-1.7:.15;}
function stepEye(e,q,target,side,dt,tension,merge) {
  const tx=q.home*(1-merge)+(target.x||0)*(1-merge)+(e.mergeX||0)*merge,ty=(target.y||0)*(1-merge)+(e.mergeY||0)*merge;
  const k=380*tension,damp=e.n===96?25:31;
  q.vx+=((tx-q.cx)*k-q.vx*damp)*dt;q.vy+=((ty-q.cy)*k-q.vy*damp)*dt;q.cx+=q.vx*dt;q.cy+=q.vy*dt;
  const shape=shapeContour(target.shape,e.n),mirror=side==='R'&&MIRROR[target.shape];
  const rot=(target.rot||0)+e.spin*merge,c=Math.cos(rot),s=Math.sin(rot),open=clamp(target.open==null?1:target.open,0,1);
  const scale=(target.s==null?1:target.s)*e.size,sx=(target.sx==null?1:target.sx)*scale,sy=(target.sy==null?1:target.sy)*scale;
  const speed=Math.hypot(q.vx,q.vy),stretch=e.reducedMotion?0:Math.min(.18,speed*.025),ax=speed>.001?q.vx/speed:0,ay=speed>.001?q.vy/speed:0;
  for(let i=0;i<e.n;i++){
    const a=TAU*i/e.n,w=e.reducedMotion?0:.0035*Math.sin(a*3-e.t*1.7+side.length)+.002*Math.sin(a*5+e.t*.8);
    const index=mirror?(e.n-i)%e.n:i;
    let x=shape[index*2]*(mirror?-1:1)*(1+w),y=shape[index*2+1]*(1+w);
    // A lid clips down from the top, leaving its ink anchored to the lower edge.
    y=Math.max(y,shape.bottom*(1-2*open)-.06*(1-open));x*=sx;y*=sy;
    const along=x*ax+y*ay;x+=along*ax*stretch;y+=along*ay*stretch;
    const px=x*c-y*s,py=x*s+y*c;
    const pk=k*(1+.055*Math.sin(a-e.t*3)),pd=e.n===96?24:31;
    const j=i*2;q.v[j]+=((px-q.p[j])*pk-q.v[j]*pd)*dt;q.v[j+1]+=((py-q.p[j+1])*pk-q.v[j+1]*pd)*dt;q.p[j]+=q.v[j]*dt;q.p[j+1]+=q.v[j+1]*dt;
  }
}
export function stepEyes(e,dt,pose,reducedMotion=false) {
  dt=clamp(dt,0,.1);e.reducedMotion=!!reducedMotion;const mergeTarget=clamp(pose.merge||0,0,1);e.mergeX=pose.mergeX||0;e.mergeY=pose.mergeY||0;e.spinSpeed+=((pose.spin||0)-e.spinSpeed)*(1-Math.exp(-dt*12));e.spin+=e.spinSpeed*dt;e.t+=dt;
  const steps=Math.max(1,Math.ceil(dt/.008)),h=dt/steps,tension=clamp(pose.tension||1,.4,1.6);
  for(let j=0;j<steps;j++){e.mergeV+=((mergeTarget-e.merge)*340-e.mergeV*27)*h;e.merge=clamp(e.merge+e.mergeV*h,0,1);e.sizeV+=((e.sizeTarget-e.size)*280-e.sizeV*24)*h;e.size+=e.sizeV*h;stepEye(e,e.L,pose.L||blankEye(),'L',h,tension,e.merge);stepEye(e,e.R,pose.R||blankEye(),'R',h,tension,e.merge);}
  // Preserve the whole contour when limiting big scale overshoots: no clipped edges.
  const separation=Math.max(.15,Math.hypot(e.R.cx-e.L.cx,e.R.cy-e.L.cy)*.5-.07);
  for(const side of ['L','R']){const q=e[side];q.cx=clamp(q.cx,-e.boundX+.23,e.boundX-.23);q.cy=clamp(q.cy,-e.boundTop+.23,e.boundBottom-.23);let radiusX=0,radiusY=0,radius=0;for(let i=0;i<e.n;i++){const x=q.p[i*2],y=q.p[i*2+1];radiusX=Math.max(radiusX,Math.abs(x));radiusY=Math.max(radiusY,Math.abs(y));radius=Math.max(radius,Math.hypot(x,y));}
    const limitX=Math.max(.15,e.boundX-Math.abs(q.cx)-.07),limitY=Math.max(.15,Math.min(e.boundTop+q.cy,e.boundBottom-q.cy)-.07);
    const ratio=Math.min(1,limitX/(radiusX||1),limitY/(radiusY||1),e.merge<.01?separation/(radius||1):1);if(ratio<1)for(let i=0;i<e.n*2;i++){q.p[i]*=ratio;q.v[i]*=ratio;}
    q.radius=radius*ratio;
  }
  const connected=e.merge>0&&Math.hypot(e.L.cx-e.R.cx,e.L.cy-e.R.cy)<1.6;
  if(e.bridge&&!connected&&!reducedMotion){e.L.vx-=.8;e.R.vx+=.8;jiggle(e,'both',.08);}e.bridge=connected;
  for(const d of e.drips)if(d.live){d.age+=dt;d.vy+=(d.kind==='bubble'?-.12:d.kind==='spark'?2.7:2.2)*dt;d.x+=d.vx*dt;d.y+=d.vy*dt;const q=e[d.side==='R'?'R':'L'];if(d.attached&&(d.age>.5||Math.hypot(d.x-q.cx,d.y-q.cy)>.45+d.r+.55)){d.attached=false;if(!reducedMotion){jiggle(e,d.side,.045);q.vy+=d.kind==='bubble'||d.kind==='spark'?.12:-.12;}}if(d.age>1.7)d.live=false;}
}
function contourPath(ctx,q,n,scale=1,fill=true){const p=q.p;scale*=q.drawScale;ctx.beginPath();ctx.moveTo(q.cx+(p[0]+p[(n-1)*2])*.5*scale,q.cy+(p[1]+p[(n-1)*2+1])*.5*scale);for(let i=0;i<n;i++){const j=(i+1)%n;ctx.quadraticCurveTo(q.cx+p[i*2]*scale,q.cy+p[i*2+1]*scale,q.cx+(p[i*2]+p[j*2])*.5*scale,q.cy+(p[i*2+1]+p[j*2+1])*.5*scale);}ctx.closePath();if(fill)ctx.fill();}
function bridge(ctx,ax,ay,ar,bx,by,br,strength=1){const dx=bx-ax,dy=by-ay,d=Math.hypot(dx,dy);if(d<.03||d>ar+br+.62||d<Math.abs(ar-br))return;const ux=dx/d,uy=dy/d,nx=-uy,ny=ux;const thin=clamp((ar+br+.62-d)/.62,0,1)*strength;const aw=ar*.72,bw=br*.72,neck=Math.min(aw,bw)*(.12+.62*thin);ctx.beginPath();ctx.moveTo(ax+nx*aw,ay+ny*aw);ctx.bezierCurveTo(ax+ux*d*.42+nx*neck,ay+uy*d*.42+ny*neck,bx-ux*d*.42+nx*neck,by-uy*d*.42+ny*neck,bx+nx*bw,by+ny*bw);ctx.lineTo(bx-nx*bw,by-ny*bw);ctx.bezierCurveTo(bx-ux*d*.42-nx*neck,by-uy*d*.42-ny*neck,ax+ux*d*.42-nx*neck,ay+uy*d*.42-ny*neck,ax-nx*aw,ay-ny*aw);ctx.closePath();ctx.fill();}
function styledContour(ctx,e,q,palette,style){
  if(style==='flat'){ctx.fillStyle=palette.ink;contourPath(ctx,q,e.n);return;}
  if(style==='glow'){
    ctx.fillStyle=palette.ink;for(let i=3;i>0;i--){ctx.globalAlpha=i===3?.035:i===2?.075:.16;contourPath(ctx,q,e.n,1+i*.16);}
    ctx.globalAlpha=1;ctx.fillStyle=e.glowInk;contourPath(ctx,q,e.n);
    ctx.globalAlpha=.34;ctx.fillStyle=e.glowHot;contourPath(ctx,q,e.n,.76);ctx.globalAlpha=1;return;
  }
  const small=e.n===40,cx=q.cx,cy=q.cy;
  // Depth is inside the contour. Highlights use the contour's own tangent, never a fixed ellipse.
  const depth=ctx.createRadialGradient(cx-.17,cy-.22,.025,cx+.08,cy+.13,.8*e.size);
  depth.addColorStop(0,e.glassLight);depth.addColorStop(.4,e.glassMid);depth.addColorStop(1,e.glassDark);
  ctx.fillStyle=depth;contourPath(ctx,q,e.n);
  contourPath(ctx,q,e.n,1,false);const rim=ctx.createLinearGradient(cx-.5,cy-.5,cx+.4,cy+.5);rim.addColorStop(0,'rgba(255,255,255,.9)');rim.addColorStop(.38,'rgba(255,255,255,.35)');rim.addColorStop(.56,'rgba(255,255,255,.04)');rim.addColorStop(1,'rgba(2,6,12,.6)');ctx.strokeStyle=rim;ctx.lineWidth=small?.075:.035;ctx.stroke();
  if(!small){contourPath(ctx,q,e.n,.91,false);ctx.strokeStyle='rgba(255,255,255,.08)';ctx.lineWidth=.025;ctx.stroke();}
  const p=q.p;ctx.beginPath();let started=false;for(let i=0;i<e.n;i++){const x=p[i*2],y=p[i*2+1];if(x>0&&y>0&&x+y>.68*e.size){if(!started){ctx.moveTo(cx+x*.89,cy+y*.89);started=true;}else ctx.lineTo(cx+x*.89,cy+y*.89);}else if(started)break;}ctx.strokeStyle='rgba(225,247,255,.65)';ctx.lineWidth=small?.045:.023;ctx.lineCap='round';ctx.stroke();
}
export function drawEyes(ctx,e,cx,cy,diameter,palette,style='flat'){
  if(e.colorFace!==palette.face||e.colorInk!==palette.ink){
    e.colorFace=palette.face;e.colorInk=palette.ink;
    e.glowInk=palette.dark?mix(palette.ink,'#ffffff',.85):palette.ink;
    e.glowHot=palette.dark?'#ffffff':mix(palette.ink,'#ffffff',.12);
    // The eye colour supplies the glass, not the screen: depth must not bury its contrast.
    e.glassLight=palette.dark?mix(palette.ink,'#ffffff',.28):mix(palette.ink,palette.face,.12);
    e.glassMid=palette.ink;
    e.glassDark=palette.dark?mix(palette.ink,palette.face,.035):mix(palette.ink,'#000000',.15);
  }
  e.L.drawScale=e.n===40?Math.max(1,1.25/(diameter*e.L.radius)):1;e.R.drawScale=e.n===40?Math.max(1,1.25/(diameter*e.R.radius)):1;
  ctx.save();ctx.translate(cx,cy);ctx.scale(diameter,diameter);
  ctx.fillStyle=style==='glow'?e.glowInk:style==='glass'?e.glassMid:palette.ink;
  if(e.bridge)bridge(ctx,e.L.cx,e.L.cy,.48*e.size,e.R.cx,e.R.cy,.48*e.size,e.merge);
  styledContour(ctx,e,e.L,palette,style);styledContour(ctx,e,e.R,palette,style);
  for(const d of e.drips)if(d.live){const q=e[d.side==='R'?'R':'L'];ctx.fillStyle=style==='glow'?e.glowInk:style==='glass'?e.glassMid:palette.ink;ctx.globalAlpha=clamp((1.7-d.age)/.45,0,1);if(d.attached)bridge(ctx,q.cx,q.cy,.45,d.x,d.y,d.r,1-d.age*2);ctx.beginPath();ctx.arc(d.x,d.y,d.r*(d.kind==='spark'?Math.max(.2,1-d.age*.5):1),0,TAU);ctx.fill();}
  ctx.restore();
}
