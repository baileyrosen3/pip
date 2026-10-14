import QtQuick
import Quickshell
import Quickshell.Io

// The shell owns this non-visual service. Never detach the server: unloading
// the plugin must stop only the process that this instance started.
Scope {
  id: root

  property var shell: null
  property var manifest: null
  property string omarchyPath: Quickshell.env("OMARCHY_PATH")

  readonly property string pluginDir: decodeURIComponent(
    String(Qt.resolvedUrl(".")).replace(/^file:\/\//, ""))
  readonly property string runtimeDir: Quickshell.env("XDG_RUNTIME_DIR")
    || ("/tmp/pip-shell-" + Quickshell.env("USER"))
  readonly property string socketPath: Quickshell.env("PIPCTL_SHELL_SOCKET")
    || (runtimeDir + "/pip/shell.sock")
  readonly property string logDirectory: (Quickshell.env("XDG_STATE_HOME")
    || (Quickshell.env("HOME") + "/.local/state")) + "/pip"

  property bool destroying: false
  property bool probing: false
  property bool launching: false
  property bool externalListener: false
  property int restartDelay: 1000
  readonly property int maximumRestartDelay: 30000
  readonly property bool supervised: serverProcess.running

  // Connecting distinguishes a live systemd-owned listener from a stale path.
  // Unknown failures (permissions, timeouts, etc.) must not authorize a spawn.
  readonly property string probeScript: [
    "import errno, socket, sys",
    "try:",
    "    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:",
    "        client.settimeout(0.5)",
    "        client.connect(sys.argv[1])",
    "except OSError as error:",
    "    if error.errno in (errno.ENOENT, errno.ECONNREFUSED):",
    "        sys.exit(1)",
    "    print('Pip listener probe: ' + str(error), file=sys.stderr)",
    "    sys.exit(2)",
    "sys.exit(0)"
  ].join("\n")

  function probe() {
    if (destroying || probing || launching || probeProcess.running || serverProcess.running) return
    retryTimer.stop()
    probing = true
    probeProcess.running = true
  }

  function retry() {
    if (destroying) return
    retryTimer.interval = restartDelay
    restartDelay = Math.min(maximumRestartDelay, restartDelay * 2)
    retryTimer.restart()
  }

  function launch() {
    if (destroying || probing || launching || probeProcess.running || serverProcess.running) return
    externalListener = false
    launching = true
    serverProcess.running = true
  }

  Component.onCompleted: retryTimer.start()
  Component.onDestruction: {
    destroying = true
    retryTimer.stop()
    stableTimer.stop()
    probeProcess.running = false
    // Process.running = false sends SIGTERM. Quickshell also owns the process
    // lifetime, so it cannot survive destruction as a detached child would.
    serverProcess.running = false
  }

  Timer {
    id: retryTimer
    interval: 1
    repeat: false
    onTriggered: root.probe()
  }

  Timer {
    id: stableTimer
    interval: 30000
    repeat: false
    onTriggered: {
      if (serverProcess.running) root.restartDelay = 1000
    }
  }

  Process {
    id: probeProcess
    command: ["python3", "-c", root.probeScript, root.socketPath]
    clearEnvironment: false
    stderr: SplitParser {
      onRead: function(line) { console.warn(String(line)) }
    }
    onExited: function(exitCode, exitStatus) {
      root.probing = false
      if (root.destroying) return
      if (exitStatus === 0 && exitCode === 0) {
        root.externalListener = true
        root.restartDelay = 1000
        // Keep checking so the shell can take over if the external owner stops.
        retryTimer.interval = 5000
        retryTimer.restart()
      } else if (exitStatus === 0 && exitCode === 1) {
        root.externalListener = false
        root.launch()
      } else {
        console.warn("Pip listener probe failed; deferring server launch (exit " + exitCode + ")")
        root.retry()
      }
    }
  }

  Process {
    id: serverProcess
    workingDirectory: root.pluginDir
    // Leave the inherited environment intact, including every PIPCTL_* value.
    // Supplying the resolved socket also keeps the no-XDG fallback consistent.
    clearEnvironment: false
    environment: ({ PIPCTL_SHELL_SOCKET: root.socketPath })
    command: [
      "sh", "-c",
      "umask 077\nmkdir -p -- \"$1\" || exit\nexec bun server/main.ts >> \"$1/server.log\" 2>&1",
      "pip-supervisor", root.logDirectory
    ]
    stderr: SplitParser {
      onRead: function(line) { console.warn("Pip supervisor: " + String(line)) }
    }
    onStarted: {
      root.launching = false
      stableTimer.restart()
    }
    onExited: function(exitCode) {
      root.launching = false
      stableTimer.stop()
      if (root.destroying) return
      console.warn("Pip server exited (" + exitCode + "); retrying after listener probe")
      root.retry()
    }
  }
}
