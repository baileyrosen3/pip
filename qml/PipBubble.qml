import QtQuick

PipGlass {
    id: root
    property string text: ""
    property string shownText: ""
    property real now: 0
    property real born: 0
    property real visibility: 0
    property real pop: .92
    property real availableWidth: PipTheme.tokens.bubble.maxWidth
    property real availableHeight: 10000
    readonly property bool overflowing: words.implicitHeight > viewport.height
    Accessible.role: Accessible.StaticText
    Accessible.name: shownText
    radius:20
    width: Math.max(1,Math.min(availableWidth,PipTheme.tokens.bubble.maxWidth,Math.max(72,Math.sqrt(shownText.length)*32)+32))
    height:Math.min(availableHeight,words.implicitHeight+24)
    opacity:visibility
    scale:pop
    visible:opacity>.001 && PipTheme.ready
    transformOrigin:Item.Center
    Behavior on pop { SpringAnimation { spring:PipTheme.tokens.spring.bubble.stiffness/100; damping:PipTheme.tokens.spring.bubble.damping; mass:1 } }
    Behavior on visibility { NumberAnimation { duration:PipTheme.tokens.bubble.exitMs; easing.type:Easing.OutCubic } }
    onTextChanged: {
        if (text) {
            clearWords.stop()
            if (text.indexOf(shownText) !== 0) viewport.contentY=0
            shownText=text
            var old=wordModel.count,index=0,items=text.split(/\s+/).filter(w=>w.length)
            while(index<old && index<items.length && wordModel.get(index).word === items[index]) index++
            if(index<old) wordModel.remove(index,old-index)
            for(var i=index;i<items.length;i++) wordModel.append({word:items[i],start:now+(i-index)*PipTheme.tokens.bubble.wordStaggerMs/1000})
            if(!visibility) { born=now; pop=.92; pop=1 }
            visibility=1
        } else { visibility=0; pop=.96; clearWords.restart() }
    }
    ListModel { id:wordModel }
    Timer { id:clearWords; interval:PipTheme.tokens.bubble.exitMs; onTriggered:if(!root.text) wordModel.clear() }
    Flickable {
        id:viewport
        x:16; y:10; width:Math.max(1,parent.width-32); height:Math.max(1,parent.height-20)
        contentWidth:width; contentHeight:words.implicitHeight+4
        clip:true; boundsBehavior:Flickable.StopAtBounds
        interactive:root.overflowing
        Flow {
            id:words
            width:viewport.width; spacing:4
            Repeater {
                model:wordModel
                Text {
                    required property string word
                    required property real start
                    readonly property real fade:Math.max(0,Math.min(1,(root.now-start)/(PipTheme.tokens.bubble.wordFadeMs/1000)))
                    width:Math.min(implicitWidth,words.width)
                    text:word; textFormat:Text.PlainText; wrapMode:Text.Wrap
                    color:PipTheme.primary; font.family:PipTheme.voiceFont.name; font.pixelSize:PipTheme.tokens.font.voice.bubble; font.weight:Font.DemiBold
                    opacity:fade
                    transform:Translate { y:4*(1-fade) }
                }
            }
        }
    }
    Rectangle {
        visible:root.overflowing; anchors.right:parent.right; anchors.rightMargin:5
        width:3; radius:2; color:PipTheme.tertiary
        height:Math.max(16,viewport.height*viewport.height/Math.max(viewport.height,viewport.contentHeight))
        y:10+Math.max(0,viewport.contentY)/Math.max(1,viewport.contentHeight-viewport.height)*(viewport.height-height)
    }
}
