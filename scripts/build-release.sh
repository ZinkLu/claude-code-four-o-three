#!/usr/bin/env bash
# 构建发布包：把插件源码打成离线发行 ZIP，并生成 sha256 校验文件。
#
#   ./scripts/build-release.sh
#
# 产物写入 dist/，内容与仓库根目录一致（不含 .git、data、dist、缓存目录）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NAME="$(python3 -c 'import json;print(json.load(open(".claude-plugin/plugin.json"))["name"])')"
VERSION="$(python3 -c 'import json;print(json.load(open(".claude-plugin/plugin.json"))["version"])')"

DIST="$ROOT/dist"
ZIP_NAME="$NAME-$VERSION.zip"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$DIST"

# 只打包插件运行时需要的文件，不含运行时数据与构建产物。
for item in .claude-plugin assets hooks scripts tests README.md INSTALL.md LICENSE; do
  [ -e "$item" ] || continue
  cp -R "$item" "$STAGE/"
done
find "$STAGE" -name '__pycache__' -type d -prune -exec rm -rf {} +

rm -f "$DIST/$ZIP_NAME" "$DIST/$ZIP_NAME.sha256"
(cd "$STAGE" && zip -qr "$DIST/$ZIP_NAME" .)
(cd "$DIST" && sha256sum "$ZIP_NAME" > "$ZIP_NAME.sha256")

echo "已构建 $DIST/$ZIP_NAME"
