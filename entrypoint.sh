#!/bin/bash
set -euo pipefail
trap 'echo "FAILED at line $LINENO (exit code $?)" >&2' ERR

# Wait for network to be ready (Colima can be slow to warm up)
echo "Waiting for network..."
for i in $(seq 1 30); do
  if dig +short +timeout=1 api.anthropic.com >/dev/null 2>&1; then
    echo "Network ready after ${i}s"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: Network not ready after 30 attempts"
    dig api.anthropic.com 2>&1 || true
    exit 1
  fi
  sleep 1
done

# Run firewall (must be bash + sudo — see init-firewall.sh)
sudo ALLOW_WEB="${ALLOW_WEB:-}" \
  MRC_CLIPBOARD_PORT="${MRC_CLIPBOARD_PORT:-7722}" \
  MRC_NOTIFY_PORT="${MRC_NOTIFY_PORT:-7723}" \
  /usr/local/bin/init-firewall.sh

# All config setup is now in Node
node /usr/local/bin/container-setup.js

# Read the resume flag computed by container-setup.js
RESUME_FLAG=""
if [ -f /tmp/mrc-resume-flag ]; then
  RESUME_FLAG="$(cat /tmp/mrc-resume-flag)"
  rm -f /tmp/mrc-resume-flag
fi

if [ "${MRC_DAEMON:-}" = "1" ]; then
  echo "READY"
  exec tail -f /dev/null
fi

echo "Launching Claude Code..."
claude --dangerously-skip-permissions $RESUME_FLAG "$@"
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo "Claude exited with code $EXIT_CODE"
  echo "Debug info:"
  echo "  Claude: $(claude --version 2>&1 || echo 'not found')"
  echo "  TERM: ${TERM:-unset}"
  echo "  TTY: $(tty 2>&1 || echo 'not a tty')"
  echo "  API key set: $([ -n "${ANTHROPIC_API_KEY:-}" ] && echo yes || echo no)"
fi
exit $EXIT_CODE
