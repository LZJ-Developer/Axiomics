#!/usr/bin/env bash
# 重建租户镜像。
#
# 三步，都可重复执行：
#   ① 内部 CA + 服务证书 —— 已存在则跳过
#   ② axiomics 二进制从本仓库构建
#   ③ podman build
#
# 之所以需要脚本而不是一个 Containerfile：二进制是本仓库的构建产物，
# 不是能从包管理器装出来的东西。没有这一步，"镜像可重建"就是空话。
#
# 用法：
#   AX_ROOT=/srv/axiomics ./build.sh
#
# 环境变量：
#   AX_ROOT        运行时根（默认 /srv/axiomics）。证书写在其 ca/ 下
#   AX_IMAGE       镜像名（默认 localhost/axiomics-tenant:latest）
#   AX_GATEWAY_IP  服务证书 SAN 里的网关 IP（默认 127.0.0.1）
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
AX_ROOT="${AX_ROOT:-/srv/axiomics}"
AX_IMAGE="${AX_IMAGE:-localhost/axiomics-tenant:latest}"
AX_GATEWAY_IP="${AX_GATEWAY_IP:-127.0.0.1}"

CA_DIR="$AX_ROOT/ca"
CTX="$(mktemp -d)"
trap 'rm -rf "$CTX"' EXIT

# bun 按绝对路径解析：它通常只装在 ~/.bun/bin，靠交互 shell 的 profile 进 PATH。
# 从 systemd / cron / sudo 调用时 PATH 里没有它，脚本会在**证书已经生成之后**、
# 构建二进制时才失败。与 deploy.sh 同一段逻辑。
BUN="${AX_BUN:-$(command -v bun || true)}"
[ -x "$BUN" ] || for c in "$HOME/.bun/bin/bun" /usr/local/bin/bun /usr/bin/bun; do
  [ -x "$c" ] && { BUN="$c"; break; }
done
[ -x "$BUN" ] || { echo "找不到 bun —— 用 AX_BUN=/绝对/路径/bun 指定后重跑" >&2; exit 1; }
# backend/cli 的构建脚本内部还会再调用一次裸 `bun`，所以把它的目录放进 PATH。
export PATH="$(dirname "$BUN"):$PATH"

# ── ① 证书 ───────────────────────────────────────────────────────────
mkdir -p "$CA_DIR"
if [ ! -f "$CA_DIR/rootCA.key" ]; then
  echo "生成内部根 CA（10 年）"
  openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes \
    -keyout "$CA_DIR/rootCA.key" -out "$CA_DIR/rootCA.crt" \
    -subj "/O=Axiomics/CN=Axiomics Internal CA" >/dev/null 2>&1
  chmod 0600 "$CA_DIR/rootCA.key"
else
  echo "内部根 CA 已存在，跳过"
fi

# SAN 必须覆盖本机**全部**内网 IP：客户端经 VPN 落在哪一段由网络侧决定，我们看不出来。
# 只写一个 IP 时，从别的段进来的浏览器会报证书不匹配 —— 而那个报错很容易被当成
# "网络不通"。用 AX_GATEWAY_IPS 可收窄。
IPS="$( { echo "$AX_GATEWAY_IP"; "$HERE/../bin/axiomics-gateway-ips"; } | awk 'NF' | sort -u )"
SAN="$(printf '%s\n' "$IPS" | sed 's|^|IP:|' | paste -sd, -),DNS:localhost,DNS:host.containers.internal"

# 换 IP 时证书得重签，否则 SAN 里还是旧地址。AX_REGEN_CERTS=1 强制。
case "${AX_REGEN_CERTS:-}" in 1|true|yes) REGEN=1 ;; *) REGEN=0 ;; esac
if [ "$REGEN" = "1" ]; then
  rm -f "$CA_DIR/server.key" "$CA_DIR/server.crt"
  echo "强制重签服务证书（AX_REGEN_CERTS=1）"
fi

if [ ! -f "$CA_DIR/server.key" ]; then
  echo "签发服务证书（SAN: $SAN）"
  cat >"$CTX/san.cnf" <<EOF
[req]
distinguished_name=dn
[dn]
[ext]
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=$SAN
EOF
  openssl req -newkey rsa:2048 -sha256 -nodes \
    -keyout "$CA_DIR/server.key" -out "$CA_DIR/server.csr" \
    -subj "/O=Axiomics/CN=$AX_GATEWAY_IP" >/dev/null 2>&1
  openssl x509 -req -in "$CA_DIR/server.csr" -CA "$CA_DIR/rootCA.crt" -CAkey "$CA_DIR/rootCA.key" \
    -CAcreateserial -out "$CA_DIR/server.crt" -days 825 -sha256 -extfile "$CTX/san.cnf" -extensions ext >/dev/null 2>&1
  rm -f "$CA_DIR/server.csr"
  chmod 0600 "$CA_DIR/server.key"
else
  echo "服务证书已存在，跳过（换 IP 时删掉 $CA_DIR/server.{crt,key} 重新生成）"
fi

# ── ② 二进制 ─────────────────────────────────────────────────────────
# 只做证书、不重建镜像：起第二套隔离实例做从零验证时用 —— 镜像已经存在，
# 只需要给新 AX_ROOT 生成一套自己的证书。
if [ "${AX_CERTS_ONLY:-false}" = "true" ]; then
  echo "AX_CERTS_ONLY=true：证书已就绪，跳过二进制与镜像构建"
  exit 0
fi

BIN="$REPO/backend/cli/dist/@axiomics/axiomics-linux-x64/bin/axiomics"
# 全新 clone 上直接跑本脚本会死在 `Cannot find module '@axiomics/script'`：
# 二进制构建的第一行就 import 了一个 workspace 包，模块解析发生在任何
# "缺依赖就自动安装" 的兜底代码之前。所以依赖必须先装。
if [ ! -d "$REPO/node_modules" ]; then
  echo "首次构建：安装 workspace 依赖"
  (cd "$REPO" && "$BUN" install --frozen-lockfile) \
    || { echo "bun install 失败 —— 内网机器需要先把依赖装好再重跑" >&2; exit 1; }
fi
# 迭代镜像层时用 AX_SKIP_BINARY=true 复用上一次的产物，省几分钟。
if [ "${AX_SKIP_BINARY:-false}" = "true" ]; then
  echo "跳过二进制构建（AX_SKIP_BINARY=true）"
  [ -f "$BIN" ] || { echo "没有可复用的 $BIN" >&2; exit 1; }
else
  echo "构建 axiomics 二进制（backend/cli）"
  # 清掉旧的，避免构建失败时误用上一次的产物
  rm -f "$BIN"
  (cd "$REPO/backend/cli" && "$BUN" run build --single)
  [ -f "$BIN" ] || { echo "构建未产出 $BIN" >&2; exit 1; }
fi

# ── ③ 镜像 ───────────────────────────────────────────────────────────
cp "$BIN" "$CTX/axiomics"
cp "$CA_DIR/rootCA.crt" "$CTX/axiomics-internal-ca.crt"
echo "构建镜像 $AX_IMAGE"
# --http-proxy=false：podman build 默认把宿主 shell 的 *_proxy 转发进构建容器。
# 开发机上的代理（如 SSH 隧道）一旦不可用，dnf 就会死在
# `Curl error (7): Failed to connect to 127.0.0.1 port 10808`，
# 报错却指向 mirrors.rockylinux.org，很容易误判成镜像源问题。
# 构建不需要代理；确需时设 AX_BUILD_PROXY=true。
if [ "${AX_BUILD_PROXY:-false}" = "true" ]; then
  podman build --http-proxy=true -t "$AX_IMAGE" -f "$HERE/Containerfile" "$CTX"
else
  podman build --http-proxy=false -t "$AX_IMAGE" -f "$HERE/Containerfile" "$CTX"
fi

echo
echo "完成：$AX_IMAGE"
podman run --rm --entrypoint sh "$AX_IMAGE" -c '
  printf "  axiomics  %s\n" "$(sha256sum /usr/local/bin/axiomics | cut -c1-16)"
  printf "  bwrap     %s\n" "$(command -v bwrap)"
  printf "  socat     %s\n" "$(command -v socat)"
  printf "  内部 CA   %s\n" "$(openssl x509 -in /etc/pki/ca-trust/source/anchors/axiomics-internal-ca.crt -noout -subject)"
'
