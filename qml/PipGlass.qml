import QtQuick

Rectangle {
    id: root
    color: PipTheme.ink
    radius: PipTheme.ready ? PipTheme.tokens.radius.card : 0
    border.width: 0
}
