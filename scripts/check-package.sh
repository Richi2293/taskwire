#!/usr/bin/env bash
# Builds the npm package, installs it globally in a temporary prefix and runs it from node_modules,
# where Node refuses to strip TypeScript types. Needs tsc on the PATH (the workflows install it).
set -euo pipefail

cd "$(dirname "$0")/.."
rm -rf dist
tsc -p tsconfig.build.json

work="$(mktemp -d)"
tarball="$(npm pack --silent --pack-destination "$work")"
npm install --global --silent --prefix "$work/prefix" "$work/$tarball"
bin="$work/prefix/bin/taskwire"

expected="$(node -p 'require("./package.json").version')"
actual="$("$bin" --version)"
if [ "$actual" != "$expected" ]; then
  echo "taskwire --version printed \"$actual\", expected \"$expected\"" >&2
  exit 1
fi
"$bin" --help > /dev/null
echo "Package check passed: $tarball"
