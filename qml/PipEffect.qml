import QtQuick

Item {
    id:root
    property string kind:"ring"
    property real radius:24
    property real travelX:0
    property real travelY:0
    property real life:.26
    property string label:""
    property string displayFont:"Fredoka"
    property real progress:0
    width:radius*2; height:radius*2
    opacity:kind === "glyph" ? Math.min(1,progress/.12,(1-progress)/.45) : (kind === "dust" ? .16 : .6)*(1-progress)
    transform:Translate { x:root.travelX*(1-Math.pow(1-root.progress,3)); y:root.travelY*(1-Math.pow(1-root.progress,3)) }
    scale:kind === "ring" ? .3+.7*(1-Math.pow(1-progress,3)) : kind === "dust" ? .4+1.2*progress : 1-.4*progress
    Rectangle {
        visible:root.kind === "ring" || root.kind === "dust" || root.kind === "sparkle"
        anchors.fill:parent; radius:width/2
        color:root.kind === "ring" ? "transparent" : PipTheme.accent
        border.width:root.kind === "ring" ? 1*(1-root.progress) : 0
        border.color:PipTheme.accent
    }
    Rectangle {
        visible:root.kind === "glyph"
        anchors.centerIn:parent
        width:glyph.implicitWidth+12; height:glyph.implicitHeight+8; radius:8
        color:PipTheme.ink; border.width:1; border.color:PipTheme.hairline
        Text { id:glyph; anchors.centerIn:parent; text:root.label; color:PipTheme.primary; font.family:PipTheme.monoFont.name; font.pixelSize:PipTheme.tokens.font.mono.size }
    }
    NumberAnimation on progress { from:0; to:1; duration:root.life*1000; easing.type:Easing.OutCubic; onFinished:root.destroy() }
}
