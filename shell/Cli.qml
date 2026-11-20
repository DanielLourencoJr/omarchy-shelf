import QtQuick
import Quickshell
import Quickshell.Io

// One short-lived `reading` CLI run. Each consumer owns its own instance so a
// page-log never queues behind a background state refresh.
Item {
  id: root

  property string program: "reading"
  property int startTimeoutMs: 6000
  signal finished(string stdoutText, string stderrText, int exitCode)

  readonly property bool running: proc.running

  property bool _delivered: false

  function exec(args) {
    root._delivered = false
    proc.command = [root.program].concat(args)
    proc.running = true
    watchdog.restart()
  }

  function deliver(stdoutText, stderrText, exitCode) {
    if (root._delivered) return
    root._delivered = true
    watchdog.stop()
    root.finished(stdoutText, stderrText, exitCode)
  }

  Timer {
    id: watchdog
    interval: root.startTimeoutMs
    onTriggered: {
      if (root._delivered || proc.running) return
      root.deliver("", "reading is not installed or not on PATH.", 127)
    }
  }

  Process {
    id: proc
    stdout: StdioCollector {
      id: out
      waitForEnd: true
    }
    stderr: StdioCollector {
      id: err
      waitForEnd: true
    }
    onStarted: watchdog.stop()
    onExited: function (exitCode) { root.deliver(out.text, err.text, exitCode) }
  }
}
