import QtQuick

Rectangle {
    id: root
    property string text: ""
    property string icon: ""
    property bool primary: false
    signal clicked()
    implicitWidth: label.implicitWidth + 32 + (icon ? 24 : 0)
    implicitHeight: PipTheme.tokens.control.buttonHeight
    radius: PipTheme.tokens.radius.control
    color: primary ? PipTheme.accent : hover.hovered ? Qt.rgba(1,1,1,0.08) : "transparent"
    border.width: primary ? 0 : 1
    border.color: PipTheme.hairline
    opacity: enabled ? 1 : 0.4
    activeFocusOnTab: true
    Keys.onReturnPressed: clicked()
    Keys.onSpacePressed: clicked()
    Rectangle { anchors.fill: parent; anchors.margins: -2; radius: parent.radius + 2; color: "transparent"; border.width: 1; border.color: PipTheme.accent; visible: root.activeFocus }
    PipIcon { visible: root.icon !== ""; name: root.icon; anchors.left: parent.left; anchors.leftMargin: 12; anchors.verticalCenter: parent.verticalCenter; color: root.primary ? (PipTheme.accent.r * 0.299 + PipTheme.accent.g * 0.587 + PipTheme.accent.b * 0.114 > 0.6 ? "#14151b" : "#f3f4f8") : PipTheme.primary }
    Text {
        id: label
        anchors.centerIn: parent
        anchors.horizontalCenterOffset: root.icon ? 10 : 0
        text: root.text
        textFormat: Text.PlainText
        font.family: PipTheme.tokens.font.ui.family
        font.pixelSize: PipTheme.tokens.font.ui.size
        font.weight: Font.Medium
        color: root.primary ? (PipTheme.accent.r * 0.299 + PipTheme.accent.g * 0.587 + PipTheme.accent.b * 0.114 > 0.6 ? "#14151b" : "#f3f4f8") : PipTheme.primary
    }
    HoverHandler { id: hover }
    TapHandler { onTapped: root.clicked() }
}
