#!/usr/bin/env python3
"""发布公开静态壳：GPU 摆出包，Web 自己来拉。

Why this exists: 2026-11-15 之前这一步靠一份临时脚本 /tmp/publish-shell.py，
它随重启消失；之后发壳就没有可复现的做法了。这里把它固化下来。

协议（与 Web 的 axiomics-shell-pull 对齐）:
  feed 目录里放三个文件：
    shell-<version>.tgz            打包好的 dist
    shell-<version>.tgz.manifest   `sha256  ./path` 每行一个文件
    latest.json                    {version,bundle,sha256,manifest,manifest_sha256,files,released_at}
  Web 只在 latest.json 变化时动作：下载 → 校验 bundle 与 manifest → 解包 →
  原子换 current symlink。所以 latest.json **最后**写。

用法:
  publish-shell.py --dist frontend/workspace/dist --root /disk1/dabiao/axiomics-mt
  publish-shell.py ... --dry-run        # 只打包并打印，不写 feed
  publish-shell.py ... --version 0.0.0-internal-202611152200
"""

import argparse
import datetime as dt
import hashlib
import json
import os
import shutil
import sys
import tarfile
import tempfile
from pathlib import Path


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def build_manifest(dist):
    """Return manifest text and file count.

    Paths are written as `./rel` with two spaces after the digest — the exact
    format `sha256sum -c` consumes. Sorted with LC_ALL=C semantics so the same
    tree always produces the same bytes.
    """
    lines = []
    for path in sorted(dist.rglob("*"), key=lambda p: str(p.relative_to(dist))):
        if not path.is_file() or path.is_symlink():
            continue
        rel = "./" + str(path.relative_to(dist)).replace(os.sep, "/")
        lines.append("%s  %s" % (sha256_file(path), rel))
    return "\n".join(lines) + "\n", len(lines)


def write_atomic(path, data):
    tmp = str(path) + ".tmp"
    with open(tmp, "wb") as fh:
        fh.write(data if isinstance(data, bytes) else data.encode("utf-8"))
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dist", required=True, help="frontend/workspace/dist")
    ap.add_argument("--root", required=True, help="AX_ROOT（feed 在其 logs/release/）")
    ap.add_argument("--version", default=None, help="默认 0.0.0-internal-<本地时分>")
    ap.add_argument("--dry-run", action="store_true", help="打包但不写 feed")
    args = ap.parse_args()

    dist = Path(args.dist).resolve()
    if not (dist / "index.html").is_file():
        print("dist 里没有 index.html：先跑 build.sh", file=sys.stderr)
        return 2

    version = args.version or "0.0.0-internal-" + dt.datetime.now().strftime("%Y%m%d%H%M")
    bundle = "shell-%s.tgz" % version
    manifest = bundle + ".manifest"
    feed = Path(args.root).resolve() / "logs" / "release"

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        # 先算清单再打包：两者必须描述同一份树，中途不许有写入。
        text, files = build_manifest(dist)
        (tmp / manifest).write_text(text, encoding="utf-8")
        tgz = tmp / bundle
        with tarfile.open(tgz, "w:gz") as tar:
            for path in sorted(dist.rglob("*")):
                tar.add(path, arcname="./" + str(path.relative_to(dist)))

        latest = {
            "version": version,
            "bundle": bundle,
            "sha256": sha256_file(tgz),
            "manifest": manifest,
            "manifest_sha256": sha256_file(tmp / manifest),
            "files": files,
            "released_at": dt.datetime.now().astimezone().strftime("%Y-%m-%dT%H:%M:%S%z"),
        }

        print(json.dumps(latest, ensure_ascii=False, indent=2))
        if args.dry_run:
            print("dry-run：未写入 %s" % feed)
            return 0

        feed.mkdir(parents=True, exist_ok=True)
        # 顺序即协议：包和清单先到，latest.json 最后换。中途失败时 Web 仍在用旧版。
        shutil.copy2(tgz, feed / bundle)
        shutil.copy2(tmp / manifest, feed / manifest)
        write_atomic(feed / "latest.json", json.dumps(latest, ensure_ascii=False, indent=2) + "\n")
        print("已发布 %s → %s" % (version, feed))
        return 0


if __name__ == "__main__":
    sys.exit(main())
