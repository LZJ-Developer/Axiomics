"""Unit tier: 摘除案例切片时的取舍，全部在临时目录里跑。

Run: python3 -m unittest discover -s tooling/multitenant/tests/unit -p 'test_*.py'
"""

import importlib.util
import json
import tempfile
import unittest
from importlib.machinery import SourceFileLoader
from pathlib import Path

UNSEED = Path(__file__).resolve().parents[2] / "bin" / "axiomics-unseed"

PRJ = "prj_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
SES = "ses_11111111111111111111111111111111"
OTHER = "ses_22222222222222222222222222222222"


def load():
    # 脚本没有 .py 后缀，spec_from_file_location 认不出来，按源码加载器载入。
    loader = SourceFileLoader("axiomics_unseed", str(UNSEED))
    spec = importlib.util.spec_from_loader("axiomics_unseed", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


class UnseedPlan(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.slice = self.root / "case-slice"
        self.data = self.root / "tenants" / "u0009" / "data"
        self.write(
            self.slice / "storage" / "session" / PRJ / f"{SES}.json",
            {"id": SES, "directory": "/disk1/dabiao/axiomics-projects/09-case"},
        )
        self.write(self.slice / "storage" / "project" / f"{PRJ}.json", {"id": PRJ})
        self.write(self.slice / "storage" / "message" / SES / "msg_1.json", {"id": "msg_1"})
        self.write(self.slice / "projects" / PRJ / "report" / "a.txt", "report")

        self.write(
            self.data / "storage" / "session" / PRJ / f"{SES}.json",
            # 租户启动会把宿主路径改写成自己的 —— 同一份记录的两种拼写。
            {"id": SES, "directory": f"/data/projects/{PRJ}"},
        )
        self.write(self.data / "storage" / "project" / f"{PRJ}.json", {"id": PRJ})
        self.write(self.data / "storage" / "message" / SES / "msg_1.json", {"id": "msg_1"})
        self.write(self.data / "projects" / PRJ / "report" / "a.txt", "report")

        self.mod = load()
        self.mod.TENANTS = self.root / "tenants"

    def tearDown(self):
        import shutil

        shutil.rmtree(self.root)

    @staticmethod
    def write(path: Path, payload):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(payload if isinstance(payload, str) else json.dumps(payload))

    def plan(self):
        files = self.mod.slice_tree(self.slice)
        sessions = sorted({Path(rel.name).stem for rel in files if rel.parts[:2] == ("storage", "session")})
        projects = sorted({Path(rel.name).stem for rel in files if rel.parts[:2] == ("storage", "project")})
        delete, keep = self.mod.plan_sessions(self.slice, self.data, files, sessions)
        kept = {sid for sid, _ in keep}
        pdelete, pkeep = self.mod.plan_projects(self.slice, self.data, files, projects, kept)
        return delete, keep, pdelete, pkeep

    def test_path_rewrite_alone_is_not_an_edit(self):
        delete, keep, pdelete, pkeep = self.plan()
        self.assertEqual(keep, [])
        self.assertEqual(pkeep, [])
        self.assertIn(Path("storage/session") / PRJ / f"{SES}.json", delete)
        self.assertIn(Path("storage/project") / f"{PRJ}.json", pdelete)

    def test_a_session_that_gained_a_message_is_kept(self):
        self.write(self.data / "storage" / "message" / SES / "msg_2.json", {"id": "msg_2"})
        delete, keep, pdelete, pkeep = self.plan()
        self.assertEqual([sid for sid, _ in keep], [SES])
        # 会话留着，它的项目记录也不能被删掉。
        self.assertEqual(pdelete, [])
        self.assertEqual([pid for pid, _ in pkeep], [PRJ])

    def test_an_edited_record_is_kept(self):
        self.write(self.data / "storage" / "session" / PRJ / f"{SES}.json", {"id": SES, "title": "改过的标题"})
        _, keep, _, _ = self.plan()
        self.assertEqual([sid for sid, _ in keep], [SES])

    def test_a_project_holding_the_tenants_own_session_survives(self):
        self.write(self.data / "storage" / "session" / PRJ / f"{OTHER}.json", {"id": OTHER, "title": "用户自己的"})
        delete, keep, pdelete, pkeep = self.plan()
        # 种子会话本身干净，可以删；项目因为还有别的会话而保留。
        self.assertEqual(keep, [])
        self.assertIn(Path("storage/session") / PRJ / f"{SES}.json", delete)
        self.assertEqual(pdelete, [])
        self.assertEqual([pid for pid, _ in pkeep], [PRJ])
        self.assertTrue((self.data / "storage" / "session" / PRJ / f"{OTHER}.json").exists())


if __name__ == "__main__":
    unittest.main()
