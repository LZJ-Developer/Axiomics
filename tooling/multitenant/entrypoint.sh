#!/bin/sh
# TCP relay：axiomics 只绑 loopback（server.ts 里 hostname 是硬编码的），
# 端口发布打到容器 eth0，够不到 127.0.0.1，所以需要一层中转。
#
# 用 socat 而不是 ncat：ncat 的 `-l --keep-open --sh-exec` 每个连接都会留下
# 一个不退出、且仍持有继承来的监听 socket 的子进程；实测攒到 100 个后
# listener 停止 accept，租户整个失联，只能重启容器才恢复。
# socat 的 fork 模型每个连接一个进程、处理完即退出。
#
# 项目 Python 层的补齐已移到宿主侧（见 axiomics-tenant sweep），
# 原因是容器内的 sleep 循环会污染"是否有工作在跑"的进程判据。
socat TCP-LISTEN:8080,fork,reuseaddr TCP:127.0.0.1:4096 &
exec /usr/local/bin/axiomics "$@"
