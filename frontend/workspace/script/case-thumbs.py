#!/usr/bin/env python3
"""生成案例封面缩略图。

画廊卡片把三张图排进约 380×300 的格子里，却一直用原图：八张卡片一次拉
8.6MB，最重的一张 2.7MB。缩略图放到 760px 宽（约等于最大显示尺寸的两倍，
够 2× 屏），单个通常 20–60KB。

产物写到 `public/cases/thumbs/<名字>.webp`；画廊按同名规则取用，
`src/pages/cases/thumbs.test.ts` 会检查每个案例封面都有对应缩略图。

重跑（改了或新增案例配图之后）：

    python3 frontend/workspace/script/case-thumbs.py
    python3 frontend/workspace/script/case-thumbs.py --check   # 只检查缺失/过期
"""

from __future__ import annotations

import io
import sys
from pathlib import Path

from PIL import Image

CASE_DIR = Path(__file__).resolve().parents[1] / "public" / "cases"
OUT_DIR = CASE_DIR / "thumbs"
WIDTH = 760
QUALITY = 82
SUFFIXES = {".png", ".jpg", ".jpeg"}


def sources() -> list[Path]:
    return sorted(p for p in CASE_DIR.iterdir() if p.suffix.lower() in SUFFIXES and p.is_file())


def target(path: Path) -> Path:
    return OUT_DIR / (path.stem + ".webp")


def render(path: Path) -> tuple[Path, int, int]:
    out = target(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(path) as source:
        # 带透明的图（部分图表有白底之外的空隙）保留 alpha，其余走 RGB，
        # WebP 两种情况都支持。
        alpha = source.mode in ("RGBA", "LA") or "transparency" in source.info
        original = source.convert("RGBA" if alpha else "RGB")
        scaled = original
        if original.width > WIDTH:
            height = round(original.height * WIDTH / original.width)
            scaled = original.resize((WIDTH, height), Image.LANCZOS)

        # 四个候选里挑最小的：缩放的/原尺寸的 × 有损/无损。两条经验：
        #   · 色块平涂的图（散点、汇总条）无损远胜有损；
        #   · 这类图缩放后重采样反而更难压 —— stamo-domains 原尺寸无损 23KB，
        #     缩到 760 后无损 488KB。所以"原尺寸"必须留在候选里。
        best = b""
        for image in (scaled, original):
            for options in ({"quality": QUALITY}, {"lossless": True}):
                buffer = io.BytesIO()
                image.save(buffer, "WEBP", method=6, **options)
                data = buffer.getvalue()
                if not best or len(data) < len(best):
                    best = data
        out.write_bytes(best)
    return out, path.stat().st_size, out.stat().st_size


def main() -> int:
    check = "--check" in sys.argv
    files = sources()
    if not files:
        print(f"没有找到配图：{CASE_DIR}")
        return 1

    stale = [
        p
        for p in files
        if not target(p).is_file() or target(p).stat().st_mtime < p.stat().st_mtime
    ]

    if check:
        if stale:
            print("缺少或过期的缩略图（重跑本脚本生成）：")
            for p in stale:
                print(f"  {p.name} → {target(p).relative_to(CASE_DIR)}")
            return 1
        print(f"缩略图齐全：{len(files)} 个")
        return 0

    before = after = 0
    for path in files:
        out, src_size, out_size = render(path)
        before += src_size
        after += out_size
        print(f"  {path.name:44} {src_size / 1024:8.0f}KB → {out_size / 1024:7.1f}KB")
    print(f"合计 {before / 1024 / 1024:.1f}MB → {after / 1024:.0f}KB（{len(files)} 张）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
