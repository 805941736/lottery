import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SERVER_PATH = Path(__file__).resolve().parents[1] / "scripts" / "ssq-local-server.py"
SPEC = importlib.util.spec_from_file_location("ssq_local_server", SERVER_PATH)
server = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(server)


class LotteryPayloadTests(unittest.TestCase):
    def payload(self):
        return {
            "chart": {
                "rows": [
                    {"issue": "26001", "red": [1, 2, 3, 4, 5, 6], "blue": 7},
                    {"issue": "26002", "red": [8, 9, 10, 11, 12, 13], "blue": 14},
                ]
            },
            "latest": {"issue": "2026002"},
        }

    def test_accepts_valid_payload(self):
        server.assert_lottery_payload(self.payload())

    def test_rejects_duplicate_red_ball(self):
        payload = self.payload()
        payload["chart"]["rows"][0]["red"] = [1, 1, 2, 3, 4, 5]
        with self.assertRaisesRegex(ValueError, "duplicate"):
            server.assert_lottery_payload(payload)

    def test_rejects_out_of_order_issues(self):
        payload = self.payload()
        payload["chart"]["rows"].reverse()
        with self.assertRaisesRegex(ValueError, "strictly ascending"):
            server.assert_lottery_payload(payload)


class RecordTests(unittest.TestCase):
    def test_record_schema_limits_actions(self):
        with self.assertRaisesRegex(ValueError, "too many actions"):
            server.validate_record_payload({"actions": [{}] * 5001})

    def test_atomic_write_replaces_complete_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "record.json"
            server.write_text_atomic(path, json.dumps({"saved": True}))
            self.assertEqual({"saved": True}, json.loads(path.read_text(encoding="utf-8")))
            self.assertEqual([], list(path.parent.glob(".*.tmp")))

    def test_merge_keeps_only_latest_fifty_rows(self):
        local = [
            {"issue": f"26{number:03d}", "red": [1, 2, 3, 4, 5, 6], "blue": 7}
            for number in range(1, 51)
        ]
        incoming = {
            "chart": {
                "generatedAt": "2026-07-11 12:00:00",
                "rows": [{"issue": "26051", "red": [2, 3, 4, 5, 6, 7], "blue": 8}],
            },
            "latest": {},
        }
        with mock.patch.object(server, "load_local_chart_rows", return_value=local):
            merged = server.merge_with_local_history(incoming)
        self.assertEqual(50, len(merged["chart"]["rows"]))
        self.assertEqual("26002", merged["chart"]["rows"][0]["issue"])
        self.assertEqual("26051", merged["chart"]["rows"][-1]["issue"])


class EntrypointTests(unittest.TestCase):
    def test_index_base_path_supports_root_server_entrypoint(self):
        index_path = Path(__file__).resolve().parents[1] / "app" / "index.html"
        html = index_path.read_text(encoding="utf-8")
        self.assertIn('<base href="/app/">', html)
        self.assertIn('<script src="./core/ssq-core.js"></script>', html)

    def test_static_policy_allows_nested_app_modules_and_styles(self):
        self.assertTrue(server.is_public_file("app/main.js"))
        self.assertTrue(server.is_public_file("app/features/chart/chart-view.js"))
        self.assertTrue(server.is_public_file("app/assets/styles/index.css"))

    def test_static_policy_rejects_private_and_project_files(self):
        self.assertFalse(server.is_public_file("app/.secret.js"))
        self.assertFalse(server.is_public_file("app/features/.secret.js"))
        self.assertFalse(server.is_public_file("scripts/ssq-local-server.py"))


if __name__ == "__main__":
    unittest.main()
