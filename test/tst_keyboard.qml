import QtQuick
import QtTest
import "file:/usr/share/omarchy/shell/Ui" as OmarchyUi

TestCase {
  name: "ShelfKeyboard"
  when: windowShown
  width: 300
  height: 120

  property int bookIndex: 0
  property int amountIndex: 0
  property int activations: 0
  property int closes: 0

  OmarchyUi.PanelKeyCatcher {
    id: catcher
    anchors.fill: parent

    onMoveRequested: function(dx, dy) {
      if (dy !== 0) bookIndex = Math.max(0, Math.min(2, bookIndex + dy))
      else if (dx !== 0) amountIndex = Math.max(0, Math.min(2, amountIndex + dx))
    }
    onActivateRequested: activations++
    onCloseRequested: closes++
  }

  function init() {
    bookIndex = 0
    amountIndex = 0
    activations = 0
    closes = 0
    catcher.forceActiveFocus()
  }

  function test_opens_on_first_book_action() {
    compare(bookIndex, 0)
    compare(amountIndex, 0)
    verify(catcher.activeFocus)
  }

  function test_up_down_move_between_books() {
    keyClick(Qt.Key_Down)
    compare(bookIndex, 1)
    keyClick(Qt.Key_Down)
    compare(bookIndex, 2)
    keyClick(Qt.Key_Up)
    compare(bookIndex, 1)
    verify(catcher.activeFocus)
  }

  function test_left_right_choose_log_amount() {
    keyClick(Qt.Key_Right)
    compare(amountIndex, 1)
    keyClick(Qt.Key_Left)
    compare(amountIndex, 0)
  }

  function test_enter_activates_selected_action() {
    keyClick(Qt.Key_Return)
    compare(activations, 1)
  }

  function test_escape_closes_panel() {
    keyClick(Qt.Key_Escape)
    compare(closes, 1)
  }
}
