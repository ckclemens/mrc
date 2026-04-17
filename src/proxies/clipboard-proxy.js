#!/usr/bin/env node
//
// clipboard-proxy.js — Host-side clipboard proxy for mrc containers.
//
// Protocol:
//   Client connects, sends: "GET <mimetype>\n"
//   Server writes back raw bytes and closes the connection.
//
import { createServer } from 'node:net'
import { execFile, execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, unlinkSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { log } from '../output.js'

const PREFIX = 'clipboard-proxy'
const platform = process.platform  // 'darwin' or 'linux'

function darwinGetImage(outfile) {
  // Method 1: pngpaste
  try {
    execFileSync('pngpaste', [outfile], { stdio: 'ignore' })
    if (statSync(outfile).size > 0) return true
  } catch {}

  // Method 2: osascript with NSBitmapImageRep
  const script = `
    use framework "AppKit"
    use framework "Foundation"
    set pb to current application's NSPasteboard's generalPasteboard()
    set imgTypes to {current application's NSPasteboardTypePNG, current application's NSPasteboardTypeTIFF}
    set rawData to missing value
    repeat with t in imgTypes
      set rawData to (pb's dataForType:t)
      if rawData is not missing value then exit repeat
    end repeat
    if rawData is missing value then error "no image"
    set imgRep to current application's NSBitmapImageRep's imageRepWithData:rawData
    if imgRep is missing value then error "bad image data"
    set pngData to imgRep's representationUsingType:(current application's NSBitmapImageFileTypePNG) |properties|:(missing value)
    pngData's writeToFile:"${outfile}" atomically:true
  `
  try {
    execFileSync('osascript', ['-e', script], { stdio: 'ignore' })
    if (statSync(outfile).size > 0) return true
  } catch {}

  return false
}

function readClipboard(mime) {
  if (platform === 'darwin') {
    if (mime === 'TARGETS') {
      const types = ['text/plain']
      const tmpfile = join(tmpdir(), `mrc-clip-check-${process.pid}`)
      try {
        if (darwinGetImage(tmpfile)) types.push('image/png')
      } finally {
        try { unlinkSync(tmpfile) } catch {}
      }
      return Buffer.from(types.join('\n') + '\n')
    }
    if (mime === 'image/png') {
      const tmpfile = join(tmpdir(), `mrc-clip-img-${process.pid}`)
      try {
        if (darwinGetImage(tmpfile)) {
          const data = readFileSync(tmpfile)
          unlinkSync(tmpfile)
          return data
        }
      } catch {}
      try { unlinkSync(tmpfile) } catch {}
      return null
    }
    if (mime === 'text/plain') {
      try { return Buffer.from(execFileSync('pbpaste', { encoding: 'utf8' })) } catch {}
      return null
    }
  }

  if (platform === 'linux') {
    if (mime === 'TARGETS') {
      try {
        return Buffer.from(execFileSync('xclip', ['-selection', 'clipboard', '-t', 'TARGETS', '-o'], { encoding: 'utf8' }))
      } catch {}
      return null
    }
    if (mime.startsWith('image/') || mime === 'text/plain') {
      try {
        return execFileSync('xclip', ['-selection', 'clipboard', '-t', mime, '-o'])
      } catch {}
      return null
    }
  }
  return null
}

export function startClipboardProxy(port) {
  return new Promise((resolve, reject) => {
    const server = createServer(socket => {
      let request = ''
      socket.once('data', chunk => {
        request = chunk.toString().split('\n')[0].replace(/\r$/, '')
        const mime = request.replace(/^GET\s+/, '').trim()
        log(PREFIX, `request: GET ${mime}`)
        const data = readClipboard(mime)
        if (data) socket.end(data)
        else socket.end()
      })
      socket.on('error', () => {})
    })

    server.listen(port, '127.0.0.1', () => {
      log(PREFIX, `listening on 127.0.0.1:${port}`)
      resolve(server)
    })
    server.on('error', reject)
  })
}

// Direct invocation: node clipboard-proxy.js <port>
if (process.argv[1]?.endsWith('clipboard-proxy.js') && process.argv[2]) {
  startClipboardProxy(Number(process.argv[2]))
}
