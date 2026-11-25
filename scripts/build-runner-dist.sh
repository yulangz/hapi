#!/bin/sh
# Run after download:tunwg, build:web and generate:embedded-web-assets.
set -eu
root=$(CDPATH='' cd "$(dirname "$0")/.." && pwd)
out=${1:-"$root/cli/dist-exe/runner-dist"}
mkdir -p "$out"
out=$(cd "$out" && pwd)
cd "$root/cli"
for platform in linux-x64 linux-arm64 darwin-arm64 darwin-x64; do
    target=bun-$platform
    if [ "$platform" = linux-x64 ]; then target=bun-linux-x64-baseline; fi
    bun run scripts/build-executable.ts --target "$target" --with-web-assets --name hamlet-runner
    name=hamlet-runner-$platform.gz
    gzip -n -3 -c "dist-exe/$target/hamlet-runner" > "$out/$name.tmp"
    mv "$out/$name.tmp" "$out/$name"
    (cd "$out" && shasum -a 256 "$name" > "$name.sha256.tmp" && mv "$name.sha256.tmp" "$name.sha256")
done
