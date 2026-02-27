#!/usr/bin/env bash
#
# mrc — Mister Claude
# Launch Claude Code in a sandboxed Docker container with network firewall.
#
# Usage:
#   mrc [path-to-repo] [-- claude-code-args...]
#
# Examples:
#   mrc ~/projects/myapp
#   mrc ~/projects/myapp -- --model claude-sonnet-4-5-20250929
#   mrc .                 -- -p "fix the failing tests"
#
# Hidden directories:
#   Create a .sandboxignore file in your repo root listing paths to hide
#   from the container (one per line, relative to repo root):
#
#     .env
#     secrets/
#     infrastructure/
#
# Environment:
#   ANTHROPIC_API_KEY  — optional; loaded from .env next to this script if present

set -euo pipefail

# Resolve symlinks to find the real script directory (portable, works on macOS)
SOURCE="$0"
while [ -L "$SOURCE" ]; do
  DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
IMAGE_NAME="mister-claude"

# Parse repo path (default: current directory)
REPO_PATH="${1:-.}"
REPO_PATH="$(cd "$REPO_PATH" && pwd)"
shift || true

# Strip optional "--" separator
[[ "${1:-}" == "--" ]] && shift

# Load .env file if present (for dedicated API key)
ENV_FILE="$SCRIPT_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a            # auto-export all sourced variables
  source "$ENV_FILE"
  set +a
fi

# Pass API key through if set
ENV_FLAGS=()
if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  ENV_FLAGS+=(-e ANTHROPIC_API_KEY)
fi

# Ensure Colima is running
STARTED_COLIMA=false
if command -v colima &>/dev/null; then
  # Point docker at Colima's socket if not already configured
  if [[ -z "${DOCKER_HOST:-}" ]]; then
    export DOCKER_HOST="unix://${HOME}/.colima/default/docker.sock"
  fi
  if ! colima status &>/dev/null 2>&1; then
    echo "🎩 Starting Colima..."
    colima start --vm-type vz --mount-type virtiofs --cpu 4 --memory 8
    STARTED_COLIMA=true
  fi
elif ! docker info &>/dev/null 2>&1; then
  echo "Error: Docker is not running and Colima is not installed." >&2
  exit 1
fi

# Stop Colima on exit if we started it
if $STARTED_COLIMA; then
  trap 'echo "🎩 Stopping Colima..."; colima stop' EXIT
fi

# Build image if needed
USER_UID="$(id -u)"
USER_GID="$(id -g)"

docker build -q \
  --build-arg USER_UID="$USER_UID" \
  --build-arg USER_GID="$USER_GID" \
  -t "$IMAGE_NAME" \
  "$SCRIPT_DIR" > /dev/null

# Build volume flags
VOLUMES=(-v "$REPO_PATH:/workspace")

# Read .sandboxignore and create volume overlays for each entry
IGNORE_FILE="$REPO_PATH/.sandboxignore"
if [[ -f "$IGNORE_FILE" ]]; then
  while IFS= read -r line; do
    # Skip blank lines and comments
    line="${line%%#*}"          # strip inline comments
    line="${line%"${line##*[![:space:]]}"}"  # trim trailing whitespace
    line="${line#"${line%%[![:space:]]*}"}"  # trim leading whitespace
    [[ -z "$line" ]] && continue

    # Strip trailing slash for consistency
    line="${line%/}"

    HOST_PATH="$REPO_PATH/$line"
    CONTAINER_PATH="/workspace/$line"

    if [[ -f "$HOST_PATH" ]]; then
      # Files: mount /dev/null over them (appears as empty file)
      VOLUMES+=(-v "/dev/null:$CONTAINER_PATH:ro")
      echo "→ Hidden:    $line (file)"
    elif [[ -d "$HOST_PATH" ]]; then
      # Directories: anonymous volume overlay (appears as empty dir)
      VOLUMES+=(-v "$CONTAINER_PATH")
      echo "→ Hidden:    $line (dir)"
    else
      echo "→ Skipped:   $line (not found)"
    fi
  done < "$IGNORE_FILE"
fi

# Persist Claude config between runs
VOLUMES+=(-v "mister-claude-config:/home/coder/.claude")

echo "🎩 Mister Claude"
echo "→ Repo:      $REPO_PATH"
echo "→ UID/GID:   $USER_UID:$USER_GID"
echo "→ Firewall:  enabled"
echo ""

docker run --rm -it \
  --cap-add=NET_ADMIN \
  --cap-add=NET_RAW \
  ${ENV_FLAGS[@]+"${ENV_FLAGS[@]}"} \
  "${VOLUMES[@]}" \
  "$IMAGE_NAME" \
  "$@"
