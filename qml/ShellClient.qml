import QtQuick
import Quickshell
import Quickshell.Io

Scope {
    id: root
    property string role: "overlay"
    property var transport: null
    readonly property bool connected: transport ? transport.connected : false
    readonly property string socketPath: Quickshell.env("PIPCTL_SHELL_SOCKET") || ((Quickshell.env("XDG_RUNTIME_DIR") || ("/tmp/pip-shell-" + Quickshell.env("USER"))) + "/pip/shell.sock")
    property var settings: ({color:"theme",pointer:"arrow",eyeStyle:"flat",eyeSize:1,cursorSize:44,phonePosition:0.5,mood:"listening",followMouse:true,showCursor:true,glow:false,trail:"none",monitor:"auto",computerControl:false,notes:false,autoSleep:5,provider:"gemini",voice:true,voiceName:"Puck",replyMode:"talk",personality:"",volume:1})
    property var theme: PipTheme.theme
    property var status: ({phones:[],awake:false,state:"asleep",hasKey:false,computerControl:false,pairUrl:""})
    property real mouseX: 0
    property real mouseY: 0
    property bool mouseOnMonitor: true
    property var monitor: ({name:"",x:0,y:0,width:1440,height:900,scale:1})
    property int retryDelay: 250
    signal operation(var message)
    function send(message) {
        if (!transport || !transport.connected) return false
        transport.write(JSON.stringify(message) + "\n")
        transport.flush()
        return true
    }
    function receive(line) {
        var m
        try { m = JSON.parse(line) } catch (e) { console.warn("Pip: invalid shell message",e); return }
        if (m.op === "settings") { var values=m.settings || m; if(m.theme) { theme=m.theme; PipTheme.theme=m.theme }; settings = Object.assign({},settings,values) }
        else if (m.op === "status") status = Object.assign({},status,m)
        else if (m.op === "mouse") { mouseX=m.x; mouseY=m.y; mouseOnMonitor=m.onMonitor !== false }
        else if (m.op === "monitor") monitor = m
        operation(m)
    }
    function connect() {
        if (connected) return
        // A failed Quickshell Socket can retain its internal requested state.
        // Give each connection attempt its own parser and socket lifetime.
        if (transport) { transport.retired=true; transport.connected=false; transport.destroy(); transport=null }
        retryDelay=Math.min(10000,retryDelay*2)
        transport=socketComponent.createObject(root)
        transport.connected=true
    }
    Component {
        id: socketComponent
        Socket {
            id: link
            property bool retired: false
            path: root.socketPath
            parser: SplitParser { onRead: line => { if (!link.retired) root.receive(line) } }
            onConnectedChanged: {
                if (retired) return
                if (connected) { retry.stop(); root.retryDelay=250; root.send({ev:"hello",role:root.role}) }
                else retry.restart()
            }
            onError: if (!retired) retry.restart()
        }
    }
    Timer { id:retry; interval:root.retryDelay; onTriggered:root.connect() }
    Component.onCompleted: connect()
}
