import QtQuick
import QtQuick.Layouts
import "../avatar/pip.mjs" as Pip

PipGlass {
    id: root
    property var report: ({state:"hide"})
    property bool expanded: false
    property real availableHeight: 900
    property string faceColor: "theme"
    property string eyeStyle: "flat"
    property real eyeSize: 1
    property var theme: PipTheme.theme
    readonly property var palette: Pip.makePalette(theme,faceColor)
    onEyeStyleChanged: Pip.setEyeStyle(rig,eyeStyle)
    onEyeSizeChanged: Pip.setEyeSize(rig,eyeSize)
    Component.onCompleted: { Pip.setEyeStyle(rig,eyeStyle); Pip.setEyeSize(rig,eyeSize) }
    property var rig: Pip.createRig(621)
    property real life: 0
    property real enter: 0
    signal dismissed()
    visible: report.state !== "hide" && PipTheme.ready
    width: PipTheme.ready ? PipTheme.tokens.card.width : 420
    height: expanded && report.state === "show" ? Math.min(availableHeight*.75,124+content.implicitHeight) : report.state === "show" ? 220 : 164
    transform: Translate { x:(1-root.enter)*root.width }
    opacity: enter
    Behavior on enter { SpringAnimation { spring:PipTheme.tokens.spring.default.stiffness/100; damping:PipTheme.tokens.spring.default.damping; mass:1 } }
    Behavior on height { SpringAnimation { spring:PipTheme.tokens.spring.default.stiffness/100; damping:PipTheme.tokens.spring.default.damping; mass:1 } }
    onReportChanged: { if (report.state === "loading") expanded=false; enter=report.state === "hide" ? 0 : 1 }
    // The collapsed preview owns taps; expanded content owns scrolling and source links.
    MouseArea {
        x:20; y:82; width:parent.width-40; height:Math.max(0,parent.height-102)
        z:2; enabled:root.report.state === "show" && !root.expanded
        cursorShape:Qt.PointingHandCursor
        onClicked:root.expanded=true
    }
    Timer {
        interval:32; repeat:true
        running:root.visible
        onTriggered: {
            root.life+=.032
            Pip.stepRig(root.rig,.032,{state:root.report.state === "loading" ? "thinking" : "listening",mood:"happy",home:true,now:root.life})
            mini.requestPaint()
        }
    }
    ColumnLayout {
        anchors.fill:parent
        anchors.margins: PipTheme.ready ? PipTheme.tokens.space.l : 20
        spacing:12
        RowLayout {
            Layout.fillWidth:true
            Canvas {
                id:mini; Layout.preferredWidth:32; Layout.preferredHeight:32
                onPaint:{ var ctx=getContext("2d"); ctx.reset(); ctx.clearRect(0,0,width,height); Pip.drawMini(ctx,root.rig,32,root.palette) }
            }
            ColumnLayout {
                Layout.fillWidth:true; spacing:4
                Text {
                    Layout.fillWidth:true; text:root.report.title || (root.report.state === "loading" ? "A little curiosity…" : "Research")
                    color:PipTheme.primary; font.family:PipTheme.voiceFont.name; font.pixelSize:24; font.weight:Font.DemiBold
                    wrapMode:Text.Wrap; maximumLineCount:root.expanded ? 3 : 2; elide:Text.ElideRight
                }
            }
            Rectangle {
                visible:root.expanded
                Layout.preferredWidth:28; Layout.preferredHeight:28; radius:14; color:PipTheme.alpha(PipTheme.foreground,.06)
                PipIcon { anchors.centerIn:parent; width:16; height:16; name:"chevron"; color:PipTheme.secondary; rotation:180 }
                MouseArea { anchors.fill:parent; cursorShape:Qt.PointingHandCursor; onClicked:root.expanded=false }
            }
            Rectangle {
                Layout.preferredWidth:28; Layout.preferredHeight:28; radius:14; color:PipTheme.alpha(PipTheme.foreground,.06)
                PipIcon { anchors.centerIn:parent; width:16; height:16; name:"close"; color:PipTheme.secondary }
                MouseArea { anchors.fill:parent; cursorShape:Qt.PointingHandCursor; onClicked:root.dismissed() }
            }
        }
        Flickable {
            Layout.fillWidth:true; Layout.fillHeight:true; clip:true
            contentWidth:width; contentHeight:content.implicitHeight; boundsBehavior:Flickable.StopAtBounds
            Column {
                id:content; width:parent.width; spacing:12
                Text {
                    visible:root.report.state === "loading"
                    text:"Reading…"; color:PipTheme.secondary; font.family:PipTheme.uiFont.name; font.pixelSize:14
                }
                Text {
                    visible:root.report.state !== "show"; width:parent.width
                    text:root.report.state === "error" ? root.report.message || "Research failed" : root.report.question || ""
                    color:PipTheme.secondary; font.family:PipTheme.uiFont.name; font.pixelSize:14; wrapMode:Text.Wrap; lineHeight:1.45
                }
                Text {
                    visible:root.report.state === "show" && !root.expanded; width:parent.width
                    text:(root.report.paragraphs || [])[0] || ""
                    color:PipTheme.primary; font.family:PipTheme.uiFont.name; font.pixelSize:14; wrapMode:Text.Wrap; maximumLineCount:3; elide:Text.ElideRight; lineHeight:1.45
                }
                Repeater {
                    model:root.expanded ? root.report.paragraphs || [] : []
                    Text { required property string modelData; width:content.width; text:modelData; color:PipTheme.primary; font.family:PipTheme.uiFont.name; font.pixelSize:14; wrapMode:Text.Wrap; lineHeight:1.45 }
                }
                Text { visible:root.report.state === "show"; text:root.expanded ? "Use the arrow to collapse" : "Read the full story"; color:PipTheme.tertiary; font.family:PipTheme.monoFont.name; font.pixelSize:PipTheme.tokens.font.mono.size }
                Flow {
                    width:parent.width; spacing:8; visible:root.expanded
                    Repeater {
                        model:root.expanded ? root.report.sources || [] : []
                        Rectangle {
                            required property var modelData
                            readonly property string domain:String(modelData.url).replace(/^https?:\/\//,"").split("/")[0]
                            width:Math.min(content.width,sourceLabel.implicitWidth+16); height:32; color:"transparent"
                            Text { id:sourceLabel; x:8; width:parent.width-16; anchors.verticalCenter:parent.verticalCenter; text:parent.domain; color:PipTheme.secondary; font.family:PipTheme.uiFont.name; font.pixelSize:13; elide:Text.ElideRight }
                            MouseArea { anchors.fill:parent; cursorShape:Qt.PointingHandCursor; onClicked:Qt.openUrlExternally(modelData.url) }
                        }
                    }
                }
            }
        }
    }
}
