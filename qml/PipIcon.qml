import QtQuick

Canvas {
    id: root
    property string name: ""
    property color color: PipTheme.primary
    implicitWidth: 18
    implicitHeight: 18
    onNameChanged: requestPaint()
    onColorChanged: requestPaint()
    onWidthChanged: requestPaint()
    onHeightChanged: requestPaint()
    onPaint: {
        var c = getContext("2d")
        c.clearRect(0,0,width,height)
        c.save(); c.scale(width/24,height/24)
        c.strokeStyle = root.color; c.lineWidth = PipTheme.tokens.control.iconStroke * 24 / Math.max(1,width)
        c.lineCap = "round"; c.lineJoin = "round"
        c.beginPath()
        if (name === "close") { c.moveTo(6,6); c.lineTo(18,18); c.moveTo(18,6); c.lineTo(6,18) }
        else if (name === "chevron") { c.moveTo(6,9); c.lineTo(12,15); c.lineTo(18,9) }
        else if (name === "stop") { c.moveTo(6,6); c.lineTo(18,6); c.lineTo(18,18); c.lineTo(6,18); c.closePath() }
        else if (name === "point") { c.moveTo(6,18); c.lineTo(6,5); c.lineTo(17,12); c.lineTo(11,13); c.lineTo(9,19); c.closePath() }
        else if (name === "follow") { c.arc(12,12,6,0,Math.PI*2); c.moveTo(12,2); c.lineTo(12,5); c.moveTo(12,19); c.lineTo(12,22); c.moveTo(2,12); c.lineTo(5,12); c.moveTo(19,12); c.lineTo(22,12) }
        else if (name === "dock") { c.moveTo(4,14); c.lineTo(4,19); c.lineTo(20,19); c.lineTo(20,14); c.moveTo(12,4); c.lineTo(12,14); c.moveTo(8,10); c.lineTo(12,14); c.lineTo(16,10) }
        else if (name === "hide") { c.moveTo(3,3); c.lineTo(21,21); c.moveTo(4,9); c.quadraticCurveTo(12,2,21,12); c.quadraticCurveTo(18,16,15,17); c.moveTo(10,18); c.quadraticCurveTo(5,16,3,12) }
        else if (name === "talk") { c.moveTo(5,5); c.lineTo(19,5); c.quadraticCurveTo(21,5,21,7); c.lineTo(21,15); c.quadraticCurveTo(21,17,19,17); c.lineTo(10,17); c.lineTo(5,21); c.lineTo(5,17); c.quadraticCurveTo(3,17,3,15); c.lineTo(3,7); c.quadraticCurveTo(3,5,5,5) }
        else if (name === "notes") { c.moveTo(7,3); c.lineTo(17,3); c.lineTo(20,6); c.lineTo(20,21); c.lineTo(4,21); c.lineTo(4,3); c.closePath(); c.moveTo(8,10); c.lineTo(16,10); c.moveTo(8,14); c.lineTo(16,14); c.moveTo(8,18); c.lineTo(13,18) }
        c.stroke(); c.restore()
    }
}
