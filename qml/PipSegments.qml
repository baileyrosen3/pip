import QtQuick
import "../avatar/pip.mjs" as Pip

Item {
    id: root
    property string label: ""
    property string value: ""
    property var options: []
    property var previewRig: null
    property var previewPalette: null
    property int previewFrame: 0
    property bool eyePreviews: false
    property real eyeSize: 1
    signal selected(string value)
    implicitHeight: PipTheme.tokens.control.rowHeight + (label ? 24 : 0) + (previewRig ? 24 : 0)
    opacity: enabled ? 1 : 0.4
    Text { text: root.label; textFormat: Text.PlainText; color: PipTheme.secondary; font.family: PipTheme.tokens.font.ui.family; font.pixelSize: PipTheme.tokens.font.ui.size; visible: root.label !== "" }
    Rectangle {
        id: track
        anchors.bottom: parent.bottom
        width: parent.width
        height: PipTheme.tokens.control.rowHeight + (root.previewRig ? 24 : 0)
        radius: PipTheme.tokens.radius.pill
        color: Qt.rgba(PipTheme.foreground.r,PipTheme.foreground.g,PipTheme.foreground.b,0.06)
        property int selectedIndex: { for (var i=0; i<root.options.length; i++) if (String(root.options[i].value) === root.value) return i; return -1 }
        Rectangle {
            visible: track.selectedIndex >= 0
            x: 4 + Math.max(0,track.selectedIndex) * (track.width - 8) / Math.max(1,root.options.length)
            y: 4; height: track.height - 8
            width: (track.width - 8) / Math.max(1,root.options.length)
            radius: PipTheme.tokens.radius.pill
            color: Qt.rgba(PipTheme.accent.r,PipTheme.accent.g,PipTheme.accent.b,0.18)
            border.width: 1; border.color: Qt.rgba(PipTheme.accent.r,PipTheme.accent.g,PipTheme.accent.b,0.3)
            Behavior on x { SpringAnimation { spring: PipTheme.tokens.spring.default.stiffness / 100; damping: PipTheme.tokens.spring.default.damping; mass: 1 } }
        }
        Row {
            anchors.fill: parent; anchors.margins: 4
            Repeater {
                model: root.options
                delegate: Item {
                    required property var modelData
                    property var eyeRig: root.eyePreviews ? Pip.createRig(43) : null
                    width: (track.width - 8) / Math.max(1,root.options.length)
                    height: track.height - 8
                    activeFocusOnTab: true
                    Keys.onReturnPressed: root.selected(String(modelData.value))
                    Keys.onSpacePressed: root.selected(String(modelData.value))
                    Rectangle { anchors.fill: parent; radius: PipTheme.tokens.radius.pill; color: "transparent"; border.width: parent.activeFocus ? 1 : 0; border.color: PipTheme.accent }
                    Canvas {
                        id: preview
                        visible: !!root.previewRig
                        anchors.horizontalCenter: parent.horizontalCenter
                        y: 2
                        width: 32; height: 32
                        property int tick: root.previewFrame
                        onTickChanged: if (visible) requestPaint()
                        onPaint: {
                            var c=getContext("2d")
                            c.clearRect(0,0,width,height)
                            if (!root.previewRig || !root.previewPalette) return
                            if (root.eyePreviews) {
                                Pip.setEyeStyle(eyeRig,String(modelData.value)); Pip.setEyeSize(eyeRig,root.eyeSize)
                                Pip.stepRig(eyeRig,1/60,{state:"listening",home:true,now:root.previewFrame/60})
                                Pip.drawMini(c,eyeRig,width,root.previewPalette)
                                return
                            }
                            var size=20, bounds=Pip.cursorBounds(size,String(modelData.value))
                            var scale=Math.min(width/bounds.w,height/bounds.h)
                            c.save(); c.translate((width-bounds.w*scale)/2-bounds.x*scale,(height-bounds.h*scale)/2-bounds.y*scale)
                            c.scale(scale,scale)
                            Pip.drawCursor(c,root.previewRig,size,root.previewPalette,String(modelData.value))
                            c.restore()
                        }
                    }
                    Text { anchors.centerIn: parent; anchors.verticalCenterOffset: root.previewRig ? 18 : 0; width: parent.width - 8; horizontalAlignment: Text.AlignHCenter; elide: Text.ElideRight; text: modelData.label; textFormat: Text.PlainText; font.family: PipTheme.tokens.font.ui.family; font.pixelSize: PipTheme.tokens.font.ui.size; color: String(modelData.value) === root.value ? PipTheme.primary : PipTheme.secondary }
                    TapHandler { onTapped: root.selected(String(modelData.value)) }
                }
            }
        }
    }
}
