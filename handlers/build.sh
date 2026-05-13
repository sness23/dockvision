#!/usr/bin/env bash
# Build a handler Docker image from the handlers/ context.
# Usage:
#   ./handlers/build.sh gnina       # uses tag dockvision/gnina:latest
#   ./handlers/build.sh boltz2 my-registry/dockvision-boltz2:2.1
#
# Build context = handlers/  so the shared handlers/_lib is reachable.

set -euo pipefail

if [[ $# -lt 1 ]]; then
	echo "usage: $0 <tool> [image-tag]" >&2
	exit 1
fi

tool="$1"
tag="${2:-dockvision/${tool}:latest}"

cd "$(dirname "$0")"   # handlers/

if [[ ! -d "$tool" ]]; then
	echo "no handler dir: handlers/$tool" >&2
	exit 1
fi

echo "building $tag from context $(pwd)"
docker build -t "$tag" -f "$tool/Dockerfile" .
echo
echo "next: docker push $tag"
