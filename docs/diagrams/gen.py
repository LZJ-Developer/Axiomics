#!/usr/bin/env python3
"""生成 docs/diagrams/ 下的两张 .drawio 图。

为什么用生成器而不是手写 XML：这两张图要跟着架构演进反复改（端口、组件、
服务器角色），手写几百行 mxCell 改一次就错一次。这里用最小 DSL 描述节点与连线，
坐标显式给出，导出成 draw.io 能直接打开的 <mxfile>。

用法：python3 docs/diagrams/gen.py
"""
import html
import os

OUT = os.path.dirname(os.path.abspath(__file__))


def esc(s):
    return html.escape(s, quote=True)


class Page:
    def __init__(self, name):
        self.name = name
        self.cells = []
        self.n = 0

    def _id(self, prefix):
        self.n += 1
        return f"{prefix}{self.n}"

    def box(self, label, x, y, w, h, fill="#dae8fc", stroke="#6c8ebf",
            dashed=False, font=12, bold=False, rounded=True):
        cid = self._id("b")
        style = (
            f"rounded={1 if rounded else 0};whiteSpace=wrap;html=1;"
            f"fillColor={fill};strokeColor={stroke};fontSize={font};"
            f"{'dashed=1;' if dashed else ''}{'fontStyle=1;' if bold else ''}"
        )
        self.cells.append(
            f'<mxCell id="{cid}" value="{esc(label)}" style="{style}" vertex="1" parent="1">'
            f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>'
        )
        return cid

    def group(self, label, x, y, w, h, fill="none", stroke="#999999", dashed=True, font=12):
        """背景分组框：只画边框与标题，不拦截子元素。"""
        cid = self._id("g")
        style = (
            "rounded=0;whiteSpace=wrap;html=1;verticalAlign=top;align=left;spacingLeft=10;"
            f"fillColor={fill};strokeColor={stroke};fontSize={font};"
            f"{'dashed=1;' if dashed else ''}"
        )
        self.cells.append(
            f'<mxCell id="{cid}" value="{esc(label)}" style="{style}" vertex="1" parent="1">'
            f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>'
        )
        return cid

    def edge(self, src, dst, label="", dashed=False, color="#1a1a1a", width=1,
             exit_xy=None, entry_xy=None):
        cid = self._id("e")
        anchors = ""
        if exit_xy:
            anchors += f"exitX={exit_xy[0]};exitY={exit_xy[1]};exitDx=0;exitDy=0;"
        if entry_xy:
            anchors += f"entryX={entry_xy[0]};entryY={entry_xy[1]};entryDx=0;entryDy=0;"
        style = (
            "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;html=1;"
            "endArrow=block;endFill=1;fontSize=11;labelBackgroundColor=#ffffff;"
            f"strokeColor={color};strokeWidth={width};{anchors}"
            f"{'dashed=1;' if dashed else ''}"
        )
        self.cells.append(
            f'<mxCell id="{cid}" value="{esc(label)}" style="{style}" edge="1" parent="1" '
            f'source="{src}" target="{dst}">'
            '<mxGeometry relative="1" as="geometry"/></mxCell>'
        )

    def text(self, label, x, y, w, h, font=12, bold=False, align="left", color="#333333"):
        cid = self._id("t")
        style = (
            "text;html=1;whiteSpace=wrap;align=%s;verticalAlign=middle;"
            f"fontSize={font};fontColor={color};{'fontStyle=1;' if bold else ''}"
        ) % align
        self.cells.append(
            f'<mxCell id="{cid}" value="{esc(label)}" style="{style}" vertex="1" parent="1">'
            f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>'
        )
        return cid

    def render(self):
        body = "\n".join("      " + c for c in self.cells)
        return (
            '<mxfile host="axiomics" type="device">\n'
            f'  <diagram id="{self.name}" name="{esc(self.name)}">\n'
            '    <mxGraphModel dx="1400" dy="900" grid="0" gridSize="10" guides="1" '
            'tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" '
            'math="0" shadow="0" adaptiveColors="auto">\n'
            "      <root>\n"
            '        <mxCell id="0"/>\n'
            '        <mxCell id="1" parent="0"/>\n'
            f"{body}\n"
            "      </root>\n"
            "    </mxGraphModel>\n"
            "  </diagram>\n"
            "</mxfile>\n"
        )


def architecture():
    p = Page("系统架构")
    p.text("Axiomics 多租户部署 · 当前架构（全部运行在 GPU 节点）",
           40, 8, 1100, 30, font=16, bold=True)

    # ── 外部 / 其他服务器 ──
    ds = p.box("api.deepseek.com\n外部模型服务", 1180, 70, 200, 60, "#ffe6cc", "#d79b00")
    web = p.box("web 服务器\n未接入 · 22/80/443 均不通", 1180, 420, 200, 60,
                "#f5f5f5", "#999999", dashed=True)
    db = p.box("数据库服务器\n未接入 · 完全不可达", 1180, 500, 200, 60,
               "#f5f5f5", "#999999", dashed=True)

    # ── 用户 ──
    br = p.box("浏览器\nhttps://<网关>/axiomics\n(无端口，单入口)", 60, 70, 220, 70,
               "#d5e8d4", "#82b366", bold=True)

    # ── 网关 ──
    gw = p.box("Caddy 网关  :443 / :43001\n容器 ax-gw · host 网络\nTLS（内部 CA）· 单入口 /axiomics",
               380, 60, 320, 80, "#dae8fc", "#6c8ebf", bold=True)

    # ── 控制面 ──
    p.group("控制面（宿主侧）", 300, 180, 740, 80, fill="#fafafa")
    au = p.box("Authelia :9091\n登录 / 会话 / cookie", 330, 200, 200, 46, "#e1d5e7", "#9673a6")
    ac = p.box("激活器 :9300\n按需拉起租户", 560, 200, 200, 46, "#fff2cc", "#d6b656")
    mp = p.box("模型代理 :43002\n识别租户 / 换真密钥 / 记账", 790, 200, 220, 46, "#fff2cc", "#d6b656")

    rec = p.box("回收 timer\n每 2 分钟 · 空闲 20 分钟停容器", 900, 300, 260, 50, "#f8cecc", "#b85450")

    # ── 租户 ──
    p.group("数据面：一人一容器（按租户隔离，独立 PID/net/fs）", 60, 380, 900, 150, fill="#fafafa")
    t1 = p.box("租户容器 ax-u0006\nrelay :8080 → axiomics :4096\nGPU 0 · 发布在 127.0.0.1:42101",
               90, 405, 300, 66, "#d5e8d4", "#82b366", bold=True)
    t2 = p.box("ax-u0008 …  × N\n同一镜像、同一套标志\n各自 data/config/cache/state",
               420, 405, 300, 66, "#d5e8d4", "#82b366")

    # ── 存储 ──
    p.group("持久化（全部在本机磁盘）", 60, 570, 900, 120, fill="#fafafa")
    st = p.box("AX_ROOT  /srv/axiomics\n租户数据 · tenants.map · 审计 / 用量账本 · 密钥(0600)",
               90, 595, 390, 60, "#ffe6cc", "#d79b00")
    env = p.box("共享工具链 51 GB\n只读挂载到每个租户（不复制）",
                520, 595, 390, 60, "#ffe6cc", "#d79b00")

    p.group("GPU 硬件", 60, 720, 900, 70, fill="#fafafa")
    gpu = p.box("4 × RTX 5090 32 GB —— 按租户 --device 分配（--gpu N）",
                90, 742, 820, 40, "#e6e6e6", "#666666")

    # ── 连线 ──
    p.edge(br, gw, "HTTPS :443", exit_xy=(1, 0.5), entry_xy=(0, 0.4))
    p.edge(gw, au, "/auth* + forward_auth", exit_xy=(0.1, 1), entry_xy=(0.3, 0))
    p.edge(gw, ac, "/ensure（每次认证后）", exit_xy=(0.4, 1), entry_xy=(0.5, 0))
    p.edge(gw, t1, "按 Remote-User 路由\nBearer <租户 token>", exit_xy=(0.75, 1), entry_xy=(0.5, 0))
    p.edge(ac, t1, "podman start", dashed=True, exit_xy=(0.5, 1), entry_xy=(0.8, 0))
    p.edge(rec, t1, "podman stop（空闲）", dashed=True, color="#b85450",
           exit_xy=(0.15, 1), entry_xy=(0.95, 0.3))
    p.edge(t1, gw, ":43001 模型请求\nBearer tenant-u0006", color="#9673a6",
           exit_xy=(0.9, 0), entry_xy=(0.95, 1))
    p.edge(gw, mp, "/model/*", exit_xy=(0.95, 1), entry_xy=(0.9, 0))
    p.edge(mp, ds, "换成真密钥", exit_xy=(1, 0.5), entry_xy=(0, 0.5))
    p.edge(t1, st, "", exit_xy=(0.3, 1), entry_xy=(0.4, 0))
    p.edge(t1, env, "只读", exit_xy=(0.7, 1), entry_xy=(0.5, 0))
    p.edge(au, st, "", exit_xy=(0.3, 1), entry_xy=(0.85, 0))
    p.edge(t1, gpu, "", exit_xy=(0.2, 1), entry_xy=(0.3, 0))
    p.edge(t2, gpu, "", exit_xy=(0.5, 1), entry_xy=(0.6, 0))
    p.edge(web, gw, "未开放", dashed=True, color="#999999", exit_xy=(0, 0.5), entry_xy=(1, 0.6))
    p.edge(db, gw, "不可达", dashed=True, color="#999999", exit_xy=(0, 0.5), entry_xy=(1, 0.8))

    # 信任边界说明
    p.text("信任边界：对外只开 443 与 43001；其余端口全部绑 127.0.0.1，用户不可见。\n"
           "隔离边界：每个租户一个容器 + 独立数据目录；容器内 bwrap 沙箱（本部署关闭审批模式）。",
           60, 810, 900, 50, font=11, color="#666666")

    return p


def request_flow():
    p = Page("请求时序")
    p.text("一次请求的完整路径：登录 → 路由 → 按需激活 → 对话/模型调用",
           40, 8, 1000, 30, font=16, bold=True)

    names = ["浏览器", "Caddy 网关", "Authelia", "激活器", "租户容器 ax-u0006", "模型代理", "DeepSeek"]
    xs = [70, 280, 490, 700, 910, 1120, 1330]
    w = 180
    hdr = []
    for n, x in zip(names, xs):
        hdr.append(p.box(n, x, 60, w, 44, "#dae8fc", "#6c8ebf", font=11, bold=True))

    top, bottom = 110, 1250
    for x in xs:
        cid = p._id("l")
        cx = x + w // 2
        geom = (
            f'<mxGeometry relative="1" as="geometry">'
            f'<mxPoint x="{cx}" y="{top}" as="sourcePoint"/>'
            f'<mxPoint x="{cx}" y="{bottom}" as="targetPoint"/>'
            f"</mxGeometry>"
        )
        p.cells.append(
            f'<mxCell id="{cid}" style="endArrow=none;dashed=1;html=1;strokeColor=#999999;" '
            f'edge="1" parent="1">{geom}</mxCell>'
        )

    def center(i):
        return xs[i] + w // 2

    y = 140

    def msg(a, b, label, dashed=False, color="#1a1a1a"):
        nonlocal y
        cid = p._id("m")
        style = (
            "endArrow=block;endFill=1;html=1;fontSize=11;labelBackgroundColor=#ffffff;"
            f"strokeColor={color};{'dashed=1;' if dashed else ''}"
        )
        p.cells.append(
            f'<mxCell id="{cid}" value="{esc(label)}" style="{style}" edge="1" parent="1">'
            f'<mxGeometry relative="1" as="geometry">'
            f'<mxPoint x="{center(a)}" y="{y}" as="sourcePoint"/>'
            f'<mxPoint x="{center(b)}" y="{y}" as="targetPoint"/>'
            f'</mxGeometry></mxCell>'
        )
        y += 40

    def note(label, x, ww):
        nonlocal y
        cid = p._id("n")
        p.cells.append(
            f'<mxCell id="{cid}" value="{esc(label)}" style="shape=note;whiteSpace=wrap;html=1;'
            f'fillColor=#fff2cc;strokeColor=#d6b656;fontSize=11;size=14;" vertex="1" parent="1">'
            f'<mxGeometry x="{x}" y="{y}" width="{ww}" height="26" as="geometry"/></mxCell>'
        )
        y += 34

    note("① 登录", 70, 300)
    msg(0, 1, "GET /axiomics")
    msg(1, 2, "forward_auth")
    msg(2, 1, "401 未登录", dashed=True)
    msg(1, 0, "302 /auth/?rd=…", dashed=True)
    msg(0, 2, "POST /auth/api/firstfactor")
    msg(2, 0, "200 + 会话 cookie", dashed=True)

    note("② 路由与按需激活", 70, 360)
    msg(0, 1, "GET /axiomics（带 cookie）")
    msg(1, 2, "forward_auth")
    msg(2, 1, "200 + Remote-User", dashed=True)
    msg(1, 3, "forward_auth /ensure")
    msg(3, 4, "已停止：podman start")
    msg(3, 4, "探活 /global/health（300ms × ≤45s）")
    msg(4, 3, "200", dashed=True)
    msg(3, 1, "200 ready（记审计 wake_ms）", dashed=True)
    msg(1, 4, "反代：Host 127.0.0.1:4096 + Bearer token")
    msg(4, 1, "SPA / API 响应", dashed=True)
    msg(1, 0, "200", dashed=True)

    note("③ 对话中的模型调用", 70, 360)
    msg(4, 1, "POST :43001/model/v1/chat/completions")
    msg(1, 5, "/model/*")
    msg(5, 6, "占位符换成真密钥")
    msg(6, 5, "上游响应 + usage", dashed=True)
    msg(5, 4, "响应（写 usage.jsonl 记账）", dashed=True)

    note("④ 空闲回收（后台，与用户请求无关）", 70, 420)
    msg(3, 4, "空闲 20 分钟：podman stop", dashed=True, color="#b85450")

    p.text("每一步都有落点：登录 → auth/db.sqlite3；激活 → logs/audit.jsonl；"
           "模型 → logs/usage.jsonl。排障时按这条链逐段核对。",
           70, y + 20, 1100, 40, font=11, color="#666666")

    return p


def main():
    arch = architecture()
    flow = request_flow()
    for page, name in [(arch, "multi-tenant-architecture.drawio"),
                       (flow, "multi-tenant-request-flow.drawio")]:
        path = os.path.join(OUT, name)
        with open(path, "w", encoding="utf-8") as f:
            f.write(page.render())
        print(f"  写入 {name}  ({len(page.cells)} 个元素)")


if __name__ == "__main__":
    main()
