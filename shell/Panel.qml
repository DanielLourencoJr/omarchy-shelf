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
  manageIpc: false

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
  property bool cursorActive: false
  property string focusSection: "books"
  property int selectedBookIndex: 0
  property int selectedQuickIndex: 0
  property int selectedFooterIndex: 0
  property int selectedOfflineIndex: 0

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

  function open() {
    // Build the lazy content before KeyboardPanel observes `open`; otherwise
    // its built-in focus handoff can run while focusTarget is still null.
    panel.ensureContent()
    root.controller.show()
    root.refresh()
    Qt.callLater(function() {
      if (root.opened) root.focusSelectedControl()
    })
  }

  function focusSelectedControl() {
    var catcher = panel.loadedContent
    if (!catcher) return null
    // Keep Qt focus on the shared key catcher. Omarchy's panel key routing is
    // attached there; focusing a descendant button prevents it from seeing
    // navigation and Escape consistently. focusSelection moves the visible
    // cursor to the selected action so the user still starts on the first book.
    catcher.focusSelection()
    catcher.forceActiveFocus()
    return catcher
  }

  function close() {
    focusRetry.stop()
    root.controller.hide()
  }

  function toggle() {
    if (root.opened) root.close()
    else root.open()
  }

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

  function selectInitialControl() {
    root.cursorActive = true
    root.selectedBookIndex = 0
    root.selectedQuickIndex = 0
    root.selectedFooterIndex = 0
    root.selectedOfflineIndex = 0
    if (root.offlineMessage !== "" && root.activeBooks.length === 0) root.focusSection = "offline"
    else if (root.activeBooks.length > 0) root.focusSection = "books"
    else root.focusSection = "footer"
  }

  function moveCursor(dx, dy) {
    if (!root.cursorActive) {
      root.selectInitialControl()
      return
    }

    if (root.focusSection === "books") {
      if (dy !== 0) {
        var nextBook = root.selectedBookIndex + dy
        if (nextBook < 0) {
          if (root.offlineMessage !== "") root.focusSection = "offline"
          return
        }
        if (nextBook >= root.activeBooks.length) {
          root.focusSection = "footer"
          root.selectedFooterIndex = 0
          return
        }
        root.selectedBookIndex = nextBook
      } else if (dx !== 0) {
        root.selectedQuickIndex = Math.max(0, Math.min(2, root.selectedQuickIndex + dx))
      }
      return
    }

    if (root.focusSection === "offline") {
      if (dy > 0 && root.activeBooks.length > 0) root.focusSection = "books"
      else if (dx !== 0 || dy !== 0) root.selectedOfflineIndex = 1 - root.selectedOfflineIndex
      return
    }

    if (root.focusSection === "footer") {
      if (dy < 0 && root.activeBooks.length > 0) {
        root.focusSection = "books"
        root.selectedBookIndex = root.activeBooks.length - 1
      } else if (dy < 0 && root.offlineMessage !== "") {
        root.focusSection = "offline"
      } else if (dx !== 0) {
        root.selectedFooterIndex = 1 - root.selectedFooterIndex
      }
    }
  }

  function moveSection(direction) {
    if (direction < 0) {
      if (root.focusSection === "footer" && root.activeBooks.length > 0) {
        root.focusSection = "books"
        root.selectedBookIndex = root.activeBooks.length - 1
      } else if (root.focusSection === "books" && root.offlineMessage !== "") {
        root.focusSection = "offline"
      } else if (root.focusSection === "offline" && root.activeBooks.length > 0) {
        root.focusSection = "books"
        root.selectedBookIndex = 0
      } else {
        root.focusSection = "footer"
      }
    } else if (root.focusSection === "books") {
      root.focusSection = "footer"
      root.selectedFooterIndex = 0
    } else if (root.focusSection === "offline" && root.activeBooks.length > 0) {
      root.focusSection = "books"
      root.selectedBookIndex = 0
    } else if (root.focusSection === "footer" && root.offlineMessage !== "") {
      root.focusSection = "offline"
      root.selectedOfflineIndex = 0
    } else {
      root.focusSection = root.activeBooks.length > 0 ? "books" : "footer"
    }
  }

  function activateCursor() {
    if (!root.cursorActive) return
    if (root.focusSection === "books") {
      if (root.selectedBookIndex < 0 || root.selectedBookIndex >= root.activeBooks.length) return
      root.logPages(root.activeBooks[root.selectedBookIndex], [1, 5, 10][root.selectedQuickIndex])
    } else if (root.focusSection === "offline") {
      if (root.selectedOfflineIndex === 0) root.startServer()
      else root.openShelf("")
    } else if (root.selectedFooterIndex === 0) {
      root.openShelf("?add=1")
    } else {
      root.openShelf("")
    }
  }

  function openShelf(extra) {
    root.close()
    opener.command = ["omarchy", "launch", "browser", root.baseUrl + (extra || "")]
    opener.running = true
  }

  onOpenedChanged: {
    if (opened) {
      root.selectInitialControl()
      focusRetry.retries = 0
      focusRetry.restart()
      root.refresh()
      Qt.callLater(root.focusSelectedControl)
    } else {
      root.cursorActive = false
      focusRetry.stop()
    }
  }

  onActiveBooksChanged: {
    if (!root.opened) return
    if (root.activeBooks.length > 0 && root.focusSection === "footer") {
      root.focusSection = "books"
      root.selectedBookIndex = 0
    } else if (root.activeBooks.length === 0 && root.focusSection === "books") {
      root.focusSection = root.offlineMessage !== "" ? "offline" : "footer"
      root.selectedBookIndex = 0
    } else if (root.selectedBookIndex >= root.activeBooks.length) {
      root.selectedBookIndex = Math.max(0, root.activeBooks.length - 1)
    }
    Qt.callLater(root.focusSelectedControl)
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

  ShellIpc {
    target: root.ipcTarget
    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.toggle() }
  }

  Timer {
    interval: 90000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }

  Timer {
    id: focusRetry
    property int retries: 0
    interval: 100
    repeat: true
    onTriggered: {
      // KeyboardPanel temporarily holds compositor-wide Exclusive focus while
      // the layer surface is being mapped. Wait for its prime to finish before
      // deciding whether the selected control actually received focus.
      if (!root.opened || !panel.loadedContent || !panel.focusPrimed) return
      var target = root.focusSelectedControl()
      if (target && target.activeFocus) {
        stop()
        return
      }
      retries++
      if (retries >= 12) stop()
    }
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
    focusTarget: panel.loadedContent
    contentWidth: panel.fittedContentWidth(Style.space(430))
    contentHeight: panel.fittedContentHeight(panel.loadedContentHeight, Style.space(620))
    onLoadedContentChanged: {
      if (open && loadedContent) Qt.callLater(function() {
        if (panel.open) root.focusSelectedControl()
      })
    }
    onFocusPrimedChanged: {
      if (open && focusPrimed) Qt.callLater(function() {
        if (panel.open && panel.focusPrimed) root.focusSelectedControl()
      })
    }

    content: PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      implicitHeight: contentColumn.implicitHeight
      onMoveRequested: function(dx, dy) {
        root.moveCursor(dx, dy)
        Qt.callLater(root.focusSelectedControl)
      }
      onTabRequested: function(direction) {
        root.moveSection(direction)
        Qt.callLater(root.focusSelectedControl)
      }
      onActivateRequested: root.activateCursor()
      onCloseRequested: root.close()
      onTextKey: function(text) {
        if ((text === "a" || text === "A")) root.openShelf("?add=1")
        else if (text === "o" || text === "O") root.openShelf("")
        else if (text === "1" || text === "5" || text === "0") {
          if (root.activeBooks.length === 0) return
          root.focusSection = "books"
          root.cursorActive = true
          root.selectedQuickIndex = text === "1" ? 0 : (text === "5" ? 1 : 2)
        }
      }

      function revealItem(item) {
        var point = item.mapToItem(contentScroll.contentItem, 0, 0)
        if (point.y < contentScroll.contentY) contentScroll.contentY = point.y
        else if (point.y + item.height > contentScroll.contentY + contentScroll.height)
          contentScroll.contentY = point.y + item.height - contentScroll.height
      }

      function focusSelection() {
        var target = null
        if (root.focusSection === "books") {
          var row = bookRepeater.itemAt(root.selectedBookIndex)
          if (row && row.pageButtons) target = row.pageButtons.itemAt(root.selectedQuickIndex)
        } else if (root.focusSection === "offline") {
          target = root.selectedOfflineIndex === 0 ? startButton : offlineOpenButton
        } else {
          target = root.selectedFooterIndex === 0 ? addButton : openButton
        }
        if (target) revealItem(target)
        return target
      }

      Flickable {
        id: contentScroll
        anchors.fill: parent
        contentWidth: width
        contentHeight: contentColumn.implicitHeight
        clip: true
        interactive: false
        boundsBehavior: Flickable.StopAtBounds

        ColumnLayout {
          id: contentColumn
          width: contentScroll.width
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
              id: startButton
              text: strings.t("panel.start")
              selected: true
              hasCursor: root.cursorActive && root.focusSection === "offline" && root.selectedOfflineIndex === 0
              onHasCursorChanged: if (hasCursor) keyCatcher.revealItem(this)
              enabled: !root.busy
              onClicked: root.startServer()
            }
            Button {
              id: offlineOpenButton
              text: strings.t("panel.open")
              bordered: true
              hasCursor: root.cursorActive && root.focusSection === "offline" && root.selectedOfflineIndex === 1
              onHasCursorChanged: if (hasCursor) keyCatcher.revealItem(this)
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
        id: bookRepeater
        model: root.activeBooks

        delegate: Rectangle {
          id: bookRow
          property alias pageButtons: pageButtons
          required property var modelData
          required property int index

          readonly property var book: modelData
          readonly property real ratio: book.percent ? Math.max(0, Math.min(1, book.percent / 100)) : 0
          readonly property bool keyboardSelected: root.cursorActive && root.focusSection === "books" && root.selectedBookIndex === index

          Layout.fillWidth: true
          implicitHeight: Style.space(74)
          radius: Style.cornerRadius
          color: keyboardSelected ? Util.alpha(root.accent, 0.12) : Util.alpha(root.foreground, 0.035)
          border.width: keyboardSelected ? 1 : 0
          border.color: root.accent

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
                  id: pageButtons
                  model: [1, 5, 10]
                  delegate: Button {
                    required property var modelData
                    required property int index
                    text: "+" + modelData
                    fontSize: Style.font.caption
                    bordered: true
                    hasCursor: root.cursorActive && root.focusSection === "books" && root.selectedBookIndex === bookRow.index && root.selectedQuickIndex === index
                    onHasCursorChanged: if (hasCursor) keyCatcher.revealItem(this)
                    enabled: !root.busy
                    onClicked: {
                      root.cursorActive = true
                      root.focusSection = "books"
                      root.selectedBookIndex = bookRow.index
                      root.selectedQuickIndex = index
                      Qt.callLater(root.focusSelectedControl)
                      root.logPages(bookRow.book, modelData)
                    }
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

        Text {
          Layout.fillWidth: true
          textFormat: Text.PlainText
          text: strings.t("panel.keyboardHelp")
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          horizontalAlignment: Text.AlignHCenter
        }

        RowLayout {
          Layout.fillWidth: true
          spacing: Style.space(8)

          Button {
            id: addButton
            text: strings.t("panel.add")
            bordered: true
          hasCursor: root.cursorActive && root.focusSection === "footer" && root.selectedFooterIndex === 0
            onHasCursorChanged: if (hasCursor) keyCatcher.revealItem(this)
            onClicked: root.openShelf("?add=1")
          }

          Item { Layout.fillWidth: true }

          Button {
            id: openButton
            text: strings.t("panel.open")
            selected: true
            hasCursor: root.cursorActive && root.focusSection === "footer" && root.selectedFooterIndex === 1
            onHasCursorChanged: if (hasCursor) keyCatcher.revealItem(this)
            onClicked: root.openShelf("")
          }
        }
        }
      }
    }
  }
}
