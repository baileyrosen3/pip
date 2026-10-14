pragma Singleton
import QtQuick
import Quickshell.Io

QtObject {
    id: root
    property var theme: ({background:"#1a1b26",foreground:"#c0caf5",accent:"#7aa2f7",mode:"dark"})
    readonly property color background: theme.background
    // Exact initial mirror avoids undefined bindings before FileView's first load.
    // The watched JSON replaces this snapshot and remains authoritative.
    property var tokens: ({
        surface: {
            dark: {ink:"rgba(16,17,23,0.93)",hairline:"rgba(255,255,255,0.08)",topHighlight:"rgba(255,255,255,0.06)",fg:"#f3f4f8"},
            light: {ink:"rgba(250,250,252,0.95)",hairline:"rgba(0,0,0,0.06)",topHighlight:"rgba(255,255,255,0.7)",fg:"#14151b"}
        },
        text:{primary:.92,secondary:.64,tertiary:.44},
        shadow:[{y:1,blur:2,color:"rgba(0,0,0,0.25)"},{y:8,blur:24,color:"rgba(0,0,0,0.28)"},{y:24,blur:64,color:"rgba(0,0,0,0.22)"}],
        radius:{card:22,panel:16,bubble:16,control:12,pill:999},
        space:{unit:4,xs:8,s:12,m:16,l:20,xl:24},
        font:{voice:{family:"Fredoka",weight:600,bubble:16,title:24},ui:{family:"IBM Plex Sans",weight:400,labelWeight:500,size:14,lineHeight:1.45},mono:{family:"IBM Plex Mono",size:11.5,opacity:.6}},
        bubble:{maxWidth:340,wordStaggerMs:40,wordFadeMs:160,enterScale:.92,exitMs:140},
        card:{width:420},
        control:{rowHeight:44,toggle:{w:36,h:22},buttonHeight:40,sliderTrack:4,sliderThumb:18,iconStroke:1.75},
        trail:{historyMs:140,alpha:.14,sparkles:[3,6]},
        spring:{default:{stiffness:420,damping:.8},quick:{stiffness:600,damping:.9},gentle:{stiffness:220,damping:.75},bubble:{stiffness:520,damping:.72}}
    })
    readonly property bool dark: theme.mode ? theme.mode !== "light" : background.r*.2126+background.g*.7152+background.b*.0722 < .5
    readonly property var surface: tokens.surface ? tokens.surface[dark ? "dark" : "light"] : ({})
    readonly property color accent: theme.accent
    readonly property color ink: alpha(background,.96)
    readonly property color hairline: css(surface.hairline || "transparent")
    readonly property color topHighlight: css(surface.topHighlight || "transparent")
    readonly property color foreground: theme.foreground
    readonly property color primary: alpha(foreground,tokens.text ? tokens.text.primary : 0)
    readonly property color secondary: alpha(foreground,tokens.text ? tokens.text.secondary : 0)
    readonly property color tertiary: alpha(foreground,tokens.text ? tokens.text.tertiary : 0)
    readonly property bool ready: !!tokens.surface
    property var tokenFile: FileView {
        path: Qt.resolvedUrl("../design/tokens.json")
        watchChanges: true
        onLoaded: { try { root.tokens=JSON.parse(text()) } catch(e) { console.error("Pip design tokens:",e) } }
        onFileChanged: reload()
    }
    property var voiceFont: FontLoader { source: Qt.resolvedUrl("../fonts/Fredoka.ttf") }
    property var uiFont: FontLoader { source: Qt.resolvedUrl("../fonts/IBMPlexSans.ttf") }
    property var monoFont: FontLoader { source: Qt.resolvedUrl("../fonts/IBMPlexMono-Regular.ttf") }
    function alpha(c,a) { return Qt.rgba(c.r,c.g,c.b,a) }
    function css(value) {
        var m=String(value).match(/^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/)
        return m ? Qt.rgba(Number(m[1])/255,Number(m[2])/255,Number(m[3])/255,Number(m[4])) : value
    }
}
