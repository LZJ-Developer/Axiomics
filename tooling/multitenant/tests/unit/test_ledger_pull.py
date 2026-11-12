"""Unit tier: pure decisions of the ledger puller, no socket and no database.

Run: python3 -m unittest discover -s tooling/multitenant/tests/unit -p 'test_*.py'
"""

import importlib.util
import os
import unittest
from pathlib import Path

PULLER = Path(__file__).resolve().parents[2] / "ledger" / "axiomics-ledger-pull.py"


def load():
    spec = importlib.util.spec_from_file_location("ledger_pull", PULLER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


m = load()


class IdempotencyKey(unittest.TestCase):
    def test_stable(self):
        self.assertEqual(m.idem("usage", 0, 7, b"{}"), m.idem("usage", 0, 7, b"{}"))

    def test_each_component_changes_the_key(self):
        base = m.idem("usage", 0, 7, b"{}")
        self.assertNotEqual(base, m.idem("audit", 0, 7, b"{}"))
        self.assertNotEqual(base, m.idem("usage", 1, 7, b"{}"))
        self.assertNotEqual(base, m.idem("usage", 0, 8, b"{}"))
        self.assertNotEqual(base, m.idem("usage", 0, 7, b'{"x":1}'))

    def test_sha256_hex(self):
        self.assertRegex(m.idem("usage", 0, 0, b""), r"^[0-9a-f]{64}$")


class SplitLines(unittest.TestCase):
    def test_complete_lines_only(self):
        self.assertEqual(list(m.split_lines(b"a\nb\nhalf", 0)), [(0, b"a"), (2, b"b")])

    def test_offsets_are_absolute(self):
        self.assertEqual(list(m.split_lines(b"a\nb\n", 100)), [(100, b"a"), (102, b"b")])

    def test_empty_and_newline_only(self):
        self.assertEqual(list(m.split_lines(b"", 0)), [])
        self.assertEqual(list(m.split_lines(b"\n", 5)), [(5, b"")])

    def test_partial_tail_is_not_consumed(self):
        rendered = list(m.split_lines(b"one\ntwo\nthree", 0))
        self.assertEqual([line for _, line in rendered], [b"one", b"two"])


class Classify(unittest.TestCase):
    def test_missing(self):
        self.assertEqual(m.classify(404, 0, None, 0), "missing")

    def test_caught_up_at_eof(self):
        self.assertEqual(m.classify(416, 10, 10, 10), "eof")

    def test_cursor_past_eof(self):
        self.assertEqual(m.classify(416, 12, 10, 12), "past_eof")

    def test_unknown_total_is_not_called_eof(self):
        # A 416 without Content-Range is ambiguous; treat it as needing a human.
        self.assertEqual(m.classify(416, 0, None, 10), "past_eof")

    def test_server_ignored_range(self):
        self.assertEqual(m.classify(206, 4, 10, 4), "body")
        self.assertEqual(m.classify(206, 3, 10, 4), "mismatch")

    def test_shrink(self):
        self.assertEqual(m.classify(206, 5, 4, 5), "shrink")

    def test_plain_200(self):
        self.assertEqual(m.classify(200, 0, 10, 5), "body")


class EnvEpoch(unittest.TestCase):
    def setUp(self):
        self.saved = dict(os.environ)
        for key in ("AX_LEDGER_EPOCH", "AX_LEDGER_EPOCH_USAGE", "AX_LEDGER_EPOCH_ACTIVATOR"):
            os.environ.pop(key, None)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.saved)

    def test_default_zero(self):
        self.assertEqual(m.env_epoch("usage"), 0)

    def test_global_applies_to_every_source(self):
        os.environ["AX_LEDGER_EPOCH"] = "3"
        self.assertEqual(m.env_epoch("usage"), 3)
        self.assertEqual(m.env_epoch("activator"), 3)

    def test_per_source_wins(self):
        os.environ["AX_LEDGER_EPOCH"] = "3"
        os.environ["AX_LEDGER_EPOCH_ACTIVATOR"] = "5"
        self.assertEqual(m.env_epoch("activator"), 5)
        self.assertEqual(m.env_epoch("usage"), 3)

    def test_blank_is_ignored(self):
        os.environ["AX_LEDGER_EPOCH_USAGE"] = "  "
        self.assertEqual(m.env_epoch("usage"), 0)

    def test_non_integer_is_a_startup_error(self):
        os.environ["AX_LEDGER_EPOCH"] = "next"
        with self.assertRaises(SystemExit):
            m.env_epoch("usage")


class LoadEnv(unittest.TestCase):
    def test_comments_blanks_and_equals_in_values(self):
        import tempfile

        with tempfile.NamedTemporaryFile("w", delete=False) as fh:
            fh.write("# comment\n\nAX_DB_HOST=127.0.0.1\nAX_DB_PASSWORD=a=b\n")
            path = fh.name
        try:
            env = m.load_env(path)
        finally:
            os.unlink(path)
        self.assertEqual(env["AX_DB_HOST"], "127.0.0.1")
        self.assertEqual(env["AX_DB_PASSWORD"], "a=b")
        self.assertNotIn("# comment", env)


class RowMapping(unittest.TestCase):
    def test_usage_row_shape(self):
        obj = {
            "tenant": "u0006", "ts": "2026-11-12T03:00:00.000Z", "model": "deepseek-flash",
            "stream": True, "input": 10, "output": 5, "cache_hit": 2, "cost_cny": 0.001, "status": 200,
        }
        row = m.map_usage(obj, b"raw", "usage", 0, 11, 4)
        self.assertEqual(row[0], "u0006")
        self.assertEqual(row[1], m.idem("usage", 0, 11, b"raw"))
        self.assertEqual(row[5:9], (10, 5, 2, "0.001"))
        self.assertEqual((row[10], row[11], row[12]), (0, 11, 4))

    def test_activator_row_shape(self):
        obj = {"ts": "2026-11-12T03:00:00.000Z", "user": "lzj", "tenant": "u0006",
               "event": "ensure", "woken": True, "wake_ms": 9, "result": "ok"}
        row = m.map_audit(obj, b"raw", "activator", 0, 0, 4)
        self.assertEqual(row[0], "activator")
        self.assertEqual((row[3], row[4], row[5], row[10]), ("lzj", "ensure", "u0006", "ok"))

    def test_admin_row_shape(self):
        obj = {"ts": "2026-11-12T03:00:00.000Z", "actor": "admin", "action": "add-user",
               "tenant": "u0007", "target": "u0007", "gpu": 0, "reason": "",
               "request_id": "req-1", "outcome": "ok", "before": None, "after": {"user": "x"}}
        row = m.map_audit(obj, b"raw", "admin", 0, 0, 4)
        self.assertEqual(row[0], "admin")
        self.assertEqual((row[3], row[4], row[9], row[10]), ("admin", "add-user", "req-1", "ok"))
        self.assertIsNone(row[11])
        self.assertIn('"user": "x"', row[12])

    def test_bad_timestamp_is_rejected_upstream(self):
        with self.assertRaises(ValueError):
            m.parse_ts("2026-11-12 03:00:00")


if __name__ == "__main__":
    unittest.main()
