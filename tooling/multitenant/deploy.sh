#!/usr/bin/env bash
# 把仓库里的多租户运行时装到 AX_ROOT 并拉起。
#
# 可重复执行：已存在的东西不覆盖，缺的补上。
#
# 用法：
#   AX_ROOT=/srv/axiomics ./deploy.sh
#
# 前置：
#   - 已跑过 image/build.sh（镜像存在）
#   - $AX_ROOT/secrets/deepseek.key 存在（0600），内容为模型网关用的真实密钥
#   - 宿主 sysctl：net.ipv4.ip_unprivileged_port_start=443、kernel.dmesg_restrict=1
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AX_ROOT="${AX_ROOT:-/srv/axiomics}"
AX_IMAGE="${AX_IMAGE:-localhost/axiomics-tenant:latest}"
# 网关 IP 要粘住。deploy.sh 是可重复执行的，而它的默认值是 127.0.0.1 —— 内网部署
# 如果哪次忘了带 AX_GATEWAY_IP 重跑，证书会被重签成 127.0.0.1、Authelia 的 cookie
# domain 也会跟着变，内网地址当场连不上，而报错只是浏览器里一句证书警告。
# 所以首次把选定的 IP 落到 $AX_ROOT/gateway-ip，之后不带变量也读得回来。
IP_FILE="$AX_ROOT/gateway-ip"
if [ -z "${AX_GATEWAY_IP:-}" ] && [ -f "$IP_FILE" ]; then
  AX_GATEWAY_IP="$(tr -d '[:space:]' <"$IP_FILE")"
fi
AX_GATEWAY_IP="${AX_GATEWAY_IP:-127.0.0.1}"
mkdir -p "$AX_ROOT"
printf '%s\n' "$AX_GATEWAY_IP" >"$IP_FILE"

# 共享工具链根，同一套"粘住"做法：部署时定的位置写在 $AX_ROOT 下，
# 之后跑 axiomics-tenant 不必每次带 AX_SHARED_ENVS。没给就用约定位置 $AX_ROOT/envs。
if [ -n "${AX_SHARED_ENVS:-}" ]; then
  printf '%s\n' "$AX_SHARED_ENVS" >"$AX_ROOT/shared-envs-root"
elif [ -f "$AX_ROOT/shared-envs-root" ]; then
  AX_SHARED_ENVS="$(tr -d '[:space:]' <"$AX_ROOT/shared-envs-root")"
else
  AX_SHARED_ENVS="$AX_ROOT/envs"
  printf '%s\n' "$AX_SHARED_ENVS" >"$AX_ROOT/shared-envs-root"
fi

# 挂载守卫：AX_ROOT 坐在独立挂载点上时，把这个挂载点填进单元 —— 数据盘没挂上，
# 残留的挂载点目录会让"目录存在"检查照样通过，服务就会在一个空目录上跑。
# 在 rootfs 上部署（AX_ROOT=/srv/...）时解析结果是 /，此时留空，只查目录。
AX_REQUIRE_MOUNT="${AX_REQUIRE_MOUNT:-}"
if [ -z "$AX_REQUIRE_MOUNT" ]; then
  AX_REQUIRE_MOUNT="$(findmnt -n -o TARGET -T "$AX_ROOT" 2>/dev/null | head -1 || true)"
  [ "$AX_REQUIRE_MOUNT" = "/" ] && AX_REQUIRE_MOUNT=""
fi
AX_USERS_FILE="$AX_ROOT/auth/users_database.yml"
KEY_FILE="$AX_ROOT/secrets/deepseek.key"

# ── 实例命名与监听地址 ───────────────────────────────────────────────
# 默认值**就是生产值**，常规部署行为完全不变。之所以全部可覆盖，是要能在同一台
# 机器上再起一套隔离实例做从零验证 —— 否则第二套部署会 `podman rm -f` 掉生产的
# ax-gw / ax-authelia，并且抢 443。验证实例用 AX_NAME_SUFFIX=-stage 之类把名字和
# 端口整套错开。
AX_NAME_SUFFIX="${AX_NAME_SUFFIX:-}"                 # 例：-stage → ax-stage-gw
AX_UNIT_PREFIX="${AX_UNIT_PREFIX:-axiomics}"         # 例：axiomics-stage
AUTHELIA_NAME="ax${AX_NAME_SUFFIX}-authelia"
GATEWAY_NAME="ax${AX_NAME_SUFFIX}-gw"
# 绑环回就够了：只有同机的 Caddy 连它，浏览器走 443 上的 /auth。绑 0.0.0.0 时，
# 宿主若没开防火墙（这类机器常见），9091 会直接暴露在全部网段上 —— 一个只该内部
# 可见的登录服务没有理由让外网能连。拆多机部署时再改成对网关可达的地址。
AUTHELIA_ADDR="${AX_AUTHELIA_ADDR:-127.0.0.1:9091}"  # Authelia 监听（容器内 network=host）
GW_ADDR="${AX_GW_ADDR:-:443}"                        # Caddy 站点
MODEL_ADDR="${AX_MODEL_ADDR:-:43001}"
# Caddy 管理端：**必须留在 127.0.0.1 上**，只能换端口。
# `caddy reload` 会按配置里的 admin 地址发请求，而 Caddy 的 admin 只接受
# localhost 作为 Host —— 写成 127.0.0.x:2019 会被 `403 host not allowed` 拒绝，
# 后果是租户增删后网关不重载（新租户 403），而脚本只打一句"网关重载失败"。
CADDY_ADMIN="${AX_CADDY_ADMIN:-127.0.0.1:2019}"
AUTH_ADDR="${AX_AUTH_ADDR:-127.0.0.1:9091}"
ACTIVATOR_PORT="${AX_ACTIVATOR_PORT:-9300}"
ACTIVATOR_ADDR="${AX_ACTIVATOR_ADDR:-127.0.0.1:$ACTIVATOR_PORT}"
MODEL_PORT="${AX_MODEL_PORT:-43002}"
MODEL_PROXY_ADDR="${AX_MODEL_PROXY_ADDR:-127.0.0.1:$MODEL_PORT}"
# 网关端口：Authelia 的 authelia_url 必须带它。漏了的后果是——非 443 的实例
# 登录成功后会被重定向到 `https://<ip>/auth`，也就是**443 上的另一套部署**，
# 于是 cookie 落在错误的实例上，表现为"登录成功但一直未登录"。
case "$GW_ADDR" in
  *:*) GW_PORT="${GW_ADDR##*:}" ;;
  *)   GW_PORT=443 ;;
esac
GW_ORIGIN="https://$AX_GATEWAY_IP$([ "$GW_PORT" = 443 ] && echo '' || echo ":$GW_PORT")"
# 注意：租户的 --cors 白名单不在这里设。它由 axiomics-tenant 从
# bin/axiomics-gateway-ips 取，非 443 的实例在执行 `add` 时用
#   AX_CORS_ORIGIN=https://<ip>:<端口> axiomics-tenant add ...
# 传入（deploy.sh 的变量传不到调用方的 shell，写在这里只会变成死变量）。

# bun 要按**绝对路径**解析。它通常只装在 ~/.bun/bin，靠交互 shell 的 profile 进
# PATH —— 而从 systemd / cron / sudo / 别的用户跑 deploy.sh 时 PATH 只有
# /usr/local/bin:/usr/bin，`bun` 会 "command not found"。那一刻前面的文件已经装完、
# 容器已经起来，留下一个"半部署"状态：网关在跑，但激活器与模型代理没起，
# 表现是登录后所有租户请求 502，而日志里只有一句 command not found。
BUN="${AX_BUN:-$(command -v bun || true)}"
[ -x "$BUN" ] || for c in "$HOME/.bun/bin/bun" /usr/local/bin/bun /usr/bin/bun; do
  [ -x "$c" ] && { BUN="$c"; break; }
done
[ -x "$BUN" ] || { echo "找不到 bun —— 用 AX_BUN=/绝对/路径/bun 指定后重跑" >&2; exit 1; }

# 宿主 shell 可能设了 http_proxy（本机就是 127.0.0.1:10808 的梯子反代）。
# Bun 在**进程启动时**固定代理配置；没有 no_proxy 时，激活器连租户的
# http://127.0.0.1:42xxx/global/health 也会被送进代理 → 每个租户都判 TIMEOUT →
# 网关对所有用户 503。实测过：同一份代码、同一台机器，加不加 no_proxy 分别是
# 503 与 200。这里保留宿主已有的 no_proxy 条目，只补上回环。
AX_NO_PROXY="${NO_PROXY:-${no_proxy:-}}"
case ",$AX_NO_PROXY," in
  *,127.0.0.1,*) ;;
  *) AX_NO_PROXY="127.0.0.1,localhost${AX_NO_PROXY:+,$AX_NO_PROXY}" ;;
esac

say() { printf '\n── %s\n' "$1"; }

# ── 目录 ─────────────────────────────────────────────────────────────
mkdir -p "$AX_ROOT"/{bin,ca,auth,gateway,logs,secrets,tenants}
chmod 0700 "$AX_ROOT/secrets"
touch "$AX_ROOT/tenants.map"

# ── Authelia 配置：缺就生成 ──────────────────────────────────────────
# 从零部署时这两个文件必须由**这里**创建。早先 deploy.sh 只检查
# users_database.yml 是否存在、缺了就让你去跑 idp-add，而 idp-add open() 的正是
# 这个文件 —— 互相要求对方先存在，从零部署是一条死路（实测 FileNotFoundError）。
say "准备 Authelia 配置"
if [ ! -f "$AX_USERS_FILE" ]; then
  install -m 0600 "$HERE/auth/users_database.yml.tmpl" "$AX_USERS_FILE"
  echo "  已创建空用户库（待 idp-add 写入用户）"
fi
if [ ! -f "$AX_ROOT/auth/portless.yml" ]; then
  sed -e "s|__AUTHELIA_ADDR__|$AUTHELIA_ADDR|g" \
      -e "s|__JWT_SECRET__|$(openssl rand -hex 32)|g" \
      -e "s|__SESSION_SECRET__|$(openssl rand -hex 32)|g" \
      -e "s|__ENCRYPTION_KEY__|$(openssl rand -hex 32)|g" \
      "$HERE/auth/portless.yml.tmpl" >"$AX_ROOT/auth/portless.yml"
  chmod 0600 "$AX_ROOT/auth/portless.yml"
  echo "  已生成 portless.yml（三个密钥随机生成）"
fi

# ── 运行时文件 ───────────────────────────────────────────────────────
say "安装运行时文件到 $AX_ROOT"
install -m 0755 "$HERE/bin/axiomics-tenant" "$AX_ROOT/bin/axiomics-tenant"
install -m 0755 "$HERE/bin/axiomics-usage"  "$AX_ROOT/bin/axiomics-usage"
install -m 0755 "$HERE/bin/axiomics-audit"  "$AX_ROOT/bin/axiomics-audit"
# axiomics-tenant 在**运行时**调它取 CORS 白名单，不是可选的：漏装的后果是
# 每个子命令都静默退出 127、零输出（详见 axiomics-tenant 里那段注释）。
install -m 0755 "$HERE/bin/axiomics-gateway-ips" "$AX_ROOT/bin/axiomics-gateway-ips"
install -m 0644 "$HERE/bin/axiomics-activator.ts"   "$AX_ROOT/bin/axiomics-activator.ts"
install -m 0644 "$HERE/bin/axiomics-model-proxy.ts" "$AX_ROOT/bin/axiomics-model-proxy.ts"
install -m 0755 "$HERE/entrypoint.sh" "$AX_ROOT/entrypoint.sh"
install -m 0644 "$HERE/Caddyfile"     "$AX_ROOT/Caddyfile"
ls -1 "$AX_ROOT/bin"

# 案例存储切片：装配自 tooling/acceptance-cases/export-case-slice.ts。
# 注入每个租户后，案例回放在任何租户里都能打开（零前端改动，见 README）。
SLICE="$HERE/../acceptance-cases/case-slice"
if [ -d "$SLICE/storage" ]; then
  rm -rf "$AX_ROOT/case-slice"
  mkdir -p "$AX_ROOT/case-slice"
  cp -a "$SLICE/." "$AX_ROOT/case-slice/"
  echo "  案例切片已装入 $AX_ROOT/case-slice"
else
  echo "  （无案例切片：$SLICE 不存在，案例回放将不可用）"
fi

# ── 密钥 ─────────────────────────────────────────────────────────────
# 绝不能把密钥写成 podman 的 -e：那样任何能跑 `podman inspect` 或 `ps` 的人
# 都能读到明文。模型代理原生支持 AX_KEY_FILE，用文件。
if [ ! -f "$KEY_FILE" ]; then
  say "缺少 $KEY_FILE"
  echo "  请写入模型网关的真实密钥，然后重跑："
  echo "    install -m 0600 /dev/stdin '$KEY_FILE' <<< '<你的密钥>'"
  exit 1
fi
chmod 0600 "$KEY_FILE"
[ -s "$KEY_FILE" ] || { echo "$KEY_FILE 为空" >&2; exit 1; }

# ── 首个 IdP 用户 ────────────────────────────────────────────────────
# Authelia **不接受空用户库** —— 启动校验直接 fatal（实测原文：
#   error reading the authentication database: could not validate the schema:
#   users: non zero value required
# ）。所以从零部署必须先有一个用户；而用户只能由 axiomics-tenant 写入。
# 这就是 deploy.sh 必须能自己建用户的理由，否则又是"互相等对方先存在"。
# 已有用户的部署（重复执行）自动跳过；口令只经环境变量传入，不会出现在日志里。
# 少了 PyYAML 时，下面那句会以非零退出，看起来和"用户库为空"一模一样，于是
# 报错把人引向"加个用户"而不是"装依赖"。先单独验一次。
python3 -c 'import yaml' 2>/dev/null || {
  echo "缺少 PyYAML：deploy.sh 与 axiomics-tenant 都用它读写 Authelia 的用户库。" >&2
  echo "  dnf install -y python3-pyyaml   或   pip3 install pyyaml" >&2
  exit 1
}
if ! python3 -c 'import sys,yaml;d=yaml.safe_load(open(sys.argv[1])) or {};sys.exit(0 if d.get("users") else 1)' "$AX_USERS_FILE"; then
  if [ -n "${AX_IDP_USER:-}" ]; then
    [ -n "${AX_IDP_PASS:-}" ] || { echo "AX_IDP_USER 已设但缺少 AX_IDP_PASS" >&2; exit 1; }
    say "创建首个 IdP 用户：$AX_IDP_USER"
    "$AX_ROOT/bin/axiomics-tenant" idp-add "$AX_IDP_USER" "$AX_IDP_PASS"
  else
    say "Authelia 用户库为空，无法启动"
    echo "  Authelia 拒绝空用户库。带上首个用户重跑："
    echo "    AX_IDP_USER=<用户名> AX_IDP_PASS='<口令>' $0"
    exit 1
  fi
fi

# ── 证书 ─────────────────────────────────────────────────────────────
[ -f "$AX_ROOT/ca/server.crt" ] || { echo "缺 $AX_ROOT/ca/server.crt —— 先跑 image/build.sh" >&2; exit 1; }

# ── Authelia：域名与 cookie domain 覆盖全部内网 IP ───────────────────
# 少一个 IP 的表现是 HTTP 400，原文 "no configured session cookie domain matches"——
# 和"网络不通"长得完全不一样，但同样是客户端进不来。这里幂等地补齐。
IPS="$( { echo "$AX_GATEWAY_IP"; "$HERE/bin/axiomics-gateway-ips"; } | awk 'NF' | sort -u )"
python3 - "$AX_ROOT/auth/portless.yml" "$GW_PORT" $IPS <<'PY'
import sys, yaml
path, port, *ips = sys.argv[1:]
# 非 443 实例必须把端口写进 authelia_url，否则登录后会被送回 443 上的另一套部署。
suffix = "" if port == "443" else f":{port}"
d = yaml.safe_load(open(path))
d.setdefault("access_control", {})["rules"] = [{"domain": ips, "policy": "one_factor"}]
d.setdefault("session", {})["cookies"] = [
    {"domain": ip, "authelia_url": f"https://{ip}{suffix}/auth"} for ip in ips
]
yaml.safe_dump(d, open(path, "w"), allow_unicode=True, sort_keys=False)
print(f"  Authelia 域名与 cookie domain：{len(ips)} 个 IP（端口 {port}）")
PY

# 三张映射表由 tenants.map 渲染（见 axiomics-tenant 的 render_maps）。全新部署时
# 还没有任何租户，这三个 import 文件**并不存在** —— 而 Caddy 的 import 指向不存在的
# 文件是**适配期致命错误**：网关会启动后几十毫秒就退出（实测 ExitCode=1，容器日志里
# 甚至没有一行错误）。所以这里先建空文件；第一条租户创建时会被正式渲染覆盖。
# 实测空文件与纯注释文件都能通过 `caddy validate`。
for m in tenants upstreams tokens; do
  [ -f "$AX_ROOT/gateway/$m.caddy" ] || : >"$AX_ROOT/gateway/$m.caddy"
done

# ── 网关 + Authelia ──────────────────────────────────────────────────
say "启动 Authelia 与网关"
# 默认重建容器（配置文件/证书变了要生效）。AX_KEEP_CONTAINERS=1 时只补单元、
# 不动容器 —— 在生产上"补装开机自恢复"用，避免几秒钟的网关中断。
if [ "${AX_KEEP_CONTAINERS:-false}" = "true" ]; then
  echo "  保留现有容器（AX_KEEP_CONTAINERS=true）"
else
  podman rm -f "$AUTHELIA_NAME" "$GATEWAY_NAME" >/dev/null 2>&1 || true

# Authelia 的 server.address 带 /auth 前缀，配置在 auth/portless.yml
podman run -d --name "$AUTHELIA_NAME" --network=host \
  -v "$AX_ROOT/auth:/config" \
  ghcr.io/authelia/authelia:latest --config /config/portless.yml >/dev/null

# 网关：密钥不进命令行，模型代理从 AX_KEY_FILE 读。
# 监听地址与上游全部经环境变量传入（Caddyfile 里写成 {$VAR:默认}），默认即生产值，
# 所以常规部署与以前逐字等价；验证实例则可以把整套地址挪开。
podman run -d --name "$GATEWAY_NAME" --network=host \
  -e AX_GW_ADDR="$GW_ADDR" \
  -e AX_MODEL_ADDR="$MODEL_ADDR" \
  -e AX_CADDY_ADMIN="$CADDY_ADMIN" \
  -e AX_AUTH_ADDR="$AUTH_ADDR" \
  -e AX_ACTIVATOR_ADDR="$ACTIVATOR_ADDR" \
  -e AX_MODEL_PROXY_ADDR="$MODEL_PROXY_ADDR" \
  -v "$AX_ROOT/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v "$AX_ROOT/ca:/certs:ro" \
  -v "$AX_ROOT/gateway:/etc/caddy/maps:ro" \
  -v "$AX_ROOT/tenants:/srv/ax/tenants:ro" \
  -v "$AX_ROOT/logs:/var/log/caddy" \
  docker.io/library/caddy:2 >/dev/null
fi


# ── 宿主侧服务：systemd 用户单元 ─────────────────────────────────────
# 为什么从 nohup 改成单元：nohup 起的进程**重启机器后不会自己回来**，而激活器不
# 回来就意味着所有被回收的租户永远无法唤醒（网关一直 503），且没有任何东西会报错。
say "安装 systemd 用户单元（开机自恢复）"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$UNIT_DIR"

# 用户级单元默认只在**登录时**运行。没有 linger，重启后这些单元根本不会被执行 ——
# 单元写得再对也没用。这一步是"重启自恢复"的前提。
if [ "$(loginctl show-user "$(id -un)" -p Linger 2>/dev/null || true)" != "Linger=yes" ]; then
  loginctl enable-linger "$(id -un)" 2>/dev/null \
    || echo "  警告: 无法开启 linger —— 重启后服务不会自动回来。需管理员执行：loginctl enable-linger $(id -un)" >&2
fi

render_unit() {
  sed -e "s|__AX_ROOT__|$AX_ROOT|g" \
      -e "s|__AX_REQUIRE_MOUNT__|$AX_REQUIRE_MOUNT|g" \
      -e "s|__BUN__|$BUN|g" \
      -e "s|__NO_PROXY__|$AX_NO_PROXY|g" \
      -e "s|__UNIT_PREFIX__|$AX_UNIT_PREFIX|g" \
      -e "s|__AUTHELIA__|$AUTHELIA_NAME|g" \
      -e "s|__GATEWAY__|$GATEWAY_NAME|g" \
      -e "s|__ACTIVATOR_PORT__|$ACTIVATOR_PORT|g" \
      -e "s|__MODEL_PORT__|$MODEL_PORT|g" \
      -e "s|__MODEL_UPSTREAM__|${AX_MODEL_UPSTREAM:-https://api.deepseek.com}|g" \
      "$1" >"$2"
}

for u in authelia gateway activator model-proxy; do
  render_unit "$HERE/systemd/axiomics-$u.service.tmpl" "$UNIT_DIR/$AX_UNIT_PREFIX-$u.service"
done
render_unit "$HERE/systemd/axiomics-reclaim.service" "$UNIT_DIR/$AX_UNIT_PREFIX-reclaim.service"
render_unit "$HERE/systemd/axiomics-reclaim.timer"   "$UNIT_DIR/$AX_UNIT_PREFIX-reclaim.timer"

# 迁移：nohup 时代的进程还占着端口，单元起不来。
# 模式里必须带上 $AX_ROOT —— 否则在同一台机器上起第二套隔离实例时，
# 这一句会把**生产那套**的激活器/模型代理一起杀掉。
pkill -f "$AX_ROOT/bin/axiomics-activator\.ts" 2>/dev/null || true
pkill -f "$AX_ROOT/bin/axiomics-model-proxy\.ts" 2>/dev/null || true
sleep 1

systemctl --user daemon-reload
# 用 enable --now 而不是 restart：已 active 的单元保持不变，**不会**触发容器的
# ExecStop/ExecStart（那会让网关停两三秒）。bun 服务被上面的 pkill 杀掉后由
# Restart=always 自动拉起；容器单元在首次安装时由 --now 执行 podman start，
# 已运行则是一次幂等的 no-op。
systemctl --user enable --now \
  "$AX_UNIT_PREFIX-authelia.service" \
  "$AX_UNIT_PREFIX-gateway.service" \
  "$AX_UNIT_PREFIX-activator.service" \
  "$AX_UNIT_PREFIX-model-proxy.service"
systemctl --user enable --now "$AX_UNIT_PREFIX-reclaim.timer" >/dev/null

# ── 自检 ─────────────────────────────────────────────────────────────
say "自检"
sleep 5
printf '  Authelia   %s\n' "$(podman ps --filter "name=^${AUTHELIA_NAME}$" --format '{{.Status}}')"
printf '  网关       %s\n' "$(podman ps --filter "name=^${GATEWAY_NAME}$" --format '{{.Status}}')"
printf '  激活器     %s\n' "$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' --max-time 4 "http://$ACTIVATOR_ADDR/health" || echo 未响应)"
printf '  模型代理   %s\n' "$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' --max-time 4 "http://$MODEL_PROXY_ADDR/health" || echo 未响应)"
printf '  网关 TLS   %s\n' "$(curl -sk -o /dev/null -w '%{http_code}' --noproxy '*' --max-time 4 "$GW_ORIGIN/" || echo 未响应)"
printf '  开机自启   linger=%s\n' "$(loginctl show-user "$(id -un)" -p Linger 2>/dev/null | cut -d= -f2)"
for u in authelia gateway activator model-proxy; do
  printf '  %-10s %s / %s\n' "$u" \
    "$(systemctl --user is-enabled "$AX_UNIT_PREFIX-$u.service" 2>/dev/null || echo '?')" \
    "$(systemctl --user is-active  "$AX_UNIT_PREFIX-$u.service" 2>/dev/null || echo '?')"
done

cat <<EOF

完成。日常操作：
  $AX_ROOT/bin/axiomics-tenant add <用户名> <GPU编号>   开通
  $AX_ROOT/bin/axiomics-tenant retire <租户ID>          注销
  $AX_ROOT/bin/axiomics-tenant list                     看状态
  $AX_ROOT/bin/axiomics-usage                           用量
  $AX_ROOT/bin/axiomics-audit                           审计

开机自恢复：Authelia / 网关 / 激活器 / 模型代理 都由 systemd 用户单元拉起，
回收 timer 同理由 systemd 管理。前提是 linger 已开启（上面自检最后一行应为 yes）。
租户容器**故意不设开机自启**：回收本来就是"空闲即停"，重启后由激活器在下一个
认证请求时按需拉起（实测 ~1 秒），不会与回收策略冲突。
EOF
