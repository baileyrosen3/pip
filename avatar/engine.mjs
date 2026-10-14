// Faithful, top-left/y-down port of Riley Brown's CursorOverlay.swift motion.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export class TimingCurve {
  constructor(x1, y1, x2, y2) { Object.assign(this, {x1, y1, x2, y2}); }
  coordinate(t, a, b) { const u = 1-t; return 3*u*u*t*a + 3*u*t*t*b + t*t*t; }
  derivative(t, a, b) { const u = 1-t; return 3*u*u*a + 6*u*t*(b-a) + 3*t*t*(1-b); }
  parameter(x) {
    let t = x;
    for (let i=0; i<8; i++) {
      const error = this.coordinate(t,this.x1,this.x2)-x;
      if (Math.abs(error)<1e-7) return t;
      const d=this.derivative(t,this.x1,this.x2);
      if (Math.abs(d)<1e-7) break;
      t-=error/d;
    }
    let low=0, high=1; t=x;
    for (let i=0; i<40; i++) {
      const value=this.coordinate(t,this.x1,this.x2);
      if (Math.abs(value-x)<1e-7) break;
      if (value<x) low=t; else high=t;
      t=(low+high)/2;
    }
    return t;
  }
  value(x) { return x<=0 ? 0 : x>=1 ? 1 : this.coordinate(this.parameter(x),this.y1,this.y2); }
  rate(x) { const t=this.parameter(clamp(x,0,1)), dx=this.derivative(t,this.x1,this.x2); return dx>1e-7 ? this.derivative(t,this.y1,this.y2)/dx : 0; }
}
TimingCurve.launch=new TimingCurve(.42,0,.22,1);
TimingCurve.redirect=new TimingCurve(.25,.25,.22,1);
TimingCurve.steady=new TimingCurve(.42,0,.38,1);
export class Flight {
  constructor(from,c1,c2,to,start,duration,timing,pointing) { Object.assign(this,{from,c1,c2,to,start,duration,timing,pointing,landed:false}); }
  progress(now) { return this.duration<=0 ? 1 : clamp((now-this.start)/this.duration,0,1); }
  position(e) { const u=1-e,a=u*u*u,b=3*u*u*e,c=3*u*e*e,d=e*e*e; return {x:a*this.from.x+b*this.c1.x+c*this.c2.x+d*this.to.x,y:a*this.from.y+b*this.c1.y+c*this.c2.y+d*this.to.y}; }
  tangent(e) { const u=1-e,a=3*u*u,b=6*u*e,c=3*e*e; return {x:a*(this.c1.x-this.from.x)+b*(this.c2.x-this.c1.x)+c*(this.to.x-this.c2.x),y:a*(this.c1.y-this.from.y)+b*(this.c2.y-this.c1.y)+c*(this.to.y-this.c2.y)}; }
}
export class CursorEngine {
  constructor(settings={}, now=0, random=Math.random) {
    this.settings=Object.assign({cursorSize:44,phonePosition:.5,mood:'listening'},settings);
    Object.assign(this,{mode:'following',pin:{x:0,y:0},tip:{x:-1000,y:-1000},velocity:{x:0,y:0},angle:Math.PI/4,angleVelocity:0,opacity:0,flight:null,placed:false,bounds:{width:1440,height:900},dragging:false,onLand:null,onLaunch:null,landedAt:-10,pressStart:-10,pressDepth:0,talkUntil:0,brainMood:null,gazeOverride:null,awake:false,mouse:{x:0,y:0},lastMouseMove:now,talkLevel:()=>0,blinkUntil:0,nextBlink:now+3,random});
  }
  get size() { return this.settings.cursorSize; }
  get isHome() { return this.mode!=='pinned'; }
  setMode(mode, point) { this.mode=mode; if (point) this.pin={x:point.x,y:point.y}; }
  phonePoint(b=this.bounds) { return {x:b.width*this.settings.phonePosition,y:b.height+b.height*.18}; }
  // Pip's pointers hang down-right of the hotspot, so the dock sits a full pointer above the edge (fully visible).
  dockPoint(b=this.bounds) { return {x:b.width*this.settings.phonePosition,y:b.height-this.size*1.1}; }
  tuckedPoint(b=this.bounds) { return {x:b.width*this.settings.phonePosition,y:b.height+this.size*.35}; }
  goal() { return this.mode==='docked' ? this.dockPoint() : this.mode==='following' ? this.tuckedPoint() : this.pin; }
  timeToArrive(now) { return this.flight ? Math.max(0,this.flight.start+this.flight.duration-now) : 0; }
  press(depth,now) { this.pressStart=now; this.pressDepth=depth; }
  step(dt,now,mouse,bounds) {
    this.bounds.width=bounds.width; this.bounds.height=bounds.height;
    if (Math.hypot(mouse.x-this.mouse.x,mouse.y-this.mouse.y)>1.5) this.lastMouseMove=now;
    this.mouse.x=mouse.x; this.mouse.y=mouse.y;
    if (!this.placed) { this.tip=this.tuckedPoint(); this.placed=true; }
    const target=this.goal(), from=this.flight ? this.flight.to : this.tip;
    if (Math.hypot(from.x-target.x,from.y-target.y)>.5) this.plan(target,now);
    this.advance(now);
    const settled=!this.flight || this.flight.progress(now)>=1;
    const wantOpacity=this.mode==='following' && settled ? 0 : 1;
    this.opacity+=(wantOpacity-this.opacity)*Math.min(1,dt*(wantOpacity>this.opacity ? 12 : 6));
    const targetAngle=(this.isHome ? Math.PI/4 : 0)+clamp(this.velocity.x/2800,-.2,.2), k=24;
    this.angleVelocity+=(k*(targetAngle-this.angle)-2*Math.sqrt(k)*this.angleVelocity)*dt;
    this.angle+=this.angleVelocity*dt;
    if (now>this.nextBlink) { this.blinkUntil=now+.13; this.nextBlink=now+2.5+this.random()*3.5; }
  }
  plan(goal,now) {
    const from=this.tip,dx=goal.x-from.x,dy=goal.y-from.y,distance=Math.hypot(dx,dy),pointing=!this.isHome,dock=this.dockPoint();
    const fromHome=Math.hypot(from.x-dock.x,from.y-dock.y)<this.size*1.2 || from.y>this.bounds.height-2;
    if (distance<=.5) { this.flight=new Flight(from,from,goal,goal,now,0,TimingCurve.launch,pointing); return; }
    let duration=clamp(.4+.12*Math.log2(1+distance/24),.45,1.2);
    if (this.dragging) duration=clamp(duration*1.45,.6,1.6);
    const direction={x:dx/distance,y:dy/distance};
    let nx=-direction.y,ny=direction.x;
    if (Math.abs(direction.x)>.4) { if (ny>0) { nx=-nx; ny=-ny; } }
    else { const middle=this.bounds.width/2-(from.x+goal.x)/2>=0 ? 1 : -1; if (nx*middle<0) { nx=-nx; ny=-ny; } }
    const bow=this.dragging ? 0 : Math.min(distance*.1,70)*.75,reach=distance*.3;
    const c2={x:goal.x-direction.x*reach+nx*bow,y:goal.y-direction.y*reach+ny*bow};
    const speed=Math.hypot(this.velocity.x,this.velocity.y);
    let c1,timing;
    if (speed>60) {
      let cx=this.velocity.x*duration/3,cy=this.velocity.y*duration/3,length=Math.hypot(cx,cy);
      if (length>distance*.6) { cx=cx/length*distance*.6; cy=cy/length*distance*.6; }
      c1={x:from.x+cx,y:from.y+cy}; timing=TimingCurve.redirect;
    } else { c1={x:from.x+direction.x*reach+nx*bow,y:from.y+direction.y*reach+ny*bow}; timing=this.dragging ? TimingCurve.steady : TimingCurve.launch; }
    this.flight=new Flight(from,c1,c2,{x:goal.x,y:goal.y},now,duration,timing,pointing);
    if (pointing && fromHome && this.onLaunch) this.onLaunch({x:dock.x,y:this.bounds.height});
  }
  advance(now) {
    const f=this.flight;
    if (!f) { this.velocity={x:0,y:0}; return; }
    const p=f.progress(now),e=f.timing.value(p); this.tip=f.position(e);
    if (p>=1) {
      this.velocity={x:0,y:0};
      if (!f.landed) { f.landed=true; if (f.pointing) { this.landedAt=now; if (this.onLand) this.onLand(this.tip); } else if (this.mode==='following' && this.onLaunch) this.onLaunch({x:this.tip.x,y:this.bounds.height}); }
    } else { const rate=f.timing.rate(p)/f.duration,d=f.tangent(e); this.velocity={x:d.x*rate,y:d.y*rate}; }
  }
  pressScale(now) { const t=now-this.pressStart; if (t<0 || t>=.42) return 1; if (t<.12) return 1-this.pressDepth*Math.sin(t/.12*Math.PI/2); const r=(t-.12)/.3; return 1-this.pressDepth*Math.cos(r*Math.PI*1.5)*Math.exp(-r*3.2); }
  hover(now) { if (this.isHome || (this.flight && this.flight.progress(now)<1)) return 0; const since=now-this.landedAt; return Math.sin(since*2.4)*1.6*clamp((since-.35)/.6,0,1); }
  get bodyCenter() { const r=this.size*.5*Math.SQRT2; return {x:this.tip.x+Math.cos(this.angle+Math.PI/4)*r,y:this.tip.y+Math.sin(this.angle+Math.PI/4)*r}; }
  face(bounds,now) {
    const phone=this.phonePoint(bounds),c=this.mode==='following' ? this.mouse : this.bodyCenter;
    let gazeX=clamp((c.x-phone.x)/(bounds.width*.5),-1,1),gazeY=-clamp((phone.y-c.y)/(bounds.height*1.1),.15,1);
    if (this.gazeOverride) { gazeX=this.gazeOverride.x; gazeY=this.gazeOverride.y; }
    const testing=now<this.talkUntil,talk=testing ? .5+.5*Math.sin(now*19)*Math.sin(now*7.3) : this.talkLevel();
    let mood=this.settings.mood;
    if (this.brainMood) mood=this.brainMood;
    else if (testing) mood='talking';
    else if (this.mode==='pinned' && mood==='listening') mood='pointing';
    else if (this.mode==='following' && !this.awake && mood==='listening') { const idle=now-this.lastMouseMove; if (idle>15) mood='resting'; else if (idle>5) mood='sleepy'; }
    return {gazeX,gazeY,mood,talk};
  }
}
