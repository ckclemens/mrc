#!/usr/bin/env node
//
// notify-proxy.js — Host-side notification proxy for mrc containers.
//
// Protocol (from container):
//   Line 1: repo name (used in title)
//   Line 2: summary (notification body)
//
import { createServer } from 'node:net'
import { execFile } from 'node:child_process'
import { log } from '../output.js'

const PREFIX = 'notify-proxy'
const platform = process.platform

function fireNotification(title, body, noSound) {
  if (platform === 'darwin') {
    const args = ['-title', title, '-message', body, '-group', 'mrc']
    if (!noSound) args.push('-sound', 'Glass')
    execFile('terminal-notifier', args, () => {})
  } else {
    execFile('notify-send', [title, body], () => {})
  }
}

export function startNotifyProxy(port, { noSound = false } = {}) {
  return new Promise((resolve, reject) => {
    const server = createServer(socket => {
      let data = ''
      socket.setEncoding('utf8')
      socket.on('data', chunk => { data += chunk })
      socket.on('end', () => {
        const lines = data.split('\n')
        const repo = (lines[0] || '').replace(/\r$/, '') || 'workspace'
        const summary = (lines[1] || '').replace(/\r$/, '') || 'Ready for input.'
        const title = `Mr. Claude · ${repo}`
        log(PREFIX, `${title}: ${summary}`)
        fireNotification(title, summary, noSound)
      })
      socket.on('error', () => {})
    })

    server.listen(port, '127.0.0.1', () => {
      log(PREFIX, `listening on 127.0.0.1:${port} (sound: ${noSound ? 'off' : 'on'})`)
      resolve(server)
    })
    server.on('error', reject)
  })
}
