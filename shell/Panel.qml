import QtQuick
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Commons as Commons
import qs.Ui

// Shelf in the Omarchy bar: the ring shows how far you are through the book
// you are currently reading. Click it for covers, pace, and one-click pages.
Panel {
  id: root

  moduleName: "daniel.readingmanager"
  ipcTarget: "daniel.readingmanager"
  manageIpc: true

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  Commons.Translations {
    id: strings
    directory: Qt.resolvedUrl("i18n")
  }

  readonly property color foreground: bar ? bar.foreground : Commons.Color.foreground
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property color accent: Commons.Color.accent
  readonly property string cliPath: Quickshell.env("READING_CLI") || (Quickshell.env("HOME") + "/.local/bin/reading")
  readonly property string baseUrl: "http://127.0.0.1:8765"

  property var shelfData: null
  property string offlineMessage: ""
  property bool busy: false

  readonly property var activeBooks: {
    if (!root.shelfData || !root.shelfData.books) return []
    var out = []
    for (var i = 0; i < root.shelfData.books.length; i++) {
      if (root.shelfData.books[i].status === "active") out.push(root.shelfData.books[i])
    }
    return out
  }

  readonly property var focusBook: {
    if (!root.activeBooks.length) return null
    if (!root.shelfData || !root.shelfData.stats) return root.activeBooks[0]
    for (var i = 0; i < root.activeBooks.length; i++) {
      if (root.activeBooks[i].id === root.shelfData.stats.focusBookId) return root.activeBooks[i]
    }
    return root.activeBooks[0]
  }

  readonly property real progress: (root.focusBook && root.focusBook.percent) ? Math.max(0, Math.min(1, root.focusBook.percent / 100)) : 0
  readonly property bool resolved: root.shelfData !== null

  readonly property string tooltip: root.focusBook
    ? strings.t("bar.tooltip").arg(Math.round(root.progress * 100)).arg(root.focusBook.title)
    : strings.t("bar.tooltipEmpty")

  // ---- data ---------------------------------------------------------------

  function refresh() {
    if (stateCli.running) return
    stateCli.exec(["state", "--json"])
  }

  function applyState(stdoutText, stderrText, exitCode) {
    if (exitCode !== 0 || !String(stdoutText || "").trim()) {
      root.offlineMessage = String(stderrText || "").trim() || strings.t("panel.offline")
      return
    }
    try {
      root.shelfData = JSON.parse(stdoutText)
      root.offlineMessage = ""
    } catch (error) {
      root.offlineMessage = strings.t("panel.offline")
    }
  }

  function startServer() {
    if (startCli.running) return
    root.busy = true
    startCli.exec(["start"])
  }

  function logPages(book, pages) {
    if (logCli.running || !book) return
    root.busy = true
    logCli.exec(["log", String(book.id), String(pages)])
  }

  function openShelf(extra) {
    root.close()
    opener.command = ["omarchy", "launch", "browser", root.baseUrl + (extra || "")]
    opener.running = true
  }

  onOpenedChanged: {
    if (opened) root.refresh()
  }

  // ---- processes ----------------------------------------------------------

  Cli {
    id: stateCli
    program: root.cliPath
    onFinished: function (out, err, code) { root.applyState(out, err, code) }
  }

  Cli {
    id: startCli
    program: root.cliPath
    onFinished: function (out, err, code) {
      root.busy = false
      root.refresh()
    }
  }

  Cli {
    id: logCli
    program: root.cliPath
    onFinished: function (out, err, code) {
      root.busy = false
      root.refresh()
    }
  }

  Process {
    id: opener
    running: false
  }

  Timer {
    interval: 90000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }

  // ---- bar button ---------------------------------------------------------

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "\uf02d"
    tooltipText: root.tooltip
    onPressed: function (buttonCode) {
      if (buttonCode === Qt.RightButton) root.close()
      else root.toggle()
    }
  }

  Component {
    id: ringIcon

    Item {
      id: ringCanvas

      width: Style.bar.iconCanvas
      height: Style.bar.iconCanvas

      function trackColor() { return Util.alpha(root.foreground, 0.16) }
      function fillColor() { return root.progress > 0 ? root.accent : Util.alpha(root.foreground, 0.4) }

      Canvas {
        id: canvas
        anchors.fill: parent
        onPaint: {
          var ctx = getContext("2d")
          ctx.clearRect(0, 0, width, height)
          var size = Math.min(width, height)
          var center = size / 2
          var radius = center - 2.5
          var line = Math.max(1.5, size * 0.11)

          ctx.lineWidth = line
          ctx.lineCap = "round"

          ctx.strokeStyle = ringCanvas.trackColor()
          ctx.beginPath()
          ctx.arc(center, center, radius, 0, Math.PI * 2)
          ctx.stroke()

          if (root.progress > 0) {
            ctx.strokeStyle = ringCanvas.fillColor()
            ctx.beginPath()
            ctx.arc(center, center, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * root.progress)
            ctx.stroke()
          }
        }
      }

      Connections {
        target: root
        function onProgressChanged() { canvas.requestPaint() }
        function onForegroundChanged() { canvas.requestPaint() }
      }

      Component.onCompleted: canvas.requestPaint()
    }
  }

  // ---- panel --------------------------------------------------------------

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    contentWidth: panel.fittedContentWidth(Style.space(430))
    contentHeight: panel.fittedContentHeight(content.implicitHeight, Style.space(620))

    ColumnLayout {
      id: content
      anchors.top: parent.top
      anchors.left: parent.left
      anchors.right: parent.right
      spacing: Style.space(10)

      RowLayout {
        Layout.fillWidth: true
        spacing: Style.space(8)

        Text {
          textFormat: Text.PlainText
          text: strings.t("panel.title")
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          font.letterSpacing: 0.8
        }

        Item { Layout.fillWidth: true }

        Text {
          textFormat: Text.PlainText
          visible: root.shelfData !== null
          text: root.shelfData
            ? strings.t("panel.today").arg(root.shelfData.stats.todayPages).arg(root.shelfData.goal)
            : ""
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }

        Text {
          textFormat: Text.PlainText
          visible: root.shelfData !== null && root.shelfData.stats.streak > 0
          text: root.shelfData ? strings.t("panel.streak").arg(root.shelfData.stats.streak) : ""
          color: root.accent
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }
      }

      Rectangle {
        Layout.fillWidth: true
        implicitHeight: 1
        color: Util.alpha(root.foreground, 0.1)
      }

      // Offline / error state
      ColumnLayout {
        Layout.fillWidth: true
        visible: root.offlineMessage !== ""
        spacing: Style.space(8)

        Text {
          Layout.fillWidth: true
          textFormat: Text.PlainText
          text: root.offlineMessage
          wrapMode: Text.Wrap
          color: Commons.Color.urgent
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }

        RowLayout {
          spacing: Style.space(8)
          Button {
            text: strings.t("panel.start")
            selected: true
            enabled: !root.busy
            onClicked: root.startServer()
          }
          Button {
            text: strings.t("panel.open")
            bordered: true
            onClicked: root.openShelf("")
          }
        }
      }

      // Empty shelf
      Text {
        Layout.fillWidth: true
        visible: root.shelfData !== null && root.activeBooks.length === 0
        textFormat: Text.PlainText
        text: strings.t("panel.empty")
        wrapMode: Text.Wrap
        color: root.dim
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
      }

      // Books
      Repeater {
        model: root.activeBooks

        delegate: Rectangle {
          id: bookRow
          required property var modelData

          readonly property var book: modelData
          readonly property real ratio: book.percent ? Math.max(0, Math.min(1, book.percent / 100)) : 0

          Layout.fillWidth: true
          implicitHeight: Style.space(74)
          radius: Style.cornerRadius
          color: Util.alpha(root.foreground, 0.035)

          RowLayout {
            anchors.fill: parent
            anchors.margins: Style.space(8)
            spacing: Style.space(10)

            Rectangle {
              width: Style.space(38)
              height: Style.space(54)
              radius: Style.space(3)
              color: Util.alpha(root.foreground, 0.08)
              clip: true

              Image {
                anchors.fill: parent
                source: bookRow.book.coverPath ? "file://" + bookRow.book.coverPath : ""
                fillMode: Image.PreserveAspectCrop
                asynchronous: true
                cache: true
                visible: source !== ""
              }

              Text {
                anchors.centerIn: parent
                visible: !bookRow.book.coverPath
                textFormat: Text.PlainText
                text: bookRow.book.title ? bookRow.book.title.substring(0, 2).toUpperCase() : "?"
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
              }
            }

            ColumnLayout {
              Layout.fillWidth: true
              Layout.alignment: Qt.AlignVCenter
              spacing: Style.space(3)

              Text {
                Layout.fillWidth: true
                textFormat: Text.PlainText
                text: bookRow.book.title
                elide: Text.ElideRight
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                font.bold: true
              }

              Text {
                Layout.fillWidth: true
                textFormat: Text.PlainText
                text: {
                  if (!bookRow.book.totalPages) return bookRow.book.author || ""
                  var bits = []
                  if (bookRow.book.author) bits.push(bookRow.book.author)
                  bits.push(Math.round(bookRow.ratio * 100) + "% · " + bookRow.book.remaining + " left")
                  return bits.join(" · ")
                }
                elide: Text.ElideRight
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
              }

              Item {
                Layout.fillWidth: true
                implicitHeight: Style.space(4)

                Rectangle {
                  anchors.fill: parent
                  radius: height / 2
                  color: Util.alpha(root.foreground, 0.12)
                }

                Rectangle {
                  height: parent.height
                  radius: height / 2
                  width: parent.width * bookRow.ratio
                  color: bookRow.book.color || root.accent
                }
              }

              Text {
                Layout.fillWidth: true
                textFormat: Text.PlainText
                text: {
                  if (bookRow.book.todayPages > 0) return "+" + bookRow.book.todayPages + " today"
                  if (bookRow.book.slipping) return bookRow.book.daysSinceRead + " days since a page"
                  return bookRow.book.pace > 0 ? bookRow.book.pace + " pages/day" : "no reading logged yet"
                }
                elide: Text.ElideRight
                color: bookRow.book.todayPages > 0 ? root.accent : root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
              }
            }

            ColumnLayout {
              Layout.alignment: Qt.AlignVCenter
              spacing: Style.space(4)

              RowLayout {
                spacing: Style.space(4)
                Repeater {
                  model: [1, 5, 10]
                  delegate: Button {
                    required property var modelData
                    text: "+" + modelData
                    fontSize: Style.font.caption
                    bordered: true
                    enabled: !root.busy
                    onClicked: root.logPages(bookRow.book, modelData)
                  }
                }
              }

              Text {
                Layout.alignment: Qt.AlignHCenter
                textFormat: Text.PlainText
                text: "p. " + bookRow.book.currentPage + "/" + bookRow.book.totalPages
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
              }
            }
          }
        }
      }

      Rectangle {
        Layout.fillWidth: true
        implicitHeight: 1
        color: Util.alpha(root.foreground, 0.1)
      }

      RowLayout {
        Layout.fillWidth: true
        spacing: Style.space(8)

        Button {
          text: strings.t("panel.add")
          bordered: true
          onClicked: root.openShelf("?add=1")
        }

        Item { Layout.fillWidth: true }

        Button {
          text: strings.t("panel.open")
          selected: true
          onClicked: root.openShelf("")
        }
      }
    }
  }
}
