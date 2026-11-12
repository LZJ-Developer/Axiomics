#!/usr/bin/env python3
"""Axiomics ledger puller: GPU /ledger/*.jsonl -> MySQL.

Pull-only by design: GPU cannot reach Web, so Web fetches.

Invariants
  1. Only newline-terminated lines are consumed; an incomplete tail is left
     for the next run and the cursor does not move past it.
  2. The cursor advances in the same transaction as the row inserts. A crash
     after commit re-pulls the same bytes; the idempotency key dedupes them.
  3. A short read never rewinds the cursor. Source truncation is reported,
     never "repaired" automatically; recovery is an explicit AX_LEDGER_EPOCH
     bump (see env_epoch).
  4. idempotency_key = sha256(source \x1f epoch \x1f byte_offset \x1f raw_line)

Sources
  usage      /ledger/usage.jsonl        -> usage_event
  activator  /ledger/audit.jsonl        -> audit_log (source='activator')
  admin      /ledger/admin-audit.jsonl  -> audit_log (source='admin')
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request

def env_epoch(source):
    """Explicit rotation generation for a source.

    A ledger can be truncated or rotated outside the puller. Byte offsets in
    the new file reuse the old range, so re-reading them under the old epoch
    would silently dedupe genuinely new events. Recovery is therefore an
    operator action, never automatic:

        AX_LEDGER_EPOCH_<SOURCE>   per source (wins)
        AX_LEDGER_EPOCH            all sources

    Only a strictly greater value is honoured, so a rewind happens once.
    """
    for key in ("AX_LEDGER_EPOCH_%s" % source.upper(), "AX_LEDGER_EPOCH"):
        raw = os.environ.get(key)
        if raw is None or raw.strip() == "":
            continue
        try:
            return int(raw)
        except ValueError:
            raise SystemExit("error: %s=%r is not an integer" % (key, raw))
    return 0


GPU = "http://192.0.2.113:8005"
URLS = {
    "usage": GPU + "/ledger/usage.jsonl",
    "activator": GPU + "/ledger/audit.jsonl",
    "admin": GPU + "/ledger/admin-audit.jsonl",
}
TABLES = {"usage": "usage_event", "activator": "audit_log", "admin": "audit_log"}
DEFAULT_ENV = os.path.expanduser("~/.axiomics/mysql.env")
RETRIES = 3


def load_env(path):
    env = {}
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def opener():
    # Intranet: never let the host's HTTP_PROXY turn this into a 503.
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


def fetch(url, offset=None, timeout=20):
    """Return (status, start, total, body). start is the byte offset of body[0]."""
    req = urllib.request.Request(url, method="GET")
    if offset:
        req.add_header("Range", "bytes=%d-" % offset)
    last = None
    for attempt in range(RETRIES):
        try:
            with opener().open(req, timeout=timeout) as resp:
                body = resp.read()
                total = int(resp.headers.get("Content-Length", len(body)))
                ctype = resp.headers.get("Content-Type", "")
                if "gzip" in resp.headers.get("Content-Encoding", "").lower():
                    raise RuntimeError("unexpected Content-Encoding; Range semantics would break")
                if resp.status == 206:
                    cr = resp.headers.get("Content-Range", "")
                    # bytes start-end/total
                    parts = cr.replace("bytes", "").strip().split("/")
                    span = parts[0].split("-")
                    start = int(span[0])
                    total = int(parts[1]) if len(parts) > 1 and parts[1] != "*" else None
                    return 206, start, total, body
                if resp.status == 200:
                    return 200, 0, len(body), body
                last = "status %s" % resp.status
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return 404, offset or 0, None, b""
            if exc.code == 416:
                cr = exc.headers.get("Content-Range", "")
                total = None
                if "/" in cr:
                    try:
                        total = int(cr.split("/")[-1])
                    except ValueError:
                        pass
                return 416, offset or 0, total, b""
            last = "HTTP %s" % exc.code
        except Exception as exc:  # transient network / short read
            last = "%s: %s" % (type(exc).__name__, exc)
        time.sleep(0.4 * (attempt + 1))
    raise RuntimeError("fetch failed after %d attempts: %s" % (RETRIES, last))


def classify(status, start, total, offset):
    """Decide what a fetch outcome means, without touching the database.

    Returns one of: missing | eof | past_eof | mismatch | shrink | body.
    Keeping this pure is what lets the failure modes be tested directly.
    """
    if status == 404:
        return "missing"
    if status == 416:
        # Caddy answers 416 when the range starts at exactly EOF, which is the
        # normal caught-up state; only a cursor past the end needs a human.
        if total is not None and offset == total:
            return "eof"
        return "past_eof"
    if status == 206 and start != offset:
        return "mismatch"
    if status == 206 and total is not None and total < offset:
        return "shrink"
    return "body"


def parse_ts(value):
    s = str(value).strip()
    for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            return dt.datetime.strptime(s, fmt)
        except ValueError:
            continue
    raise ValueError("bad ts: %r" % value)


def clip(value, limit):
    return ("" if value is None else str(value))[:limit]


def idem(source, epoch, offset, raw):
    h = hashlib.sha256()
    h.update(source.encode())
    h.update(b"\x1f")
    h.update(str(epoch).encode())
    h.update(b"\x1f")
    h.update(str(offset).encode())
    h.update(b"\x1f")
    h.update(raw)
    return h.hexdigest()


def map_usage(obj, raw, source, epoch, offset, length):
    return (
        clip(obj.get("tenant"), 16),
        idem(source, epoch, offset, raw),
        parse_ts(obj.get("ts")),
        clip(obj.get("model"), 128),
        1 if obj.get("stream") else 0,
        int(obj.get("input") or 0),
        int(obj.get("output") or 0),
        int(obj.get("cache_hit") or 0),
        str(obj.get("cost_cny") or 0),
        int(obj.get("status") or 0),
        epoch,
        offset,
        length,
        raw.decode("utf-8", "replace"),
    )


def map_audit(obj, raw, source, epoch, offset, length):
    if source == "activator":
        actor = obj.get("user")
        action = obj.get("event")
        outcome = obj.get("result")
        tenant = obj.get("tenant")
        target = ""
        gpu = 0
        reason = ""
        request_id = ""
        before = None
        after = None
    else:
        actor = obj.get("actor")
        action = obj.get("action")
        outcome = obj.get("outcome")
        tenant = obj.get("tenant")
        target = obj.get("target")
        gpu = int(obj.get("gpu") or 0)
        reason = obj.get("reason")
        request_id = obj.get("request_id")
        before = obj.get("before")
        after = obj.get("after")
    return (
        source,
        idem(source, epoch, offset, raw),
        parse_ts(obj.get("ts")),
        clip(actor, 64),
        clip(action, 32),
        clip(tenant, 16),
        clip(target, 64),
        gpu,
        clip(reason, 255),
        clip(request_id, 64),
        clip(outcome, 32),
        json.dumps(before, ensure_ascii=False) if before is not None else None,
        json.dumps(after, ensure_ascii=False) if after is not None else None,
        raw.decode("utf-8", "replace"),
        epoch,
        offset,
        length,
    )


SQL_USAGE = (
    "INSERT INTO usage_event (tenant_id,idempotency_key,ts,model,stream,input_tokens,"
    "output_tokens,cache_hit_tokens,cost_cny,status,src_epoch,src_offset,src_len,raw) "
    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
    "ON DUPLICATE KEY UPDATE id=id"
)
SQL_AUDIT = (
    "INSERT INTO audit_log (source,idempotency_key,ts,actor,action,tenant,target,gpu,"
    "reason,request_id,outcome,before_json,after_json,raw,src_epoch,src_offset,src_len) "
    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
    "ON DUPLICATE KEY UPDATE id=id"
)
SQL_REJECT = (
    "INSERT INTO ledger_reject (source,src_offset,raw_line,reason) VALUES (%s,%s,%s,%s)"
)


def split_lines(blob, base):
    """Yield (offset, raw_line_bytes) for complete lines only."""
    pos = 0
    while True:
        nl = blob.find(b"\n", pos)
        if nl < 0:
            return
        yield base + pos, blob[pos:nl]
        pos = nl + 1


def connect(env):
    import pymysql  # lazy: dry-run must work without the venv

    return pymysql.connect(
        host=env["AX_DB_HOST"],
        port=int(env.get("AX_DB_PORT", "3306")),
        user=env["AX_DB_USER"],
        password=env["AX_DB_PASSWORD"],
        database=env["AX_DB_NAME"],
        charset="utf8mb4",
        autocommit=False,
        connect_timeout=10,
        read_timeout=20,
        write_timeout=20,
    )


def get_cursor(conn, source):
    with conn.cursor() as cur:
        cur.execute("SELECT epoch, offset FROM ingest_cursor WHERE source=%s", (source,))
        row = cur.fetchone()
        if row:
            return int(row[0]), int(row[1])
        table = TABLES[source]
        cur.execute("SELECT COALESCE(MAX(src_offset+src_len),0) FROM %s" % table)
        return 0, int(cur.fetchone()[0] or 0)


def dry_run(source, url, start_offset):
    # Dry runs always reason from byte 0 so skipped_leading is truthful.
    status, start, total, body = fetch(url, None)
    if status == 404:
        print("missing_source=%s status=404" % source)
        return 0
    if start_offset == 0:
        consumed = list(split_lines(body, 0))
        print("lines=%d bytes=%d cursor=%d" % (len(consumed), len(body), len(body)))
        return 0
    if start_offset > len(body):
        print("error: start_offset %d beyond file size %d" % (start_offset, len(body)))
        return 3
    aligned = start_offset == 0 or body[start_offset - 1 : start_offset] == b"\n"
    pos = start_offset
    if not aligned:
        nl = body.find(b"\n", start_offset)
        pos = len(body) if nl < 0 else nl + 1
    leading = sum(1 for _ in split_lines(body[:start_offset], 0))
    tail = list(split_lines(body[pos:], pos))
    print(
        "skipped_leading=%d lines=%d bytes=%d cursor=%d aligned=%s"
        % (leading, len(tail), len(body), len(body), "yes" if aligned else "no")
    )
    return 0


def run(source, url, env_file):
    env = load_env(env_file)
    conn = connect(env)
    try:
        epoch, offset = get_cursor(conn, source)
        wanted = env_epoch(source)
        if wanted > epoch:
            print("epoch: %s %d -> %d (rotation acknowledged); restarting at offset 0"
                  % (source, epoch, wanted))
            epoch, offset = wanted, 0
        status, start, total, body = fetch(url, offset)

        action = classify(status, start, total, offset)
        if action == "missing":
            if source == "admin":
                print("missing_source=admin status=404 (no provisioning event yet)")
                return 0
            print("error: source missing (%s) status=404" % source)
            return 5
        if action == "eof":
            # Caught up is a successful run, so the heartbeat must move;
            # otherwise a quiet ledger looks like a dead puller.
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO ingest_cursor (source,epoch,offset,heartbeat_at) "
                    "VALUES (%s,%s,%s,UTC_TIMESTAMP(3)) "
                    "ON DUPLICATE KEY UPDATE heartbeat_at=VALUES(heartbeat_at)",
                    (source, epoch, offset),
                )
            conn.commit()
            print("source=%s lines=0 rejects=0 bytes=0 cursor=%d->%d total=%d at_eof"
                  % (source, offset, offset, total))
            return 0
        if action == "past_eof":
            print("error: offset %d beyond EOF (total=%s); not rewinding" % (offset, total))
            return 4
        if action == "mismatch":
            print("error: server returned start=%d for requested offset=%d" % (start, offset))
            return 4
        if action == "shrink":
            print("error: source shrank (total=%d < cursor=%d); not rewinding" % (total, offset))
            return 4
        if status == 200:
            body = body[offset:]
            start = offset

        rows, rejects = [], []
        consumed_bytes = 0
        for line_off, raw in split_lines(body, start):
            consumed_bytes = line_off + len(raw) + 1 - start
            try:
                obj = json.loads(raw.decode("utf-8"))
                if not isinstance(obj, dict):
                    raise ValueError("line is not a JSON object")
                if source == "usage":
                    rows.append(map_usage(obj, raw, source, epoch, line_off, len(raw) + 1))
                else:
                    rows.append(map_audit(obj, raw, source, epoch, line_off, len(raw) + 1))
            except Exception as exc:
                rejects.append((source, line_off, raw.decode("utf-8", "replace")[:4000], str(exc)[:255]))

        table = TABLES[source]
        sql = SQL_USAGE if source == "usage" else SQL_AUDIT
        with conn.cursor() as cur:
            for row in rows:
                cur.execute(sql, row)
            for rej in rejects:
                cur.execute(SQL_REJECT, rej)
            new_offset = start + consumed_bytes
            cur.execute(
                "INSERT INTO ingest_cursor (source,epoch,offset,heartbeat_at) "
                "VALUES (%s,%s,%s,UTC_TIMESTAMP(3)) "
                "ON DUPLICATE KEY UPDATE epoch=VALUES(epoch),offset=VALUES(offset),"
                "heartbeat_at=VALUES(heartbeat_at)",
                (source, epoch, new_offset),
            )
        conn.commit()
        print(
            "source=%s lines=%d rejects=%d bytes=%d cursor=%d->%d total=%s"
            % (source, len(rows), len(rejects), consumed_bytes, offset, new_offset, total)
        )
        return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=sorted(URLS), default="usage")
    ap.add_argument("--url", default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--start-offset", type=int, default=0)
    ap.add_argument("--env-file", default=DEFAULT_ENV)
    args = ap.parse_args()
    url = args.url or URLS[args.source]
    if args.dry_run:
        return dry_run(args.source, url, args.start_offset)
    return run(args.source, url, args.env_file)


if __name__ == "__main__":
    sys.exit(main())
