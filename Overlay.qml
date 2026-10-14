import QtQuick
import QtQuick.Shapes
import Quickshell
import Quickshell.Wayland
import "qml"
import "avatar/pip.mjs" as Pip
import "avatar/engine.mjs" as Motion

Item {
    id: root
    property string omarchyPath: Quickshell.env("OMARCHY_PATH")
    property var shell: null
    property var manifest: null
    property var pluginRegistry: null
    property var barWidgetRegistry: null
    property var engine: new Motion.CursorEngine({}, Date.now()/1000)
    property var rig: Pip.createRig(481)
    property var palette: Pip.makePalette(client.theme,client.settings.color)
    property bool captured: false
    property var hideIds: []
    property var flyIds: []
    property real now: Date.now()/1000
    property real rigElapsed: 0
    property real tipX: 0
    property real tipY: 0
    property real cursorOpacity: 0
    property var samples: []
    property string ribbonPath: ""
    property real ribbonOpacity: 0
    property real ribbonTailX: 0
    property real ribbonTailY: 0
    property real lastSpark: 0
    property real bodyX: 0
    property real bodyY: 0
    property string caption: ""
    property var speechTarget: null
    property string shortText: ""
    property real shortBorn: 0
    property real shortLife: 1.4
    property var report: ({state:"hide"})
    readonly property var selectedScreen: {
        var screens=Quickshell.screens
        for (var i=0;i<screens.length;i++) if (screens[i].name === client.monitor.name) return screens[i]
        return screens.length ? screens[0] : null
    }
    readonly property var cursorBounds: Pip.cursorBounds(client.settings.cursorSize,client.settings.pointer)
    function open(payload) { if (payload) command(payload); captured=false }
    function close() { captured=true }
    function effect(point, kind, radius, life, tx, ty, label) {
        if (!client.settings.showCursor || captured) return
        effectComponent.createObject(stage,{x:point.x-radius,y:point.y-radius,kind:kind,radius:radius,life:life,travelX:tx || 0,travelY:ty || 0,label:label || "",displayFont:PipTheme.voiceFont.name})
    }
    function puff(point) {
        for (var i=0;i<5;i++) { var dx=(i-2)*7; effect({x:point.x+dx,y:point.y-3},"dust",5,.42,dx*.8,-12-i*2) }
    }
    function finishFlights(ok,error) {
        var ids=flyIds; flyIds=[]
        for (var i=0;i<ids.length;i++) client.send(ok ? {id:ids[i],ok:true} : {id:ids[i],ok:false,error:error})
    }
    function command(m) {
        switch (m.op) {
        case "settings":
            engine.settings=client.settings
            Pip.setEyeStyle(rig,client.settings.eyeStyle)
            Pip.setEyeSize(rig,client.settings.eyeSize)
            break
        case "mode":
            finishFlights(false,"Flight interrupted")
            engine.setMode(m.mode,{x:m.x || 0,y:m.y || 0}); break
        case "fly":
        case "drag-follow":
            finishFlights(false,"Flight replaced")
            if (m.id !== undefined) flyIds=[m.id]
            engine.setMode("pinned",{x:m.x,y:m.y})
            // A request at an already-settled tip still has to receive its reply.
            if (Math.hypot(engine.tip.x-m.x,engine.tip.y-m.y)<=.5 && engine.timeToArrive(now)===0) finishFlights(true)
            break
        case "awake": engine.awake=m.on; break
        case "brainMood": engine.brainMood=m.mood || null; break
        case "gaze": engine.gazeOverride=m.x === null || m.x === undefined ? null : {x:m.x,y:m.y}; break
        case "speechTarget": speechTarget=m.rect || null; break
        case "activity": Pip.activity(rig,m.name); break
        case "caption": caption=m.text || ""; break
        case "bubble": shortText=m.text || ""; shortBorn=now; shortLife=Math.max(m.life || 1.4,4,shortText.trim().split(/\s+/).length*.3); break
        case "press": engine.press(m.depth,now); break
        case "dragging": engine.dragging=m.on; break
        case "talkTest": engine.talkUntil=now+(m.seconds || 3); break
        case "clickEffect":
            engine.press(.14,now); effect({x:m.x,y:m.y},"ring",24,.26)
            break
        case "typedEffect":
            engine.press(.035,now)
            var chars=Array.from(m.text || "")
            for (var j=0;j<chars.length;j++) if (!/\s/.test(chars[j])) effect({x:engine.tip.x+engine.size*.55+j*6,y:engine.tip.y-6},"glyph",14,.9,(j%3-1)*10,-46,chars[j])
            break
        case "report": report=m; break
        case "hide":
            captured=true
            if (m.id !== undefined) hideIds=hideIds.concat([m.id])
            window.contentItem.Window.window.update()
            break
        case "show": captured=false; break
        }
    }
    ShellClient { id: client; role: "overlay"; onOperation: m => root.command(m) }
    Component { id: effectComponent; PipEffect {} }
    Component.onCompleted: {
        engine.settings=client.settings
        Pip.setEyeStyle(rig,client.settings.eyeStyle)
        Pip.setEyeSize(rig,client.settings.eyeSize)
        engine.onLaunch=point => root.puff(point)
        engine.onLand=point => { engine.press(.05,root.now); root.puff(point); root.finishFlights(true) }
    }
    Timer {
        interval: 30; repeat: true; running: client.connected
        onTriggered: client.send(Object.assign({ev:"face"},engine.face({width:window.width,height:window.height},Date.now()/1000)))
    }
    onPaletteChanged: cursor.requestPaint()
    FrameAnimation {
        running: true
        onTriggered: {
            root.now=Date.now()/1000
            var dt=Math.min(.05,Math.max(1/480,frameTime))
            var bounds={width:window.width,height:window.height}
            if (bounds.width<=0 || bounds.height<=0) return
            engine.step(dt,root.now,{x:client.mouseX,y:client.mouseY},bounds)
            root.rigElapsed+=dt
            if (root.rigElapsed>=1/30) {
                var face=engine.face(bounds,root.now)
                Pip.stepRig(rig,root.rigElapsed,{mood:face.mood,state:client.status.state,gazeX:face.gazeX,gazeY:face.gazeY,talk:face.talk,holding:client.status.state === "asking",vx:engine.velocity.x,vy:engine.velocity.y,angle:engine.angle,pointing:!engine.isHome,home:engine.isHome,press:1-engine.pressScale(root.now),now:root.now})
                root.rigElapsed=0
                if (!root.captured && client.settings.showCursor && engine.opacity>.01) cursor.requestPaint()
            }
            root.tipX=engine.tip.x; root.tipY=engine.tip.y+engine.hover(root.now); root.cursorOpacity=engine.opacity
            var center=engine.bodyCenter; root.bodyX=center.x; root.bodyY=center.y
            if (engine.dragging) client.send({ev:"tip",x:engine.tip.x,y:engine.tip.y})
            root.updateTrail(dt)
            root.placeSpeech()
            if (root.shortText && root.now-root.shortBorn>root.shortLife) root.shortText=""
        }
    }
    function updateTrail(dt) {
        var speed=Math.hypot(engine.velocity.x,engine.velocity.y)
        samples.push({x:bodyX,y:bodyY,time:now})
        var history=PipTheme.ready ? PipTheme.tokens.trail.historyMs/1000 : .22
        while (samples.length && now-samples[0].time>history) samples.shift()
        ribbonPath=""; ribbonOpacity=0
        if (client.settings.trail === "ribbon" && samples.length>2 && speed>120) {
            var left=[],right=[]
            for (var i=0;i<samples.length;i++) {
                var p=samples[i],prev=samples[Math.max(0,i-1)],next=samples[Math.min(samples.length-1,i+1)]
                var nx=-(next.y-prev.y),ny=next.x-prev.x,n=Math.max(Math.hypot(nx,ny),.001),w=1.5*Math.pow(i/(samples.length-1),1.3)
                left.push((p.x+nx/n*w)+","+(p.y+ny/n*w)); right.unshift((p.x-nx/n*w)+","+(p.y-ny/n*w))
            }
            ribbonPath="M "+left.concat(right).join(" L ")+" Z"
            ribbonTailX=samples[0].x; ribbonTailY=samples[0].y
            ribbonOpacity=Math.min(1,(speed-120)/600)*engine.opacity
        }
        if (client.settings.trail === "sparkles" && speed>300 && now-lastSpark>.05) {
            lastSpark=now
            effect({x:bodyX+Math.sin(now*29)*8,y:bodyY+Math.cos(now*23)*8},"sparkle",1.7,.26,-engine.velocity.x*.008,-engine.velocity.y*.008)
        }
    }
    function placeBubble(bubble,rect,beside) {
        var edge=14,gap=12,right=rect[0]+rect[2]+gap,left=rect[0]-gap-bubble.width
        var above=rect[1]-gap-bubble.height,below=rect[1]+rect[3]+gap
        var x=rect[0]+rect[2]/2-bubble.width/2,y=above
        if (beside && (right+bubble.width<=window.width-edge || left>=edge)) {
            x=right+bubble.width<=window.width-edge ? right : left
            y=rect[1]+rect[3]/2-bubble.height/2
        } else if (above<edge) y=below
        bubble.x=Math.max(edge,Math.min(window.width-bubble.width-edge,x))
        bubble.y=Math.max(edge,Math.min(window.height-bubble.height-edge,y))
    }
    function placeSpeech() {
        var rect
        if (engine.opacity>.1 && !engine.isHome) rect=speechTarget || [tipX,tipY,engine.size,engine.size]
        else rect=[window.width*client.settings.phonePosition,window.height-engine.size*.9,0,0]
        placeBubble(speech,rect,false)
        placeBubble(shortBubble,root.cursorOpacity>.1 ? [tipX,tipY,engine.size,engine.size] : rect,true)
    }
    PanelWindow {
        id: window
        screen: root.selectedScreen
        anchors { top:true; bottom:true; left:true; right:true }
        exclusionMode: ExclusionMode.Ignore
        color: "transparent"
        WlrLayershell.namespace: "pip-overlay"
        WlrLayershell.layer: WlrLayer.Overlay
        WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
        mask: Region {
            x:card.visible && !root.captured ? card.x : 0; y:card.visible && !root.captured ? card.y : 0
            width:card.visible && !root.captured ? card.width : 0; height:card.visible && !root.captured ? card.height : 0
            Region { x:speech.x; y:speech.y; width:speech.visible && speech.overflowing && !root.captured ? speech.width : 0; height:speech.visible && speech.overflowing && !root.captured ? speech.height : 0 }
            Region { x:shortBubble.x; y:shortBubble.y; width:shortBubble.visible && shortBubble.overflowing && !root.captured ? shortBubble.width : 0; height:shortBubble.visible && shortBubble.overflowing && !root.captured ? shortBubble.height : 0 }
        }
        Connections {
            target: window.contentItem.Window.window
            function onFrameSwapped() {
                if (!root.captured || !root.hideIds.length) return
                var ids=root.hideIds; root.hideIds=[]
                for (var i=0;i<ids.length;i++) client.send({id:ids[i],ok:true})
            }
        }
        Item {
            id: stage
            anchors.fill: parent
            opacity: root.captured ? 0 : 1
            Shape {
                anchors.fill: parent; visible: client.settings.showCursor; opacity: root.ribbonOpacity
                ShapePath {
                    strokeColor:"transparent"
                    fillGradient: LinearGradient {
                        x1:root.bodyX; y1:root.bodyY; x2:root.ribbonTailX; y2:root.ribbonTailY
                        GradientStop { position:0; color:PipTheme.alpha(PipTheme.accent,PipTheme.ready ? PipTheme.tokens.trail.alpha : .35) }
                        GradientStop { position:1; color:"transparent" }
                    }
                    PathSvg { path:root.ribbonPath }
                }
            }
            Canvas {
                id: cursor
                x:root.tipX+root.cursorBounds.x; y:root.tipY+root.cursorBounds.y
                width:root.cursorBounds.w; height:root.cursorBounds.h
                opacity:client.settings.showCursor ? root.cursorOpacity : 0
                renderTarget: Canvas.Image
                renderStrategy: Canvas.Threaded
                onPaint: {
                    var ctx=getContext("2d"); ctx.reset(); ctx.clearRect(0,0,width,height); ctx.save(); ctx.translate(-root.cursorBounds.x,-root.cursorBounds.y)
                    if (client.settings.glow) {
                        var s=client.settings.cursorSize
                        var glow=ctx.createRadialGradient(s*.5,s*.5,0,s*.5,s*.5,s*.7)
                        glow.addColorStop(0,String(PipTheme.alpha(PipTheme.accent,.18)))
                        glow.addColorStop(1,"transparent")
                        ctx.fillStyle=glow; ctx.beginPath(); ctx.arc(s*.5,s*.5,s*.7,0,Math.PI*2); ctx.fill()
                    }
                    Pip.drawCursor(ctx,root.rig,client.settings.cursorSize,root.palette,client.settings.pointer); ctx.restore()
                }
            }
            PipBubble {
                id:speech; text:root.caption; now:root.now
                availableWidth:Math.max(1,window.width-28); availableHeight:Math.max(1,window.height-28)
            }
            PipBubble {
                id:shortBubble; text:root.shortText; now:root.now
                availableWidth:Math.max(1,window.width-28); availableHeight:Math.max(1,window.height-28)
            }
            ResearchCard { id:card; x:window.width-width-24; y:48; report:root.report; availableHeight:window.height; faceColor:client.settings.color; eyeStyle:client.settings.eyeStyle; eyeSize:client.settings.eyeSize; onDismissed:root.report={state:"hide"} }
        }
    }
}
