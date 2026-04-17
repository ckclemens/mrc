import { readFileSync, readdirSync } from 'node:fs'
import { join, basename } from 'node:path'

/**
 * Extract a condensed transcript from a session JSONL.
 * If maxChars > 0, stop once that length is reached.
 * Otherwise cap at ~16K chars (first 8K + last 8K).
 */
export function extractTranscript(mrcDir, uuid, maxChars = 0) {
  const file = join(mrcDir, `${uuid}.jsonl`)
  let raw
  try { raw = readFileSync(file, 'utf8') } catch { return '' }

  const lines = []
  let total = 0

  for (const rawLine of raw.split('\n')) {
    if (!rawLine) continue
    let obj
    try { obj = JSON.parse(rawLine) } catch { continue }

    if (obj.type === 'user') {
      let content = obj.message?.content || ''
      if (Array.isArray(content)) {
        content = content.filter(c => c.type === 'text').map(c => c.text || '').join(' ')
      }
      if (content.trim()) {
        const line = `USER: ${content.trim()}`
        lines.push(line)
        total += line.length
      }
    } else if (obj.type === 'assistant') {
      const content = obj.message?.content
      if (typeof content === 'string') {
        const line = `ASSISTANT: ${content.trim()}`
        lines.push(line)
        total += line.length
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && block.text?.trim()) {
            const line = `ASSISTANT: ${block.text.trim()}`
            lines.push(line)
            total += line.length
          } else if (block.type === 'tool_use') {
            const name = block.name || '?'
            const inp = block.input || {}
            let detail
            if (name === 'Bash') detail = (inp.command || '').slice(0, 80)
            else if (['Grep', 'Glob'].includes(name)) detail = (inp.pattern || '').slice(0, 80)
            else if (['Read', 'Write', 'Edit'].includes(name)) detail = (inp.file_path || '').slice(0, 80)
            else detail = JSON.stringify(inp).slice(0, 80)
            const line = `TOOL: ${name}(${detail})`
            lines.push(line)
            total += line.length
          }
        }
      }
    }

    if (maxChars > 0 && total >= maxChars) break
  }

  let transcript = lines.join('\n')
  if (maxChars > 0) return transcript.slice(0, maxChars)
  if (transcript.length > 16000) {
    transcript = transcript.slice(0, 8000) + '\n\n[... middle truncated ...]\n\n' + transcript.slice(-8000)
  }
  return transcript
}

/** Regex patterns for tool-miss detection. */
const TOOL_MISS_PATTERNS = [
  [/(\S+): command not found/g, 'command not found'],
  [/bash: (\S+): No such file or directory/g, 'not on PATH'],
  [/(?:illegal|invalid|unrecognized) option/g, 'option incompatibility'],
]

/** Detect missing tools from a session transcript. Returns Map<cmd, desc>. */
export function detectToolMisses(mrcDir, uuid) {
  const file = join(mrcDir, `${uuid}.jsonl`)
  let raw
  try { raw = readFileSync(file, 'utf8') } catch { return new Map() }

  const misses = new Map()
  for (const rawLine of raw.split('\n')) {
    if (!rawLine) continue
    let obj
    try { obj = JSON.parse(rawLine) } catch { continue }
    let content = obj.message?.content || ''
    if (Array.isArray(content)) {
      content = content.filter(c => typeof c === 'object').map(c => c.text || '').join('\n')
    }
    for (const [pattern, desc] of TOOL_MISS_PATTERNS) {
      pattern.lastIndex = 0
      let match
      while ((match = pattern.exec(content)) !== null) {
        const cmd = match[1] || match[0]
        if (cmd && cmd !== '.' && cmd !== '..') misses.set(cmd, desc)
      }
    }
  }
  return misses
}
