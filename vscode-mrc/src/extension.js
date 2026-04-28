const vscode = require('vscode')
const { MrcPanel } = require('./panel')

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('mrc.openChat', () => {
      MrcPanel.createOrShow(context)
    }),
    vscode.commands.registerCommand('mrc.sendSelection', () => {
      const editor = vscode.window.activeTextEditor
      if (!editor || editor.selection.isEmpty) {
        vscode.window.showWarningMessage('No text selected')
        return
      }
      const text = editor.document.getText(editor.selection)
      const file = vscode.workspace.asRelativePath(editor.document.uri)
      const lang = editor.document.languageId
      const panel = MrcPanel.createOrShow(context)
      panel.sendContext({ text, file, lang })
    }),
    vscode.commands.registerCommand('mrc.pickSession', () => {
      MrcPanel.pickSession(context)
    })
  )
}

function deactivate() {
  MrcPanel.dispose()
}

module.exports = { activate, deactivate }
