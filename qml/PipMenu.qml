import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Hyprland
import "../avatar/pip.mjs" as Pip

PopupWindow {
    id: root
    required property Item anchorItem
    required property var bar
    property var owner: null
    required property var client
    property bool open: false
    property string qrPath: ""
    property string qrError: ""
    property string generatedUrl: ""
    property var previewRig: Pip.createRig(7320)
    property int previewFrame: 0
    readonly property var previewPalette: Pip.makePalette(client.theme,client.settings.color)
    property var previewAnimation: FrameAnimation {
        running: root.open
        onTriggered: {
            Pip.stepRig(root.previewRig,Math.min(frameTime,0.05),{mood:root.client.settings.mood || "listening",state:root.client.status.state,gazeX:0,gazeY:0,home:true})
            Pip.setEyeStyle(root.previewRig,root.client.settings.eyeStyle)
            Pip.setEyeSize(root.previewRig,root.client.settings.eyeSize)
            root.previewFrame++
        }
    }
    readonly property string pairUrl: client.status.pairUrl || ""
    readonly property bool hasPhone: client.status.phones && client.status.phones.length > 0
    readonly property string provider: client.settings.provider || client.status.provider || "gemini"
    readonly property var brains: [{value:"gemini",label:"Gemini · free"},{value:"openai",label:"OpenAI Realtime"},{value:"gptlive",label:"GPT-Live"}]
    readonly property var voices: provider === "gemini" ? ["Puck","Kore","Charon","Fenrir","Aoede","Leda","Orus","Zephyr"] : provider === "gptlive" ? ["vesper","marin","ripple","quartz","willow","stone","gleam","meridian","beacon","delta","cinder","bossa","tempo"] : ["marin","cedar","alloy","ash","ballad","coral","echo","sage","shimmer","verse"]
    readonly property string voiceName: voices.indexOf(client.settings.voiceName) >= 0 ? client.settings.voiceName : voices[0]
    readonly property string pricingUrl: provider === "gemini" ? "https://ai.google.dev/gemini-api/docs/pricing" : provider === "gptlive" ? "https://developers.openai.com/api/docs/models/gpt-live-1" : "https://developers.openai.com/api/docs/models/gpt-realtime-2.1"
    readonly property bool phoneServing: !!(client.status.tailscale && client.status.tailscale.serving)
    readonly property var anchorWindow: anchorItem.QsWindow.window
    readonly property var screenInfo: anchorWindow ? anchorWindow.screen : null
    readonly property int edge: PipTheme.tokens.space.m
    readonly property int padding: 24
    color: "transparent"
    visible: open
    implicitWidth: Math.min(420, screenInfo ? screenInfo.width - edge * 2 : 420)
    implicitHeight: Math.min(780, contents.implicitHeight + padding * 2, screenInfo ? screenInfo.height - (bar ? bar.barSize : 0) - edge * 2 : 780)
    function close() { if (owner && owner.close) owner.close(); else open = false }
    function setting(key, value) { var message = {ev:"settings"}; message[key] = value; client.send(message) }
    function control(cmd) { client.send({ev:"ctl",cmd:cmd}) }
    function removeQr() { if (qrPath) Quickshell.execDetached(["rm","-f","--",qrPath]); qrPath = "" }
    function updateQr() {
        if (qr.running || !open || !pairUrl || generatedUrl === pairUrl) return
        removeQr(); qrError = ""; generatedUrl = pairUrl
        qr.command = ["sh","-c","umask 077; f=$(mktemp \"${XDG_RUNTIME_DIR:-/tmp}/pip-pair-XXXXXX.svg\") || exit 1; trap 'rm -f -- \"$f\"' EXIT HUP INT TERM; qrencode -t svg -o \"$f\" -- \"$1\" || exit 1; printf '%s' \"$f\"; trap - EXIT HUP INT TERM","pip-qr",pairUrl]
        qr.running = true
    }
    onOpenChanged: {
        if (bar) { if (open) bar.requestPopout(owner || root); else if (bar.activePopout === (owner || root)) bar.releasePopout(owner || root) }
        if (open) updateQr()
        else { if (qr.running) qr.running=false; removeQr(); generatedUrl="" }
    }
    onPairUrlChanged: { if (!pairUrl) { generatedUrl = ""; removeQr() } else updateQr() }
    Component.onDestruction: removeQr()
    property var qrProcess: Process {
        id: qr
        stdout: StdioCollector {
            onStreamFinished: {
                var path=text.trim()
                if (!path) return
                if (root.open) root.qrPath=path
                else Quickshell.execDetached(["rm","-f","--",path])
            }
        }
        onExited: function(code,status) {
            if (code !== 0) { root.generatedUrl=""; root.qrError="Could not create the pairing code. Install qrencode, then reopen this menu." }
            else if (root.generatedUrl !== root.pairUrl) { root.generatedUrl=""; root.updateQr() }
        }
    }
    HyprlandFocusGrab { active: root.open; windows: root.anchorWindow ? [root,root.anchorWindow] : [root]; onCleared: root.close() }
    anchor {
        window: root.anchorWindow
        adjustment: PopupAdjustment.Slide
        edges: Edges.Top | Edges.Left
        gravity: Edges.Bottom | Edges.Right
        rect.width: 1; rect.height: 1
        onAnchoring: {
            if (!root.anchorWindow) return
            var x=root.anchorItem.width/2-root.width/2, y=root.anchorItem.height+root.edge
            if (root.bar && root.bar.position === "bottom") y=-root.height-root.edge
            else if (root.bar && root.bar.position === "left") { x=root.anchorItem.width+root.edge; y=root.anchorItem.height/2-root.height/2 }
            else if (root.bar && root.bar.position === "right") { x=-root.width-root.edge; y=root.anchorItem.height/2-root.height/2 }
            var p=root.anchorWindow.contentItem.mapFromItem(root.anchorItem,x,y)
            if (root.bar && root.bar.vertical) p.y=Math.max(root.edge,Math.min(p.y,root.anchorWindow.height-root.height-root.edge))
            else p.x=Math.max(root.edge,Math.min(p.x,root.anchorWindow.width-root.width-root.edge))
            root.anchor.rect.x=Math.round(p.x); root.anchor.rect.y=Math.round(p.y)
        }
    }
    PipGlass {
        anchors.fill: parent
        Flickable {
            id: scroll
            anchors.fill: parent; anchors.margins: root.padding
            contentWidth: width; contentHeight: contents.implicitHeight
            clip: true; boundsBehavior: Flickable.StopAtBounds
            Rectangle {
                parent:scroll
                anchors.right: parent.right; width: 3; radius: 2
                height: Math.max(24, scroll.height * scroll.height / Math.max(scroll.height,scroll.contentHeight))
                y: scroll.contentHeight > scroll.height ? scroll.contentY / (scroll.contentHeight-scroll.height) * (scroll.height-height) : 0
                color: PipTheme.tertiary
                visible: scroll.contentHeight > scroll.height
            }
            Column {
                id: contents
                width: parent.width
                spacing: 16
                Row {
                    width: parent.width; height: 32
                    Text { width: parent.width-32; text:"Pip"; color:PipTheme.primary; font.family:PipTheme.tokens.font.voice.family; font.pixelSize:PipTheme.tokens.font.voice.title; font.weight:Font.DemiBold }
                    Item { width:28; height:28; PipIcon { anchors.centerIn:parent; name:"close" } TapHandler { onTapped:root.close() } }
                }
                Text { width:parent.width; textFormat:Text.PlainText; text:!root.client.connected ? "Connecting to your desktop…" : root.hasPhone ? root.client.status.phones.join(", ")+" is connected" : "Your phone is Pip’s home. Pair it below."; wrapMode:Text.WordWrap; color:PipTheme.secondary; font.family:PipTheme.tokens.font.ui.family; font.pixelSize:PipTheme.tokens.font.ui.size }
                Text { width:parent.width; textFormat:Text.PlainText; text:(root.client.status.state || "asleep").toUpperCase()+"  ·  "+(root.client.status.provider || root.provider).toUpperCase()+" KEY "+(root.client.status.hasKey ? "SAVED" : "NOT SET"); wrapMode:Text.WordWrap; color:PipTheme.tertiary; font.family:PipTheme.tokens.font.mono.family; font.pixelSize:PipTheme.tokens.font.mono.size; font.letterSpacing:0.92 }
                Text { text:"PAIR YOUR PHONE"; color:PipTheme.tertiary; font.family:PipTheme.tokens.font.mono.family; font.pixelSize:PipTheme.tokens.font.mono.size; font.letterSpacing:0.92 }
                PipButton {
                    width:parent.width; visible:!root.phoneServing; text:"Set up phone access"; enabled:root.client.connected
                    Accessible.role:Accessible.Button; Accessible.name:text; Accessible.onPressAction:clicked()
                    onClicked:root.client.send({ev:"pair"})
                }
                Rectangle {
                    anchors.horizontalCenter:parent.horizontalCenter; width:220; height:220; radius:PipTheme.tokens.radius.panel; color:"white"; visible:root.qrPath !== ""
                    Image { anchors.fill:parent; anchors.margins:12; source:root.qrPath ? "file://"+root.qrPath : ""; fillMode:Image.PreserveAspectFit; cache:false }
                }
                Text { width:parent.width; textFormat:Text.PlainText; text:root.qrError || (root.pairUrl ? "Scan with your phone camera. This code contains your private pairing token; keep it to yourself." : "Your pairing code will appear once the desktop connects."); wrapMode:Text.WordWrap; color:PipTheme.secondary; font.family:PipTheme.tokens.font.ui.family; font.pixelSize:PipTheme.tokens.font.ui.size }
                PipButton { width:parent.width; text:"Open pairing page"; enabled:!!root.pairUrl; onClicked:Quickshell.execDetached(["xdg-open",root.pairUrl]) }
                PipButton { width:parent.width; primary:true; text:root.client.status.awake ? "Let Pip rest" : "Wake Pip and talk"; enabled:root.client.connected && root.hasPhone; onClicked:root.control("toggle") }
                Flow {
                    width:parent.width; spacing:8
                    Repeater {
                        model:[{label:"Point here",cmd:"point"},{label:"Go home",cmd:"dock"},{label:"Stop control",cmd:"stop"}]
                        delegate:PipButton { required property var modelData; width:(contents.width-8)/2; text:modelData.label; icon:modelData.cmd; enabled:root.client.connected; onClicked:root.control(modelData.cmd) }
                    }
                }
                Column {
                    width:parent.width; spacing:8
                    Accessible.role:Accessible.Grouping; Accessible.name:"Brain"
                    Text { text:"Brain"; color:PipTheme.secondary; font.family:PipTheme.tokens.font.ui.family; font.pixelSize:PipTheme.tokens.font.ui.size }
                    Repeater {
                        model:root.brains
                        delegate:PipButton {
                            required property var modelData
                            width:contents.width; text:modelData.label; enabled:root.client.connected
                            border.color:root.provider === modelData.value ? PipTheme.accent : PipTheme.hairline
                            color:root.provider === modelData.value ? PipTheme.alpha(PipTheme.accent,.12) : "transparent"
                            Accessible.role:Accessible.RadioButton; Accessible.name:text; Accessible.checkable:true; Accessible.checked:root.provider === modelData.value
                            Accessible.onPressAction:clicked()
                            onClicked:root.setting("provider",modelData.value)
                        }
                    }
                }
                Text { width:parent.width; text:root.provider === "gemini" ? "Gemini’s free tier is subject to quotas. Google may use free-tier data to improve its products." : root.provider === "gptlive" ? "Paid · $0.05/minute, plus separately billed backend Responses and tool usage. Uses the same OpenAI key as Realtime." : "Paid · per million tokens: audio $32 input / $64 output; text $4 input / $24 output."; wrapMode:Text.Wrap; color:PipTheme.secondary; font.family:PipTheme.tokens.font.ui.family; font.pixelSize:PipTheme.tokens.font.ui.size }
                PipButton {
                    width:parent.width; text:root.provider === "gemini" ? "Gemini pricing & data use" : root.provider === "gptlive" ? "GPT-Live pricing" : "OpenAI Realtime pricing"
                    Accessible.role:Accessible.Link; Accessible.name:text; Accessible.description:"Opens "+root.pricingUrl+" in your browser"; Accessible.onPressAction:clicked()
                    onClicked:Qt.openUrlExternally(root.pricingUrl)
                }
                PipToggle {
                    width:parent.width; label:"Spoken replies"; checked:root.provider === "gptlive" || root.client.settings.voice !== false; enabled:root.client.connected && root.provider !== "gptlive"
                    Accessible.role:Accessible.CheckBox; Accessible.name:label; Accessible.checkable:true; Accessible.checked:checked
                    Accessible.onPressAction:if(enabled) toggled()
                    onToggled:root.setting("voice",!checked)
                }
                Text { width:parent.width; text:root.provider === "gptlive" ? "GPT-Live always speaks. Captions stay visible while you listen." : "Spoken replies with full captions. Turn off for captions and a quiet chirp."; wrapMode:Text.Wrap; color:PipTheme.secondary; font.family:PipTheme.tokens.font.ui.family; font.pixelSize:PipTheme.tokens.font.ui.size }
                Column {
                    width:parent.width; spacing:8
                    Accessible.role:Accessible.Grouping; Accessible.name:"Voice"
                    Text { text:"Voice"; color:PipTheme.secondary; font.family:PipTheme.tokens.font.ui.family; font.pixelSize:PipTheme.tokens.font.ui.size }
                    Flow {
                        width:parent.width; spacing:8
                        Repeater {
                            model:root.voices
                            delegate:PipButton {
                                required property string modelData
                                width:(contents.width-16)/3; text:modelData; enabled:root.client.connected
                                border.color:root.voiceName === modelData ? PipTheme.accent : PipTheme.hairline
                                Accessible.role:Accessible.RadioButton; Accessible.name:text; Accessible.checkable:true; Accessible.checked:root.voiceName === modelData
                                Accessible.onPressAction:clicked()
                                onClicked:root.setting("voiceName",modelData)
                            }
                        }
                    }
                }
                Text { text:"CHARACTER"; color:PipTheme.tertiary; font.family:PipTheme.tokens.font.mono.family; font.pixelSize:PipTheme.tokens.font.mono.size; font.letterSpacing:0.92 }
                Text { text:"Pip’s colour"; color:PipTheme.secondary; font.family:PipTheme.tokens.font.ui.family; font.pixelSize:PipTheme.tokens.font.ui.size }
                Flow {
                    width:parent.width; spacing:8
                    PipButton { text:"Theme"; border.color:!root.client.settings.color || root.client.settings.color === "theme" ? PipTheme.accent : PipTheme.hairline; enabled:root.client.connected; onClicked:root.setting("color","theme") }
                    PipButton { text:"Accent"; border.color:root.client.settings.color === "accent" ? PipTheme.accent : PipTheme.hairline; enabled:root.client.connected; onClicked:root.setting("color","accent") }
                    Repeater {
                        model:{ var colors=[],keys=["accent","red","green","cyan","magenta","yellow"]; for(var i=0;i<keys.length;i++) if(root.client.theme[keys[i]] && colors.indexOf(root.client.theme[keys[i]])<0) colors.push(root.client.theme[keys[i]]); return colors }
                        delegate:Rectangle {
                            required property string modelData
                            width:40; height:40; radius:20
                            color:modelData
                            border.width:root.client.settings.color === modelData ? 2 : 1
                            border.color:root.client.settings.color === modelData ? PipTheme.foreground : PipTheme.hairline
                            activeFocusOnTab:true
                            enabled:root.client.connected
                            Keys.onReturnPressed:root.setting("color",modelData)
                            Keys.onSpacePressed:root.setting("color",modelData)
                            TapHandler { onTapped:root.setting("color",modelData) }
                        }
                    }
                }
                Rectangle {
                    width:parent.width; height:PipTheme.tokens.control.rowHeight; radius:PipTheme.tokens.radius.control
                    color:"transparent"; border.width:1; border.color:customColour.activeFocus ? PipTheme.accent : PipTheme.hairline
                    TextInput {
                        id:customColour
                        anchors.fill:parent; anchors.margins:12
                        verticalAlignment:TextInput.AlignVCenter
                        text:/^#[0-9a-fA-F]{6}$/.test(root.client.settings.color || "") ? root.client.settings.color : ""
                        color:PipTheme.primary; font.family:PipTheme.tokens.font.mono.family; font.pixelSize:PipTheme.tokens.font.ui.size
                        maximumLength:7; selectByMouse:true; enabled:root.client.connected
                        validator:RegularExpressionValidator { regularExpression:/#[0-9a-fA-F]{6}/ }
                        onEditingFinished:if(acceptableInput) root.setting("color",text.toLowerCase())
                        Text { anchors.verticalCenter:parent.verticalCenter; visible:!customColour.text && !customColour.activeFocus; text:"Custom colour · #rrggbb"; color:PipTheme.tertiary; font:customColour.font }
                    }
                }
                PipSegments { width:parent.width; label:"Eyes"; value:root.client.settings.eyeStyle || "flat"; options:Pip.EYE_STYLES.map(function(s) { return {value:s.id,label:s.name} }); previewRig:root.previewRig; eyePreviews:true; eyeSize:root.client.settings.eyeSize || 1; previewPalette:root.previewPalette; previewFrame:root.previewFrame; enabled:root.client.connected; onSelected:function(value) { root.setting("eyeStyle",value) } }
                PipSlider { width:parent.width; label:"Eye size"; from:.7; to:1.5; step:.01; value:root.client.settings.eyeSize || 1; displayValue:Math.round(value*100)+"%"; enabled:root.client.connected; onSelected:function(value) { root.setting("eyeSize",value) } }
                PipSegments { width:parent.width; label:"Pointer"; value:root.client.settings.pointer || "arrow"; options:Pip.POINTERS.map(function(p) { return {value:p.id,label:p.name} }); previewRig:root.previewRig; previewPalette:root.previewPalette; previewFrame:root.previewFrame; enabled:root.client.connected; onSelected:function(value) { root.setting("pointer",value) } }
                PipSlider { width:parent.width; label:"Pointer size"; value:root.client.settings.cursorSize || 44; enabled:root.client.connected; onSelected:function(value) { root.setting("cursorSize",value) } }
                PipSegments { width:parent.width; label:"Pip answers"; value:root.client.settings.replyMode || "talk"; options:[{value:"talk",label:"When I talk"},{value:"name",label:"Say “Pip”"},{value:"hold",label:"When I hold"}]; enabled:root.client.connected; onSelected:function(value) { root.setting("replyMode",value) } }
                Text { width:parent.width; visible:root.provider === "gemini"; text:"Gemini’s “Say Pip” mode is best-effort: proactive audio and instructions ask it to stay silent unless addressed as Pip. This is not a guaranteed wake-word detector."; wrapMode:Text.WordWrap; color:PipTheme.secondary; font.family:PipTheme.tokens.font.ui.family; font.pixelSize:PipTheme.tokens.font.ui.size }
                Text { text:"DESKTOP"; color:PipTheme.tertiary; font.family:PipTheme.tokens.font.mono.family; font.pixelSize:PipTheme.tokens.font.mono.size; font.letterSpacing:0.92 }
                Text { text:"Monitor"; color:PipTheme.secondary; font.family:PipTheme.tokens.font.ui.family; font.pixelSize:PipTheme.tokens.font.ui.size }
                Flow {
                    width:parent.width; spacing:8
                    Repeater {
                        model:{ var list=["auto"]; for(var i=0;i<Quickshell.screens.length;i++) list.push(Quickshell.screens[i].name); return list }
                        delegate:PipButton { required property string modelData; text:modelData === "auto" ? "Auto" : modelData; border.color:root.client.settings.monitor === modelData ? PipTheme.accent : PipTheme.hairline; enabled:root.client.connected; onClicked:root.setting("monitor",modelData) }
                    }
                }
                Repeater {
                    model:[{key:"computerControl",label:"Computer control"},{key:"followMouse",label:"Follow my mouse"},{key:"showCursor",label:"Show Pip on desktop"}]
                    delegate:PipToggle { required property var modelData; width:parent.width; label:modelData.label; checked:!!root.client.settings[modelData.key]; enabled:root.client.connected; onToggled:root.setting(modelData.key,!checked) }
                }
                PipSlider { width:parent.width; label:"Voice & chirp volume"; from:0; to:1; step:.01; value:root.client.settings.volume === undefined ? 1 : root.client.settings.volume; displayValue:Math.round(value*100)+"%"; enabled:root.client.connected; onSelected:function(value) { root.setting("volume",value) } }
                Text { text:"Personality"; color:PipTheme.secondary; font.family:PipTheme.uiFont.name; font.pixelSize:14 }
                Rectangle {
                    width:parent.width; height:100; radius:12; color:PipTheme.alpha(PipTheme.foreground,.06)
                    TextEdit {
                        anchors.fill:parent; anchors.margins:12; text:root.client.settings.personality || ""
                        color:PipTheme.primary; font.family:PipTheme.uiFont.name; font.pixelSize:14
                        wrapMode:TextEdit.Wrap; selectByMouse:true; enabled:root.client.connected
                        onActiveFocusChanged:if(!activeFocus && text !== root.client.settings.personality) root.setting("personality",text)
                    }
                }
                Repeater {
                    model:[{provider:"openai",name:"OpenAI",url:"https://platform.openai.com/api-keys",placeholder:"sk-…"},{provider:"gemini",name:"Gemini",url:"https://aistudio.google.com/apikey",placeholder:"Paste your Gemini API key"}]
                    delegate:Column {
                        id:keyField
                        required property var modelData
                        readonly property bool saved: !!(root.client.status.keys && root.client.status.keys[modelData.provider])
                        width:contents.width; spacing:12
                        function saveKey() {
                            var key=privateKey.text.trim()
                            if (root.client.connected && key && root.client.send({ev:"setKey",provider:modelData.provider,key:key})) privateKey.text=""
                        }
                        Text { width:parent.width; text:keyField.modelData.name+" key · "+(keyField.saved ? "saved on this computer" : "not set"); wrapMode:Text.WordWrap; color:PipTheme.secondary; font.family:PipTheme.tokens.font.ui.family; font.pixelSize:PipTheme.tokens.font.ui.size }
                        Rectangle {
                            width:parent.width; height:PipTheme.tokens.control.rowHeight; radius:PipTheme.tokens.radius.control
                            color:PipTheme.alpha(PipTheme.foreground,.06); border.width:privateKey.activeFocus ? 1 : 0; border.color:PipTheme.accent
                            TextInput {
                                id:privateKey; anchors.fill:parent; anchors.margins:12; verticalAlignment:TextInput.AlignVCenter
                                echoMode:TextInput.Password; color:PipTheme.primary; font.family:PipTheme.tokens.font.ui.family; font.pixelSize:PipTheme.tokens.font.ui.size
                                selectByMouse:true; activeFocusOnTab:true; enabled:root.client.connected
                                inputMethodHints:Qt.ImhHiddenText | Qt.ImhSensitiveData | Qt.ImhNoPredictiveText | Qt.ImhNoAutoUppercase
                                Accessible.name:keyField.modelData.name+" API key"
                                Accessible.description:"Saved only on this computer. Replaces only the "+keyField.modelData.name+" key."
                                onAccepted:keyField.saveKey()
                                Text { anchors.verticalCenter:parent.verticalCenter; visible:!privateKey.text; text:keyField.modelData.placeholder; color:PipTheme.tertiary; font:privateKey.font }
                            }
                        }
                        PipButton {
                            width:parent.width; text:"Get a "+keyField.modelData.name+" API key"
                            Accessible.role:Accessible.Link; Accessible.name:text; Accessible.description:"Opens "+keyField.modelData.url+" in your browser"
                            Accessible.onPressAction:clicked()
                            onClicked:Qt.openUrlExternally(keyField.modelData.url)
                        }
                        // The bar popup can't always take keyboard focus (so Ctrl+V may not reach the field):
                        // read the clipboard directly instead. The key is never shown.
                        Process {
                            id:clipboardKey
                            command:["wl-paste","--no-newline","--type","text/plain"]
                            stdout:StdioCollector {
                                waitForEnd:true
                                onStreamFinished:{
                                    var key=text.trim()
                                    if (!key || /\s/.test(key)) { keyField.pasteError="The clipboard doesn't hold a key. Copy it again and retry."; return }
                                    keyField.pasteError=""
                                    root.client.send({ev:"setKey",provider:keyField.modelData.provider,key:key})
                                }
                            }
                        }
                        property string pasteError:""
                        PipButton {
                            width:parent.width; text:"Paste "+keyField.modelData.name+" key from clipboard"; enabled:root.client.connected && !clipboardKey.running
                            Accessible.role:Accessible.Button; Accessible.name:text; Accessible.onPressAction:clicked()
                            onClicked:clipboardKey.running=true
                        }
                        Text { width:parent.width; visible:!!keyField.pasteError; text:keyField.pasteError; wrapMode:Text.WordWrap; color:PipTheme.secondary; font.family:PipTheme.tokens.font.ui.family; font.pixelSize:PipTheme.tokens.font.ui.size }
                        PipButton {
                            width:parent.width; visible:!!privateKey.text.trim(); text:"Save typed "+keyField.modelData.name+" key"; enabled:root.client.connected
                            Accessible.role:Accessible.Button; Accessible.name:text; Accessible.onPressAction:clicked()
                            onClicked:keyField.saveKey()
                        }
                    }
                }
                Text { width:parent.width; text:"OpenAI Realtime and GPT-Live share your OpenAI key. Keys are saved only on your computer and sent only to their provider. Saving one key does not change the other."; wrapMode:Text.WordWrap; color:PipTheme.secondary; font.family:PipTheme.tokens.font.ui.family; font.pixelSize:PipTheme.tokens.font.ui.size }
                PipButton { width:parent.width; text:"Open meeting notes"; icon:"notes"; enabled:root.client.connected; onClicked:root.client.send({ev:"openNotes"}) }
                Text { width:parent.width; visible:!root.client.status.hasKey; text:"Add your "+(root.provider === "gemini" ? "Gemini" : "OpenAI")+" key above or from your paired phone to start a conversation."; wrapMode:Text.WordWrap; color:PipTheme.secondary; font.family:PipTheme.tokens.font.ui.family; font.pixelSize:PipTheme.tokens.font.ui.size }
            }
        }
    }
}
