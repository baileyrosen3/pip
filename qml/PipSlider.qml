import QtQuick

Item {
    id: root
    property string label: ""
    property real value: 44
    property real from: 28
    property real to: 72
    property real step: 1
    property string displayValue: value + " px"
    signal selected(real value)
    implicitHeight: PipTheme.tokens.control.rowHeight + 24
    opacity: enabled ? 1 : 0.4
    activeFocusOnTab: true
    function choose(x) { selected(Math.max(from, Math.min(to, from + Math.round((x / lane.width * (to-from)) / step) * step))) }
    Keys.onLeftPressed: selected(Math.max(from, value - step))
    Keys.onRightPressed: selected(Math.min(to, value + step))
    Text { anchors.left: parent.left; text: root.label; color: PipTheme.secondary; font.family: PipTheme.tokens.font.ui.family; font.pixelSize: PipTheme.tokens.font.ui.size }
    Text { anchors.right: parent.right; text: root.displayValue; color: PipTheme.secondary; font.family: PipTheme.tokens.font.mono.family; font.pixelSize: PipTheme.tokens.font.mono.size }
    Item {
        id: lane
        anchors.left: parent.left; anchors.right: parent.right; anchors.bottom: parent.bottom
        anchors.leftMargin: PipTheme.tokens.control.sliderThumb / 2
        anchors.rightMargin: PipTheme.tokens.control.sliderThumb / 2
        height: PipTheme.tokens.control.rowHeight
        Rectangle { anchors.verticalCenter: parent.verticalCenter; width: parent.width; height: PipTheme.tokens.control.sliderTrack; radius: height / 2; color: Qt.rgba(PipTheme.foreground.r,PipTheme.foreground.g,PipTheme.foreground.b,0.18) }
        Rectangle { anchors.verticalCenter: parent.verticalCenter; width: Math.max(0,Math.min(1,(root.value-root.from)/(root.to-root.from))) * lane.width; height: PipTheme.tokens.control.sliderTrack; radius: height / 2; color: PipTheme.accent }
        Rectangle {
            anchors.verticalCenter: parent.verticalCenter
            width: PipTheme.tokens.control.sliderThumb; height: width; radius: width / 2
            x: Math.max(0,Math.min(1,(root.value-root.from)/(root.to-root.from))) * lane.width - width / 2
            color: PipTheme.foreground
            border.width: root.activeFocus ? 2 : 1; border.color: root.activeFocus ? PipTheme.accent : PipTheme.hairline
            Behavior on x { SpringAnimation { spring: PipTheme.tokens.spring.quick.stiffness / 100; damping: PipTheme.tokens.spring.quick.damping; mass: 1 } }
        }
        MouseArea { anchors.fill: parent; onPressed: function(mouse) { root.forceActiveFocus(); root.choose(mouse.x) }; onPositionChanged: function(mouse) { if (pressed) root.choose(mouse.x) } }
    }
}
