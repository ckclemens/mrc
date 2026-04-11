#!/bin/bash
# mrc-notify-hook.sh — Container-side notification hook handler.
# Reads Claude Code's hook JSON from stdin, detects the event type,
# extracts an appropriate summary, and sends it to the host
# notification proxy. Handles Stop, PermissionRequest, and Notification events.
set -euo pipefail

PORT="${MRC_NOTIFY_PORT:-7723}"
REPO="${MRC_REPO_NAME:-workspace}"

# Extract a summary from the hook JSON, dispatching on hook_event_name.
SUMMARY=$(node -e "
  let d = '';
  process.stdin.on('data', c => d += c);
  process.stdin.on('end', () => {
    try {
      const h = JSON.parse(d);
      const clean = s => String(s).replace(/[#*\`\[\]]/g, '').replace(/\n+/g, ' ').trim();
      const trunc = s => s.length > 140 ? s.substring(0, 140) + '…' : s;
      let msg;
      switch (h.hook_event_name) {
        case 'Stop':
          msg = trunc(clean(h.last_assistant_message || '')) || 'Done.';
          break;
        case 'PermissionRequest':
          msg = h.tool_name ? 'Needs approval: ' + h.tool_name : 'Needs your approval';
          break;
        case 'Notification':
          msg = h.message ? trunc(clean(h.message)) : 'Needs your attention';
          break;
        default:
          msg = 'Needs your attention';
      }
      console.log(msg);
    } catch(e) { console.log('Needs your attention'); }
  });
" 2>/dev/null || echo "Needs your attention")

# Protocol: line 1 = repo name, line 2 = summary
printf '%s\n%s\n' "$REPO" "$SUMMARY" \
  | socat - "TCP:host.docker.internal:${PORT},connect-timeout=2" 2>/dev/null || true
