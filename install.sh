#!/bin/sh
# Installs or upgrades wk on macOS or Linux: downloads the latest release binary to ~/.local/bin.
#   curl -fsSL https://raw.githubusercontent.com/benfo/wk/main/install.sh | sh
# WK_INSTALL_DIR overrides the folder; WK_VERSION (e.g. v0.2.0) pins a release.
set -eu

repo="benfo/wk"
dir="${WK_INSTALL_DIR:-$HOME/.local/bin}"

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) echo "wk: unsupported system $(uname -s). On Windows use install.ps1." >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=amd64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) echo "wk: unsupported processor $(uname -m)." >&2; exit 1 ;;
esac

if [ -n "${WK_VERSION:-}" ]; then
  url="https://github.com/$repo/releases/download/$WK_VERSION/wk-$os-$arch"
else
  url="https://github.com/$repo/releases/latest/download/wk-$os-$arch"
fi

mkdir -p "$dir"
tmp="$dir/.wk.download"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$url" -o "$tmp"
else
  wget -qO "$tmp" "$url"
fi
chmod +x "$tmp"
mv -f "$tmp" "$dir/wk"

echo "Installed wk to $dir/wk"
case ":$PATH:" in
  *":$dir:"*) ;;
  *) echo "Add $dir to your PATH, e.g. in ~/.profile:  export PATH=\"$dir:\$PATH\"" ;;
esac
echo "Next, in a project: npx skills add benfo/wk, then ask your agent to set up wk   (rerun this installer to upgrade)"
