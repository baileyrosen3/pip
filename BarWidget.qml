import QtQuick
import Quickshell
import "qml"
import "avatar/pip.mjs" as Pip

Item {
    id: root
    property QtObject bar: null
    property string moduleName: "blr.pip"
    property var settings: ({})
    readonly property bool vertical: bar ? bar.vertical : false
    readonly property int barSize: bar ? bar.barSize : 32
    property string omarchyPath: "/usr/share/omarchy"
    property var shell: bar ? bar.shell : null
    property var manifest: null
    property var pluginRegistry: null
    property var barWidgetRegistry: null
    property bool popupOpen: false
    property var rig: Pip.createRig(7319)
    readonly property var palette: Pip.makePalette(client.theme,client.settings.color)
    readonly property bool hasPhone: client.status.phones && client.status.phones.length > 0
    readonly property int miniSize: Math.max(16,Math.min(28,barSize-PipTheme.tokens.space.xs))
    property real animationTime: 0
    property real lastTick: Date.now()/1000
    property string brainMood: ""
    property real talkUntil: 0
    implicitWidth: miniSize+PipTheme.tokens.space.s
    implicitHeight: barSize
    function close() { popupOpen=false }
    function setting(name,fallback) { var value=settings ? settings[name] : undefined; return value === undefined || value === null ? fallback : value }
    function broadcast(method) { var items=bar && typeof bar.moduleWidgets === "function" ? bar.moduleWidgets(moduleName) : [root]; for(var i=0;i<items.length;i++) if(items[i] && typeof items[i][method] === "function") items[i][method]() }
    ShellClient {
        id:client
        role:"bar"
        onOperation:function(message) {
            if(message.op === "brainMood") root.brainMood=message.mood || ""
            if(message.op === "talkTest") root.talkUntil=root.animationTime+(message.seconds || 3)
            if(message.op === "activity") Pip.activity(root.rig,message.name)
            if(message.op === "settings") { Pip.setEyeStyle(root.rig,client.settings.eyeStyle); Pip.setEyeSize(root.rig,client.settings.eyeSize) }
        }
    }
    Canvas {
        id:mini
        anchors.centerIn:parent
        width:root.miniSize; height:root.miniSize
        renderStrategy:Canvas.Threaded
        opacity:client.connected && root.hasPhone ? 1 : 0.4
        onPaint:{ var ctx=getContext("2d"); ctx.clearRect(0,0,width,height); Pip.drawMini(ctx,root.rig,root.miniSize,root.palette) }
    }
    Timer {
        interval:32; repeat:true; running:root.visible
        onTriggered:{
            var tick=Date.now()/1000
            var dt=Math.min(tick-root.lastTick,0.05)
            root.lastTick=tick
            root.animationTime+=dt
            var window=root.QsWindow.window
            var pos=window ? window.contentItem.mapFromItem(root,root.width/2,root.height/2) : Qt.point(0,0)
            var screen=window ? window.screen : null, monitor=client.monitor || {}
            var x=client.mouseX+Number(monitor.x || 0)-(screen ? screen.x : 0)-pos.x
            var y=client.mouseY+Number(monitor.y || 0)-(screen ? screen.y : 0)-pos.y
            var speaking=client.status.state === "speaking" || root.animationTime<root.talkUntil
            Pip.stepRig(root.rig,dt,{mood:root.brainMood || client.settings.mood || "listening",state:client.status.state,gazeX:Math.max(-1,Math.min(1,x/200)),gazeY:Math.max(-1,Math.min(1,y/200)),talk:speaking ? 0.5+0.5*Math.sin(root.animationTime*22) : 0,home:true,now:root.animationTime})
            mini.requestPaint()
        }
    }
    MouseArea {
        anchors.fill:parent; hoverEnabled:true; cursorShape:Qt.PointingHandCursor
        onClicked:root.popupOpen=!root.popupOpen
        onEntered:if(root.bar) root.bar.showTooltip(root,client.connected ? (root.hasPhone ? "Pip · "+client.status.state : "Pip · waiting for a phone") : "Pip · connecting")
        onExited:if(root.bar) root.bar.hideTooltip(root)
    }
    PipMenu { anchorItem:root; bar:root.bar; owner:root; open:root.popupOpen; client:client }
}
