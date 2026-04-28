const vscode = require('vscode')
const { spawn, execFileSync, execFile } = require('child_process')
const { readFileSync, writeFileSync, readdirSync, realpathSync, existsSync, mkdirSync } = require('fs')
const path = require('path')

class MrcPanel {
  static _instance

  static createOrShow(context) {
    if (MrcPanel._instance) {
      MrcPanel._instance._panel.reveal()
      return MrcPanel._instance
    }
    const panel = vscode.window.createWebviewPanel(
      'mrcChat', 'Mr. Claude', vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    )
    MrcPanel._instance = new MrcPanel(panel, context)
    return MrcPanel._instance
  }

  static dispose() {
    if (MrcPanel._instance) MrcPanel._instance._dispose()
  }

  static pickSession(context) {
    const inst = MrcPanel._instance
    if (!inst) return MrcPanel.createOrShow(context)
    inst._showSessionPicker()
    return inst
  }

  constructor(panel, context) {
    this._panel = panel
    this._context = context
    this._containerId = null
    this._process = null
    this._sessionId = null
    this._sessionName = null
    this._thinkingStart = 0
    this._thinkingDuration = 0
    this._inputTokens = 0
    this._outputTokens = 0
    this._toolInput = ''
    this._toolName = ''
    this._blockType = null
    this._sendGen = 0

    const nonce = getNonce()
    const htmlPath = path.join(context.extensionPath, 'src', 'webview.html')
    const realDir = realpathSync(context.extensionPath)
    const avatarPath = path.join(realDir, 'mrc.png')
    const avatarUri = existsSync(avatarPath) ? 'data:image/png;base64,' + readFileSync(avatarPath).toString('base64') : ''
    this._panel.webview.html = readFileSync(htmlPath, 'utf8')
      .replace(/\{\{NONCE\}\}/g, nonce)
      .replace(/\{\{AVATAR_URI\}\}/g, avatarUri)
    this._panel.webview.onDidReceiveMessage(msg => this._onMessage(msg), null, context.subscriptions)
    this._panel.onDidDispose(() => this._dispose(), null, context.subscriptions)

    this._startDaemon()
  }

  sendContext({ text, file, lang }) {
    this._post({ type: 'setContext', text: `From \`${file}\`:\n\`\`\`${lang}\n${text}\n\`\`\`` })
  }

  _mrcPath() {
    const configured = vscode.workspace.getConfiguration('mrc').get('executablePath')
    if (configured) return configured
    const realDir = realpathSync(this._context.extensionPath)
    return path.join(realDir, '..', 'mrc.js')
  }

  _workspacePath() {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || null
  }

  _mrcDir() {
    const ws = this._workspacePath()
    return ws ? path.join(ws, '.mrc') : null
  }

  _updateTitle() {
    const name = this._sessionName || 'Mr. Claude'
    this._panel.title = name
  }

  async _startDaemon() {
    const cwd = this._workspacePath()
    if (!cwd) {
      this._post({ type: 'error', text: 'Open a folder first' })
      return
    }

    this._post({ type: 'status', text: 'Starting container' })

    const mrc = this._mrcPath()
    const extraArgs = vscode.workspace.getConfiguration('mrc').get('extraArgs', [])
    const args = ['--daemon', ...extraArgs, cwd]
    const cmd = mrc.endsWith('.js') ? process.execPath : mrc
    const spawnArgs = mrc.endsWith('.js') ? [mrc, ...args] : args

    try {
      const containerId = await new Promise((resolve, reject) => {
        execFile(cmd, spawnArgs, { timeout: 120000 }, (err, stdout, stderr) => {
          if (err) return reject(new Error(stderr || err.message))
          const id = stdout.trim().split('\n').pop()
          if (!id) return reject(new Error('No container ID returned'))
          resolve(id)
        })
      })

      this._containerId = containerId
      this._post({ type: 'status', text: '' })
      this._post({ type: 'ready' })
      await this._showStartupPicker()
    } catch (e) {
      this._post({ type: 'error', text: 'Failed to start: ' + e.message })
    }
  }

  _loadSessionName() {
    const mrcDir = this._mrcDir()
    if (!mrcDir) return
    const names = loadNames(mrcDir)
    const sessions = getSessions(mrcDir)
    if (sessions.length > 0) {
      const latest = sessions[0]
      this._sessionId = latest.uuid
      this._sessionName = names[latest.uuid] || null
      this._updateTitle()
    }
  }

  _loadSessionHistory() {
    const mrcDir = this._mrcDir()
    if (!mrcDir || !this._sessionId) return
    const file = path.join(mrcDir, this._sessionId + '.jsonl')
    let raw
    try { raw = readFileSync(file, 'utf8') } catch { return }
    const messages = []
    let lastUsage = null
    for (const line of raw.split('\n')) {
      if (!line) continue
      let obj
      try { obj = JSON.parse(line) } catch { continue }
      if (obj.type === 'result' && obj.usage) {
        lastUsage = obj.usage
      }
      if (obj.type === 'user') {
        let content = obj.message?.content
        if (Array.isArray(content)) content = content.filter(c => c.type === 'text').map(c => c.text).join('\n')
        else if (typeof content !== 'string') continue
        if (content) messages.push({ role: 'user', text: content })
      } else if (obj.type === 'assistant') {
        const content = obj.message?.content
        if (!Array.isArray(content)) continue
        let text = ''
        for (const block of content) {
          if (block.type === 'text') text += block.text
        }
        if (text) messages.push({ role: 'assistant', text })
      }
    }
    if (messages.length > 0) {
      this._post({ type: 'history', messages: messages.slice(-20) })
    }
    if (lastUsage) {
      this._inputTokens = lastUsage.input_tokens || 0
      this._outputTokens = lastUsage.output_tokens || 0
    } else if (messages.length > 0) {
      let chars = 0
      for (const m of messages) chars += (m.text || '').length
      this._inputTokens = Math.round(chars / 4)
    }
    if (this._inputTokens > 0) {
      this._post({ type: 'usage', input: this._inputTokens, output: this._outputTokens })
    }
  }

  async _showStartupPicker() {
    const mrcDir = this._mrcDir()
    if (!mrcDir) return

    const sessions = getSessions(mrcDir)
    if (sessions.length === 0) return

    const names = loadNames(mrcDir)
    const items = [
      ...sessions.map(s => ({
        label: names[s.uuid] || s.preview || '(empty)',
        description: formatAge(s.lastUpdated),
        detail: names[s.uuid] ? s.preview : undefined,
        uuid: s.uuid,
      })),
      { label: '$(add) New Session', uuid: '__NEW__' },
    ]

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Pick a session (most recent first)',
    })

    if (picked && picked.uuid === '__NEW__') {
      this._sessionId = null
      this._sessionName = null
      this._updateTitle()
      return
    }

    const uuid = picked ? picked.uuid : sessions[0].uuid
    this._sessionId = uuid
    this._sessionName = names[uuid] || null
    this._updateTitle()
    this._loadSessionHistory()
  }

  _onMessage(msg) {
    if (msg.type === 'send') this._send(msg.text)
    else if (msg.type === 'cancel') this._kill()
    else if (msg.type === 'pasteImage') this._saveImage(msg.data)
  }

  _saveImage(base64) {
    const ws = this._workspacePath()
    if (!ws) return
    const dir = path.join(ws, '.mrc', 'pastes')
    try { mkdirSync(dir, { recursive: true }) } catch {}
    const name = 'paste-' + Date.now() + '.png'
    writeFileSync(path.join(dir, name), Buffer.from(base64, 'base64'))
    this._post({ type: 'imageSaved', path: '/workspace/.mrc/pastes/' + name })
  }

  _send(text) {
    if (!this._containerId) return

    if (this._process) {
      this._process.kill('SIGTERM')
      this._process = null
      this._post({ type: 'done' })
    }

    const gen = ++this._sendGen

    this._thinkingStart = 0
    this._thinkingDuration = 0
    this._inputTokens = 0
    this._outputTokens = 0
    this._toolInput = ''
    this._toolName = ''
    this._blockType = null

    this._post({ type: 'userMessage', text })
    this._post({ type: 'status', text: 'Thinking' })

    const resumeFlag = this._sessionId ? ['--resume', this._sessionId] : ['--continue']

    this._process = spawn('docker', [
      'exec', this._containerId,
      'stdbuf', '-oL',
      'claude', '--dangerously-skip-permissions',
      ...resumeFlag,
      '--output-format', 'stream-json', '--verbose',
      '-p', text,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })

    let buf = ''
    let stderrBuf = ''
    let started = false

    this._process.stdout.on('data', chunk => {
      if (gen !== this._sendGen) return
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop()
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const ev = JSON.parse(line)
          if (!started) {
            started = true
            this._post({ type: 'assistantStart' })
          }
          this._handleEvent(ev)
        } catch {}
      }
    })

    this._process.stderr.on('data', chunk => {
      if (gen !== this._sendGen) return
      stderrBuf += chunk.toString()
    })

    this._process.on('close', code => {
      if (gen !== this._sendGen) return
      this._process = null
      this._post({ type: 'status', text: '' })
      if (!started && stderrBuf.trim()) {
        this._post({ type: 'error', text: stderrBuf.trim().slice(-500) })
      }
      this._post({ type: 'done' })
      this._loadSessionName()
    })

    this._process.on('error', err => {
      if (gen !== this._sendGen) return
      this._process = null
      this._post({ type: 'error', text: err.message })
    })
  }

  _handleEvent(ev) {
    const inner = ev.type === 'stream_event' ? ev.event : null

    // Streaming API events (if Claude Code ever sends them)
    if (inner) {
      if (inner.type === 'content_block_delta') {
        if (inner.delta?.type === 'text_delta') {
          this._post({ type: 'textDelta', text: inner.delta.text })
        } else if (inner.delta?.type === 'thinking_delta' && inner.delta.thinking) {
          const preview = inner.delta.thinking.trim().split('\n').pop()
          if (preview) this._post({ type: 'status', text: preview.slice(0, 80) })
        } else if (inner.delta?.type === 'input_json_delta') {
          this._toolInput += inner.delta.partial_json || ''
        }
      } else if (inner.type === 'content_block_start') {
        this._blockType = inner.content_block?.type
        if (inner.content_block?.type === 'tool_use') {
          this._toolName = inner.content_block.name
          this._toolInput = ''
          this._post({ type: 'status', text: inner.content_block.name })
          this._post({ type: 'toolUse', name: inner.content_block.name })
        } else if (inner.content_block?.type === 'thinking') {
          this._thinkingStart = Date.now()
          this._post({ type: 'status', text: 'Thinking' })
        }
      } else if (inner.type === 'content_block_stop') {
        if (this._blockType === 'thinking' && this._thinkingStart) {
          this._thinkingDuration += Math.round((Date.now() - this._thinkingStart) / 1000)
          this._thinkingStart = 0
          this._postStats()
        }
        if (this._blockType === 'tool_use' && this._toolName) {
          this._postToolDetail()
          this._toolName = ''
          this._toolInput = ''
        }
        this._blockType = null
      } else if (inner.type === 'message_start' && inner.message?.usage) {
        this._inputTokens = inner.message.usage.input_tokens || 0
        this._postStats()
      } else if (inner.type === 'message_delta' && inner.usage) {
        this._outputTokens += inner.usage.output_tokens || 0
        this._post({ type: 'usage', input: this._inputTokens, output: this._outputTokens })
        this._postStats()
      }
      return
    }

    // Message-level events (what -p mode actually emits)
    if (ev.type === 'assistant' && ev.message?.content) {
      for (const block of ev.message.content) {
        if (block.type === 'text') {
          this._post({ type: 'textDelta', text: block.text })
        } else if (block.type === 'thinking' && block.thinking) {
          const lines = block.thinking.trim().split('\n')
          const preview = lines[lines.length - 1]
          if (preview) this._post({ type: 'status', text: preview.slice(0, 80) })
        } else if (block.type === 'tool_use') {
          const name = block.name
          this._post({ type: 'toolUse', name })
          let detail = name
          const inp = block.input || {}
          if (inp.file_path) detail += ' ' + inp.file_path.replace(/^\/workspace\//, '')
          else if (inp.command) detail += ' ' + inp.command.split('\n')[0].slice(0, 60)
          else if (inp.query) detail += ' ' + inp.query.slice(0, 60)
          else if (inp.pattern) detail += ' ' + inp.pattern.slice(0, 60)
          this._post({ type: 'toolDetail', name, detail })
          this._post({ type: 'status', text: name })
        }
      }
      if (ev.message?.usage) {
        this._inputTokens = ev.message.usage.input_tokens || this._inputTokens
        this._outputTokens += ev.message.usage.output_tokens || 0
        this._post({ type: 'usage', input: this._inputTokens, output: this._outputTokens })
        this._postStats()
      }
    }

    if (ev.type === 'user') {
      this._post({ type: 'status', text: 'Running tool' })
    }

    if (ev.type === 'result') {
      if (ev.session_id) this._sessionId = ev.session_id
      if (ev.usage) {
        this._inputTokens = ev.usage.input_tokens || this._inputTokens
        this._outputTokens = ev.usage.output_tokens || this._outputTokens
        this._post({ type: 'usage', input: this._inputTokens, output: this._outputTokens })
      }
      this._post({
        type: 'result',
        sessionId: ev.session_id,
        cost: ev.total_cost_usd ?? ev.cost_usd,
        usage: ev.usage,
      })
      this._postStats()
    }

    if (ev.type === 'system' && ev.subtype === 'init') {
      if (ev.session_id) this._sessionId = ev.session_id
      if (ev.model) this._post({ type: 'model', model: ev.model })
    }
  }

  _postStats() {
    this._post({
      type: 'stats',
      thinkingDuration: this._thinkingDuration,
      inputTokens: this._inputTokens,
      outputTokens: this._outputTokens,
    })
  }

  _postToolDetail() {
    let detail = this._toolName
    try {
      const input = JSON.parse(this._toolInput)
      if (input.file_path) detail += ' ' + input.file_path.replace(/^\/workspace\//, '')
      else if (input.command) detail += ' ' + input.command.split('\n')[0].slice(0, 60)
      else if (input.query) detail += ' ' + input.query.slice(0, 60)
      else if (input.pattern) detail += ' ' + input.pattern.slice(0, 60)
    } catch {}
    this._post({ type: 'toolDetail', name: this._toolName, detail })
  }

  async _showSessionPicker() {
    const mrcDir = this._mrcDir()
    if (!mrcDir) return

    const sessions = getSessions(mrcDir)
    const names = loadNames(mrcDir)

    const items = [
      { label: '$(add) New Session', uuid: '__NEW__' },
      ...sessions.map((s, i) => {
        const name = names[s.uuid]
        const age = formatAge(s.lastUpdated)
        return {
          label: name || s.preview || '(empty)',
          description: age,
          detail: name ? s.preview : undefined,
          uuid: s.uuid,
        }
      })
    ]

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Pick a session to resume',
    })
    if (!picked) return

    if (picked.uuid === '__NEW__') {
      this._sessionId = null
      this._sessionName = null
      this._updateTitle()
      this._post({ type: 'clear' })
    } else {
      this._sessionId = picked.uuid
      this._sessionName = names[picked.uuid] || null
      this._updateTitle()
      this._post({ type: 'clear' })
      this._loadSessionHistory()
    }
  }

  _kill() {
    if (this._process) {
      this._process.kill('SIGTERM')
      this._process = null
    }
  }

  _post(msg) {
    this._panel.webview.postMessage(msg)
  }

  _dispose() {
    this._kill()
    if (this._containerId) {
      try { execFileSync('docker', ['rm', '-f', this._containerId], { stdio: 'ignore' }) } catch {}
      this._containerId = null
    }
    MrcPanel._instance = null
  }
}

// --- Session helpers (duplicated from src/sessions/manager.js for CJS compat) ---

function getSessions(mrcDir) {
  const sessions = []
  let files
  try { files = readdirSync(mrcDir).filter(f => f.endsWith('.jsonl')) } catch { return [] }
  for (const file of files) {
    const uuid = path.basename(file, '.jsonl')
    let preview = '', lastTs = ''
    try {
      const raw = readFileSync(path.join(mrcDir, file), 'utf8')
      for (const line of raw.split('\n')) {
        if (!line) continue
        let obj
        try { obj = JSON.parse(line) } catch { continue }
        if (obj.timestamp) lastTs = obj.timestamp
        if (!preview && obj.type === 'user') {
          let content = obj.message?.content || ''
          if (Array.isArray(content)) content = content.find(c => c.type === 'text')?.text || ''
          preview = content.slice(0, 60).replace(/\n/g, ' ')
          if (content.length > 60) preview += '...'
        }
      }
      if (lastTs) sessions.push({ uuid, lastUpdated: lastTs, preview })
    } catch {}
  }
  sessions.sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated))
  return sessions
}

function loadNames(mrcDir) {
  const names = {}
  const file = path.join(mrcDir, 'session-names')
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const eq = line.indexOf('=')
      if (eq > 0) names[line.slice(0, eq)] = line.slice(eq + 1)
    }
  } catch {}
  return names
}

function formatAge(ts) {
  try {
    const ms = Date.now() - new Date(ts).getTime()
    if (ms < 60000) return 'just now'
    if (ms < 3600000) return Math.floor(ms / 60000) + 'm ago'
    if (ms < 86400000) return Math.floor(ms / 3600000) + 'h ago'
    return Math.floor(ms / 86400000) + 'd ago'
  } catch { return '' }
}

function getNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let n = ''
  for (let i = 0; i < 32; i++) n += chars[Math.floor(Math.random() * chars.length)]
  return n
}

module.exports = { MrcPanel }
