import QtQuick

Item {
    id: root
    property string label: ""
    property bool checked: false
    signal toggled()
    implicitHeight: PipTheme.tokens.control.rowHeight
    opacity: enabled ? 1 : 0.4
    activeFocusOnTab: true
    Keys.onReturnPressed: toggled()
    Keys.onSpacePressed: toggled()
    Text { anchors.left: parent.left; anchors.right: track.left; anchors.rightMargin: 12; anchors.verticalCenter: parent.verticalCenter; text: root.label; textFormat: Text.PlainText; color: PipTheme.primary; font.family: PipTheme.tokens.font.ui.family; font.pixelSize: PipTheme.tokens.font.ui.size; elide: Text.ElideRight }
    Rectangle {
        id: track
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        width: PipTheme.tokens.control.toggle.w
        height: PipTheme.tokens.control.toggle.h
        radius: PipTheme.tokens.radius.pill
        color: root.checked ? PipTheme.accent : Qt.rgba(PipTheme.foreground.r,PipTheme.foreground.g,PipTheme.foreground.b,0.18)
        border.width: root.activeFocus ? 1 : 0
        border.color: PipTheme.accent
        Rectangle {
            width: track.height - 4; height: width; radius: width / 2
            y: 2; x: root.checked ? track.width - width - 2 : 2
            color: "white"
            border.width: 1; border.color: Qt.rgba(0,0,0,0.15)
            Behavior on x { SpringAnimation { spring: PipTheme.tokens.spring.default.stiffness / 100; damping: PipTheme.tokens.spring.default.damping; mass: 1 } }
        }
    }
    TapHandler { onTapped: root.toggled() }
}
