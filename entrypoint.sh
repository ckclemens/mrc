#!/bin/bash
set -euo pipefail

# Wait for network to be ready (Colima can be slow to warm up)
echo "Waiting for network..."
for i in $(seq 1 30); do
  if dig +short +timeout=1 api.anthropic.com >/dev/null 2>&1; then
    echo "Network ready after ${i}s"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: Network not ready after 30 attempts"
    echo "DNS test:"
    dig api.anthropic.com 2>&1 || true
    echo "Route:"
    ip route 2>&1 || true
    exit 1
  fi
  sleep 1
done

sudo /usr/local/bin/init-firewall.sh

echo "API key: ${ANTHROPIC_API_KEY:+set (${#ANTHROPIC_API_KEY} chars)}"

# Skip onboarding prompt when API key is provided
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  if [ ! -s "$HOME/.claude.json" ]; then
    echo '{"hasCompletedOnboarding":true}' > "$HOME/.claude/claude.json"
  fi
fi

exec claude --dangerously-skip-permissions "$@"