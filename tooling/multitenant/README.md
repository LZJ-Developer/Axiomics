# 多租户部署

把 Axiomics 作为内网多用户 Web 服务跑起来：**一名用户一个容器**。

设计与论证见 [`docs/多租户实施方案.md`](../../docs/多租户实施方案.md)，
日常操作与排障见 [`docs/多租户运维手册.md`](../../docs/多租户运维手册.md)。
本目录是**实现**；那两份是**为什么这么做**和**出问题怎么办**。

## 组成

```
image/Containerfile     租户镜像（含两条禁令，见文件内注释）
image/build.sh          重建镜像：证书 → 二进制 → 镜像
deploy.sh               装到 AX_ROOT 并拉起全部服务（含 systemd 单元）
entrypoint.sh           容器入口：relay（socat）
Caddyfile               网关：Authelia forward_auth → 按身份路由到租户
auth/*.tmpl             Authelia 配置模板（从零部署时由 deploy.sh 生成）
bin/axiomics-tenant     租户生命周期：add / retire / list / start / reclaim / sweep / idp-add / idp-del
bin/axiomics-activator.ts  按需激活：被回收的租户在下一个认证请求时被拉起
bin/axiomics-model-proxy.ts 模型网关：按占位符识别租户、换成真密钥、记账
bin/axiomics-usage      用量报表
bin/axiomics-audit      审计报表
bin/axiomics-verify     部署自检：一次跑完 15 项断言
systemd/*.service.tmpl  开机自恢复单元（Authelia / 网关 / 激活器 / 模型代理）
systemd/axiomics-reclaim.*  回收 timer
```

## 从零部署

```bash
export AX_ROOT=/srv/axiomics
# $AX_ROOT 必须由**执行部署的这个用户**可写。Rocky/CentOS 的 /srv 默认 root 所有，
# 非 root 部署请先 sudo install -d -o "$USER" /srv/axiomics，或把 AX_ROOT 指到
# 自己的目录（例如持久盘上）。

# 0. 依赖（非 root）
#   bun                构建二进制；激活器与模型代理也由它跑
#   podman ≥ 4          rootless 容器
#   openssl             内部 CA 与证书
#   python3 + PyYAML   deploy.sh 与 axiomics-tenant 用它读写 Authelia 的 YAML 用户库
#   curl                自检
# dnf install -y podman openssl python3-pyyaml      # 发行版包名可能不同
# bun 见 https://bun.sh
# 镜像（rockylinux:9 / caddy:2 / authelia:latest）与依赖包都要能拉取；
# 隔离网络请先在可出网的机器上备好。

# 1. 宿主前置（root，需持久化）
sudo tee /etc/sysctl.d/99-axiomics.conf <<'EOF'
net.ipv4.ip_unprivileged_port_start = 443
kernel.dmesg_restrict = 1
EOF
sudo sysctl --system

# 2. 密钥：写文件，不要写进 podman -e（否则 podman inspect / ps 都能读到）
install -d -m 0700 $AX_ROOT/secrets
install -m 0600 /dev/stdin $AX_ROOT/secrets/deepseek.key <<< '<模型网关真实密钥>'

# 3. 重建镜像（会自己生成内部 CA 与服务证书）
./image/build.sh

# 4. 装并拉起（必须带首个 IdP 用户：Authelia 不接受空用户库）
AX_IDP_USER=alice AX_IDP_PASS='<口令>' ./deploy.sh

# 5. 开通第一个租户（IdP 账号已在上一步创建）
$AX_ROOT/bin/axiomics-tenant add alice 0
```

`deploy.sh` 可在任意一步重复执行：已存在的配置不覆盖，缺的补上。

### 两个和机器有关的参数

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `AX_SHARED_ENVS` | `$AX_ROOT/envs` | 共享工具链根（只读挂进每个租户）。部署时写进 `$AX_ROOT/shared-envs-root`，之后跑 `axiomics-tenant` 不必每次带。Python / R 子目录从它派生 |
| `AX_REQUIRE_MOUNT` | 自动解析 `AX_ROOT` 的挂载点 | 单元启动前要求该挂载点真的挂着。`AX_ROOT` 在 rootfs 上（解析结果为 `/`）时自动留空，只查目录是否存在 |

两者都默认按 `AX_ROOT` 推导，**源码里不出现任何具体机器的盘符或路径**。

## 验收：一条命令

```bash
$AX_ROOT/bin/axiomics-verify          # 只读：不启动容器，不打模型额度
$AX_ROOT/bin/axiomics-verify --deep   # 额外验模型网关会不会放行伪造租户（仍不产生真实调用）
```

断言覆盖五层：网关 302 与 Authelia 门户、每个租户的三态令牌矩阵（自己 200 / 无令牌 401 /
他人令牌 401）、案例切片产物可读（记录 + `/raw` 字节）、模型代理的拒绝行为、
systemd 单元与 linger。失败时直接指出是哪一层，不用对着浏览器猜。

## 换一个站点要改什么

整套组件没有任何写死的机器路径或地址，站点差异**全部收敛在这些输入上**：

| 输入 | 变量 / 方式 | 说明 |
| --- | --- | --- |
| 站点根 | `AX_ROOT` | 部署机上的持久目录；`/srv/axiomics` 只是默认值 |
| 共享工具链 | `AX_SHARED_ENVS` | 只读挂进每个租户；部署时写入 `$AX_ROOT/shared-envs-root`，之后不必每次带 |
| 网关地址与证书 | `AX_GATEWAY_IP` / `AX_GATEWAY_IPS` / `AX_GW_ADDR` | 证书 SAN、Authelia cookie 域、租户 CORS 三处都从这一个清单派生 |
| 认证入口 | `AX_AUTHELIA_ADDR` | 默认 `127.0.0.1:9091`，只该留 loopback；跨机才有理由改 |
| 租户端口段 | `AX_PORT_BASE` | 默认 42100 起，只发布到 loopback |
| 模型上游 | `AX_MODEL_UPSTREAM` + `$AX_ROOT/secrets/deepseek.key` | 换模型供应商只改这两处 |
| 包镜像源 | `AXIOMICS_PIP_INDEX_URL` / `AXIOMICS_PIP_TRUSTED_HOST` / `AXIOMICS_CRAN_MIRROR` | 建租户时从环境透传。pip 认 `PIP_INDEX_URL`（内网 http 镜像另需 `AXIOMICS_PIP_TRUSTED_HOST`）；R 没有对应环境变量，平台把它写成项目级 `Rprofile` 并用 `R_PROFILE_USER` 指过去。不设即走官方源 |
| 终端 | `AX_TERMINAL_DISABLED`（写入 `AXIOMICS_DISABLE_TERMINAL`） | 租户默认 `1`：后端 `/pty` 一律 403，前端不渲染入口、命令与面板（含持久化恢复）。需要排障的站点设 `0` 重建租户即可恢复 |
| GPU 分配 | `axiomics-tenant add <用户> --gpu N` | 每租户直通一张卡；N 从 0 起 |
| 案例切片 | `AX_CASE_SLICE` | 可选。没有切片时回放不可用，其余功能不受影响 |

部署顺序、宿主前置、镜像构建见上一节；换站点时**只需要重新填这张表**，代码不用动。

## 已知失败模式（都是实测踩过的）

| 现象 | 真因 | 处理 |
| --- | --- | --- |
| 本机 `curl 127.0.0.1:421xx` 一律 503 | 走了本机 HTTP 代理（`~/.curlrc` 或环境变量） | 加 `--noproxy '*'`；`axiomics-verify` 已内置 |
| `axiomics-gateway-ips` 只输出 `127.0.0.1`，`add` 随即以 127 退出 | PATH 里没有 `/sbin`，`ip` 找不到 | `export PATH=/usr/sbin:/sbin:$PATH` |
| `add` 报 `value too great for base` | 租户号带前导零，bash 按八进制解析 | 已修（`10#$n`）；第 8 个租户之前不会暴露 |
| 回放里 Results 卡片点开 404 | 切片只带 storage，没带 artifact-store | 已修（导出器 + `seed-cases` 都补上） |
| 卡片仍在、某些租户 404 | 产物按**当前项目**取，请求没带 `?project=` 或 `x-axiomics-project` | 前端会自动带；手写 curl 要自己加 |
| 随便编 `tenant-u9999` 也能调模型 | 只校验占位符格式，不对照租户清单 | 已修（对照 `tenants.map`，未知名一律 401） |
| 浏览器"隐私错误"，`curl` 返回 000 | 自签证书 | 浏览器点"继续"，`curl` 加 `-k` |
| 改 `auth/configuration.yml` 不生效 | 容器实际加载的是 `/config/portless.yml` | 改 `portless.yml` 再 `podman restart ax-authelia` |
| 租户过一阵子访问 502 | 空闲 20 分钟被回收，激活器正在拉起 | 属预期；别给租户加 `--restart=always`，会与回收打架 |
| agent 装完包，下一条命令 `import` 不到 | 旧镜像：Bash 的最终进程边界按白名单重建 env，丢掉 `PIP_TARGET`/`PYTHONPATH`，包目录又只被授予读 | 已修（运行时键找回 + 安装命令走 `environment_mutation` 授权）；重建镜像后租户冷启动即生效 |
| 共享环境里的 `python` 报 `No module named 'encodings'` | 沙箱只从 PATH 授予了 `<env>/bin`，站点自建的 `<env>` 根（stdlib 所在）没被授予 | 已修（Bash 显式把共享解释器根加入可读面）；`<data>/conda/envs/…` 本来就有专门规则，不受影响 |

## 开机自恢复

Authelia、网关、激活器、模型代理都由 **systemd 用户单元**托管
（`axiomics-authelia / gateway / activator / model-proxy .service`），
回收由 `axiomics-reclaim.timer` 驱动。`deploy.sh` 会安装并启用它们。

前提是**用户 linger 已开启**，否则用户级单元只在登录时运行、重启后不会执行：

```bash
loginctl show-user "$USER" -p Linger   # 期望 Linger=yes
loginctl enable-linger "$USER"         # 未开启时执行（deploy.sh 也会尝试）
```

租户容器**故意不设开机自启**：回收策略本来就是"空闲即停"，重启后由激活器在
下一个认证请求时按需拉起（实测冷启动约 1 秒，审计里记为 `woken:true`）。
若给租户加 `--restart=always`，会与回收策略直接冲突。

在生产上补装/更新单元而不想中断网关时，加 `AX_KEEP_CONTAINERS=true`：
只重装单元、不重建容器。

## 再起一套隔离实例（用于验证/暂存）

容器名、单元名、监听地址与端口都可覆盖，默认值即生产值。把整套错开即可在同一台
机器上并存：

```bash
export AX_ROOT=/srv/axiomics-verify
export AX_NAME_SUFFIX=-stage AX_UNIT_PREFIX=axiomics-stage
export AX_GATEWAY_IP=127.0.0.2 AX_GATEWAY_IPS=127.0.0.2
export AX_GW_ADDR=127.0.0.2:8443 AX_MODEL_ADDR=127.0.0.2:13001
export AX_CADDY_ADMIN=127.0.0.1:12019          # 必须留在 127.0.0.1，端口可换
export AX_AUTHELIA_ADDR=127.0.0.2:19091 AX_AUTH_ADDR=127.0.0.2:19091
export AX_ACTIVATOR_PORT=19300 AX_MODEL_PORT=14302
AX_GATEWAY_IPS=127.0.0.2 AX_CERTS_ONLY=true ./image/build.sh   # 镜像已在时不重建
install -d -m 0700 $AX_ROOT/secrets
install -m 0600 /dev/stdin $AX_ROOT/secrets/deepseek.key <<< '<密钥>'
AX_IDP_USER=alice AX_IDP_PASS='<口令>' ./deploy.sh
AX_PORT_BASE=43100 AX_CORS_ORIGIN=https://127.0.0.2:8443 \
  $AX_ROOT/bin/axiomics-tenant add alice 0
```

`AX_CADDY_ADMIN` 不能写成 `127.0.0.x:端口`：Caddy 的管理端只接受 localhost 作为
Host，否则 `caddy reload` 返回 `403 host not allowed`，租户增删后网关不重载。


## 五条容易踩的

1. **宿主 shell 若设了 `http_proxy`，本机 curl 要带 `--noproxy '*'`。**
   Bun 在**进程启动时**固定代理配置（测试 preload 里删环境变量无效，见
   `tooling/repo/test.ts`）。`deploy.sh` 会为它启动的服务补上
   `no_proxy=127.0.0.1,localhost` —— 少了这一条，激活器会把对租户
   `127.0.0.1:42xxx` 的健康检查送进代理，每个租户都判 TIMEOUT，全体 503。

2. **服务证书的 SAN、Authelia 的域名、租户的 `--cors` 必须覆盖本机全部内网 IP。**
   这类机器通常同时挂着多个网段，客户端经 VPN 进来时落在哪一段由**网络侧**决定 ——
   我们这边看不出来。只配一个 IP 的三种表现各不相同、都不像"配置问题"：

   | 缺哪处                 | 客户端看到                                                  |
   | ---------------------- | ----------------------------------------------------------- |
   | 证书 SAN               | 浏览器证书告警（容易被当成"网络不通"）                      |
   | Authelia cookie domain | **HTTP 400**，`no configured session cookie domain matches` |
   | 租户 `--cors`          | 能登录，但登录后页面接口全被 CORS 挡掉                      |

   三处的 IP 清单统一取自 `bin/axiomics-gateway-ips`（一处实现，避免改一处漏一处 ——
   曾经漏过容器网桥的过滤，把 docker0 的 `192.0.2.74` 混进了 CORS 列表）。
   换 IP 后要 `AX_REGEN_CERTS=1 ./image/build.sh` 重签证书，否则 SAN 里还是旧地址。

   **诊断顺序**：客户端连不上时，先看 `logs/access.log` 里有没有它的 `remote_ip` ——
   一条都没有就说明包根本没到服务器，问题在客户端或网络，不在部署。

3. **不要给租户容器加 `--cap-add`。** 任何 capability 都会让 bwrap 拒绝启动，
   沙箱随即不可用，所有命令与本地算力被拒。代价是容器内不能跑 strace，观测改用 `/proc`。
   `podman build` 同理要 `--http-proxy=false`（`build.sh` 已加）：否则构建会继承宿主代理，
   代理一断就死在 `dnf`，而报错指向 `mirrors.rockylinux.org`，极易误判成镜像源问题。
4. **契约数据不要放 `/tmp`。** `/tmp` 会被清理；`AX_ROOT` 应在持久盘上。

5. **唯一入口是 `/axiomics`，但根路径必须留着。** `Caddyfile` 里那条
   `@root path / → /axiomics` 只匹配**精确的根路径**。这一条不能改成整体重定向：
   SPA 的资源是根路径绝对引用（`<script src="/assets/…">`、`/axiomics-theme-preload.js`），
   应用内的深链也在根路径下（`/prj_…/session/…`）。把根路径整体跳走 = 取资源也跳走 =
   白屏。要让一切都待在 `/axiomics/` 下，必须把前端**以 `/axiomics/` 为 base 重新构建**，
   那是前端改动，不是网关配置能解决的。

   改网关的**指令顺序**后，`caddy reload` 实测不生效（返回成功但路由不变），
   **重启 `ax-gw` 才生效**。改完务必用 `curl` 复验，别只看 reload 没报错。
