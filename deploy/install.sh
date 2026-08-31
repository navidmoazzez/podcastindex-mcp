#!/usr/bin/env bash
# Install podcastindex-mcp into Claude Code, and check it works.
#
# Everything here is also two manual steps in the README. This exists for
# people who would rather run one line.
set -euo pipefail

PKG="@thenavidm/podcastindex-mcp@latest"

if ! command -v node >/dev/null 2>&1; then
  echo "Node is not installed. Get it from https://nodejs.org (version 20 or newer)." >&2
  exit 1
fi

MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 20 ]; then
  echo "Node $MAJOR is too old. This needs 20 or newer." >&2
  exit 1
fi

KEY="${PODCASTINDEX_API_KEY:-}"
SECRET="${PODCASTINDEX_API_SECRET:-}"

if [ -z "$KEY" ] || [ -z "$SECRET" ]; then
  echo "Both halves of the credential are needed. Get them free, with no approval step,"
  echo "at https://api.podcastindex.org/signup"
  echo
  read -r -p "API key: " KEY
  read -r -s -p "API secret: " SECRET
  echo
fi

if command -v claude >/dev/null 2>&1; then
  claude mcp add podcastindex \
    -e "PODCASTINDEX_API_KEY=$KEY" \
    -e "PODCASTINDEX_API_SECRET=$SECRET" \
    -- npx -y "$PKG"
  echo "Added to Claude Code."
else
  echo "Claude Code was not found. Add this to your client config instead:"
  echo
  echo '  "podcastindex": {'
  echo '    "command": "npx",'
  echo "    \"args\": [\"-y\", \"$PKG\"],"
  echo '    "env": {'
  echo "      \"PODCASTINDEX_API_KEY\": \"$KEY\","
  echo '      "PODCASTINDEX_API_SECRET": "..."'
  echo '    }'
  echo '  }'
fi

echo
PODCASTINDEX_API_KEY="$KEY" PODCASTINDEX_API_SECRET="$SECRET" npx -y "$PKG" doctor
