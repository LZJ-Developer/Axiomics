"""Integration tier: real HTTP Range semantics against the puller's cursor logic.

The database is a recording fake, so no MySQL is needed; the HTTP side is a
real socket server that mimics what Caddy's file_server does with Range.

Run: python3 -m unittest discover -s tooling/multitenant/tests/integration -p 'test_*.py'
"""

import contextlib
import importlib.util
import io
import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PULLER = Path(__file__).resolve().parents[2] / "ledger" / "axiomics-ledger-pull.py"
spec = importlib.util.spec_from_file_location("ledger_pull", PULLER)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def usage_line(tenant="u0006", ts="2026-11-12T03:00:00.000Z"):
    return json.dumps({
        "tenant": tenant, "ts": ts, "model": "deepseek-flash", "stream": False,
        "input": 1, "output": 2, "cache_hit": 0, "cost_cny": 0.0001, "status": 200,
    }, separators=(",", ":")).encode() + b"\n"


def audit_line(user="lzj", ts="2026-11-12T03:00:00.000Z"):
    return json.dumps({
        "ts": ts, "user": user, "tenant": "u0006", "event": "ensure",
        "woken": True, "wake_ms": 3, "result": "ok",
    }, separators=(",", ":")).encode() + b"\n"


class FakeDB:
    """Records SQL and keeps the one row the puller cares about."""

    def __init__(self, epoch=0, offset=0):
        self.state = {"epoch": epoch, "offset": offset}
        self.sql = []
        self.committed = 0
        self.rolled_back = 0

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.committed += 1

    def rollback(self):
        self.rolled_back += 1

    def close(self):
        pass

    def count(self, prefix):
        return sum(1 for sql, _ in self.sql if sql.startswith(prefix))


class FakeCursor:
    def __init__(self, db):
        self.db = db
        self.rows = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.db.sql.append((sql, params))
        if "SELECT epoch, offset FROM ingest_cursor" in sql:
            self.rows = [(self.db.state["epoch"], self.db.state["offset"])]
            return
        if "SELECT COALESCE(MAX" in sql:
            self.rows = [(0,)]
            return
        if sql.startswith("INSERT INTO ingest_cursor"):
            self.db.state = {"epoch": params[1], "offset": params[2]}
        self.rows = []

    def fetchone(self):
        return self.rows[0] if self.rows else None


class LedgerServer:
    def __init__(self, body, ignore_range=False, missing=False):
        self.body = body
        self.ignore_range = ignore_range
        self.missing = missing
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if outer.missing:
                    self.send_response(404)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                total = len(outer.body)
                header = self.headers.get("Range")
                if header and not outer.ignore_range:
                    start = int(header.split("=", 1)[1].split("-", 1)[0])
                    if start >= total:
                        self.send_response(416)
                        self.send_header("Content-Range", "bytes */%d" % total)
                        self.send_header("Content-Length", "0")
                        self.end_headers()
                        return
                    chunk = outer.body[start:]
                    self.send_response(206)
                    self.send_header("Content-Range", "bytes %d-%d/%d" % (start, total - 1, total))
                    self.send_header("Content-Length", str(len(chunk)))
                    self.end_headers()
                    self.wfile.write(chunk)
                    return
                self.send_response(200)
                self.send_header("Content-Length", str(total))
                self.end_headers()
                self.wfile.write(outer.body)

            def log_message(self, *args):
                pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = "http://127.0.0.1:%d/ledger/x.jsonl" % self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.httpd.shutdown()
        self.httpd.server_close()


class Workflow(unittest.TestCase):
    def setUp(self):
        self.saved_env = dict(os.environ)
        for key in list(os.environ):
            if key.startswith("AX_LEDGER_EPOCH"):
                os.environ.pop(key)
        fd, self.env_file = tempfile.mkstemp()
        with os.fdopen(fd, "w") as fh:
            fh.write("AX_DB_HOST=x\nAX_DB_USER=x\nAX_DB_PASSWORD=x\nAX_DB_NAME=x\n")

    def tearDown(self):
        os.unlink(self.env_file)
        os.environ.clear()
        os.environ.update(self.saved_env)

    def pull(self, url, source="usage", epoch=0, offset=0):
        db = FakeDB(epoch, offset)
        original = m.connect
        m.connect = lambda env: db
        out = io.StringIO()
        try:
            with contextlib.redirect_stdout(out):
                rc = m.run(source, url, self.env_file)
        finally:
            m.connect = original
        return rc, out.getvalue(), db

    def test_appends_complete_lines_and_advances_cursor(self):
        body = usage_line() + usage_line("u0007")
        with LedgerServer(body) as srv:
            rc, out, db = self.pull(srv.url)
        self.assertEqual(rc, 0)
        self.assertIn("lines=2", out)
        self.assertEqual(db.count("INSERT INTO usage_event"), 2)
        self.assertEqual(db.state["offset"], len(body))
        self.assertEqual(db.committed, 1)

    def test_incomplete_tail_waits_for_the_next_run(self):
        first = usage_line()
        partial = usage_line("u0007")[:20]
        with LedgerServer(first + partial) as srv:
            rc, out, db = self.pull(srv.url)
        self.assertEqual(rc, 0)
        self.assertEqual(db.count("INSERT INTO usage_event"), 1)
        self.assertEqual(db.state["offset"], len(first))

        rest = usage_line("u0007")
        with LedgerServer(first + rest) as srv:
            rc, out, db = self.pull(srv.url, offset=len(first))
        self.assertEqual(db.count("INSERT INTO usage_event"), 1)
        row = next(params for sql, params in db.sql if sql.startswith("INSERT INTO usage_event"))
        self.assertEqual(row[11], len(first))  # src_offset continues after the break
        self.assertEqual(db.state["offset"], len(first) + len(rest))

    def test_replay_from_the_same_cursor_is_a_no_op(self):
        body = usage_line()
        with LedgerServer(body) as srv:
            rc, out, db = self.pull(srv.url, offset=len(body))
        self.assertEqual(rc, 0)
        self.assertIn("at_eof", out)
        self.assertEqual(db.count("INSERT INTO usage_event"), 0)
        self.assertEqual(db.committed, 1)  # heartbeat still moves

    def test_server_that_ignores_range_is_sliced_client_side(self):
        body = usage_line() + usage_line("u0007")
        offset = len(usage_line())
        with LedgerServer(body, ignore_range=True) as srv:
            rc, out, db = self.pull(srv.url, offset=offset)
        self.assertEqual(rc, 0)
        self.assertEqual(db.count("INSERT INTO usage_event"), 1)
        self.assertEqual(db.state["offset"], len(body))

    def test_cursor_past_eof_stops_instead_of_rewinding(self):
        body = usage_line()
        with LedgerServer(body) as srv:
            rc, out, db = self.pull(srv.url, offset=len(body) + 50)
        self.assertEqual(rc, 4)
        self.assertIn("not rewinding", out)
        self.assertEqual(db.count("INSERT INTO usage_event"), 0)
        self.assertEqual(db.state["offset"], len(body) + 50)

    def test_rotation_needs_an_explicit_epoch_bump(self):
        old, new = usage_line() * 3, usage_line("u0007")
        # Without a bump the shorter file looks like a cursor past EOF.
        with LedgerServer(new) as srv:
            rc, out, db = self.pull(srv.url, offset=len(old))
        self.assertEqual(rc, 4)

        os.environ["AX_LEDGER_EPOCH_USAGE"] = "1"
        with LedgerServer(new) as srv:
            rc, out, db = self.pull(srv.url, offset=len(old))
        self.assertEqual(rc, 0)
        self.assertIn("epoch: usage 0 -> 1", out)
        self.assertEqual(db.count("INSERT INTO usage_event"), 1)
        self.assertEqual(db.state, {"epoch": 1, "offset": len(new)})

    def test_epoch_below_the_stored_one_is_ignored(self):
        body = usage_line()
        os.environ["AX_LEDGER_EPOCH_USAGE"] = "0"
        with LedgerServer(body) as srv:
            rc, out, db = self.pull(srv.url, epoch=2, offset=0)
        self.assertNotIn("restarting at offset 0", out)
        self.assertEqual(db.state["epoch"], 2)

    def test_malformed_line_is_rejected_without_blocking_the_cursor(self):
        body = usage_line() + b"not json\n" + usage_line("u0007")
        with LedgerServer(body) as srv:
            rc, out, db = self.pull(srv.url)
        self.assertEqual(rc, 0)
        self.assertIn("rejects=1", out)
        self.assertEqual(db.count("INSERT INTO usage_event"), 2)
        self.assertEqual(db.count("INSERT INTO ledger_reject"), 1)
        self.assertEqual(db.state["offset"], len(body))

    def test_activator_rows_land_in_audit_log(self):
        body = audit_line() + audit_line("zhangchihao")
        with LedgerServer(body) as srv:
            rc, out, db = self.pull(srv.url, source="activator")
        self.assertEqual(db.count("INSERT INTO audit_log"), 2)
        first = next(params for sql, params in db.sql if sql.startswith("INSERT INTO audit_log"))
        self.assertEqual(first[0], "activator")

    def test_missing_admin_source_is_not_an_error(self):
        with LedgerServer(b"", missing=True) as srv:
            rc, out, db = self.pull(srv.url, source="admin")
        self.assertEqual(rc, 0)
        self.assertIn("missing_source=admin", out)

    def test_missing_usage_source_is_an_error(self):
        with LedgerServer(b"", missing=True) as srv:
            rc, out, db = self.pull(srv.url, source="usage")
        self.assertEqual(rc, 5)

    def test_fetch_failure_rolls_back(self):
        db = FakeDB()
        original_connect, original_fetch = m.connect, m.fetch
        m.connect = lambda env: db

        def boom(url, offset=None, timeout=20):
            raise RuntimeError("network down")

        m.fetch = boom
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(RuntimeError):
                    m.run("usage", "http://127.0.0.1:1/x", self.env_file)
        finally:
            m.connect, m.fetch = original_connect, original_fetch
        self.assertEqual(db.rolled_back, 1)
        self.assertEqual(db.count("INSERT INTO usage_event"), 0)


if __name__ == "__main__":
    unittest.main()
