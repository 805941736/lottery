#!/usr/bin/env python3
import argparse
import datetime as dt
import html
import json
import mimetypes
import os
import re
import shutil
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = PROJECT_ROOT / "data"
CHART_URL = "https://datachart.500.com/ssq/?expect=50"
RECORD_PATH = DATA_ROOT / "ssq-analysis-records.json"
SERVER_STATE_PATH = DATA_ROOT / "ssq-local-server.json"
RECORD_BACKUP_ROOT = DATA_ROOT / "record-backups"
MAX_RECORD_BYTES = 2 * 1024 * 1024
PUBLIC_DATA_FILES = {"data/chart-data.js", "data/latest-ssq.js", "data/backtest-predictions.js"}


def now_text():
    return dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def write_text_atomic(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temp_path.write_text(text, encoding="utf-8")
        temp_path.replace(path)
    finally:
        if temp_path.exists():
            temp_path.unlink()


def backup_record_file():
    if not RECORD_PATH.is_file():
        return
    RECORD_BACKUP_ROOT.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S-%f")[:-3]
    shutil.copy2(RECORD_PATH, RECORD_BACKUP_ROOT / f"ssq-analysis-records-{stamp}.json")
    backups = sorted(RECORD_BACKUP_ROOT.glob("ssq-analysis-records-*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old_backup in backups[30:]:
        old_backup.unlink()


def test_existing_server(port):
    if port <= 0:
        return False
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/launch-ready.js", timeout=0.5) as response:
            return response.read().decode("utf-8", errors="replace").strip() == "window.__SSQ_READY__ = true;"
    except (OSError, urllib.error.URLError, ValueError):
        return False


def save_server_state(port):
    state = {"port": port, "startedAt": dt.datetime.now().astimezone().isoformat()}
    write_text_atomic(SERVER_STATE_PATH, json.dumps(state, ensure_ascii=False, separators=(",", ":")))


def assert_lottery_row(row):
    issue = str(row.get("issue", ""))
    if not re.fullmatch(r"\d{5}", issue):
        raise ValueError(f"invalid issue: {issue}")
    red = [int(value) for value in row.get("red", [])]
    if len(red) != 6:
        raise ValueError(f"issue {issue} must have 6 red balls")
    if len(set(red)) != 6:
        raise ValueError(f"issue {issue} has duplicate red balls")
    for number in red:
        if number < 1 or number > 33:
            raise ValueError(f"issue {issue} red ball out of range: {number}")
    blue = int(row.get("blue", 0))
    if blue < 1 or blue > 16:
        raise ValueError(f"issue {issue} blue ball out of range: {blue}")


def assert_lottery_payload(payload):
    rows = payload.get("chart", {}).get("rows", [])
    if not rows:
        raise ValueError("lottery payload has no rows")
    last_issue = 0
    for row in rows:
        assert_lottery_row(row)
        issue = int(row["issue"])
        if issue <= last_issue:
            raise ValueError(f"lottery issues are not strictly ascending near {row['issue']}")
        last_issue = issue
    latest = rows[-1]
    latest_issue = "20" + str(latest["issue"])
    if payload.get("latest") and str(payload["latest"].get("issue")) != latest_issue:
        raise ValueError(f"latest issue mismatch: {payload['latest'].get('issue')} vs {latest_issue}")


def read_500_html():
    request = urllib.request.Request(
        CHART_URL,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Referer": "https://datachart.500.com/ssq/",
        },
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        raw = response.read()
    return raw.decode("gb18030", errors="replace")


def parse_cells(row_html):
    cells = []
    for match in re.finditer(r"<td\s([^>]*)>(.*?)</td>", row_html, re.IGNORECASE | re.DOTALL):
        attrs = match.group(1)
        text = re.sub(r"<[^>]+>", "", match.group(2)).strip()
        cells.append({"attrs": attrs, "text": html.unescape(text)})
    return cells


def get_500_payload():
    page = read_500_html()
    rows = []
    row_pattern = re.compile(r'<tr>\s*<td\s+align="center">\s*(\d{5})\s*</td>(.*?)</tr>', re.IGNORECASE | re.DOTALL)
    for row_match in row_pattern.finditer(page):
        issue = row_match.group(1)
        red = []
        blue = None
        for cell in parse_cells(row_match.group(2)):
            if "chartBall01" in cell["attrs"]:
                red.append(int(cell["text"]))
            if "chartBall02" in cell["attrs"]:
                blue = int(cell["text"])
        if len(red) == 6 and blue is not None:
            rows.append({"issue": issue, "red": red, "blue": blue})
    rows.sort(key=lambda row: int(row["issue"]))
    if not rows:
        raise ValueError("未能从 500彩票网页面解析到双色球数据")
    latest = rows[-1]
    generated_at = now_text()
    return {
        "chart": {"generatedAt": generated_at, "source": "500彩票网", "rows": rows},
        "latest": {
            "issue": "20" + latest["issue"],
            "date": "",
            "red": [f"{value:02d}" for value in latest["red"]],
            "blue": [f"{latest['blue']:02d}"],
            "source": "500彩票网",
            "updatedAt": generated_at,
        },
    }


def load_local_chart_rows():
    local_path = DATA_ROOT / "chart-data.js"
    if not local_path.is_file():
        return []
    raw = local_path.read_text(encoding="utf-8")
    match = re.search(r"window\.SSQ_CHART_DATA\s*=\s*(\{.*\})\s*;", raw, re.DOTALL)
    if not match:
        return []
    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError:
        return []
    return [
        {"issue": str(row["issue"]), "red": [int(v) for v in row["red"]], "blue": int(row["blue"])}
        for row in data.get("rows", [])
    ]


def merge_with_local_history(payload):
    row_map = {row["issue"]: row for row in load_local_chart_rows()}
    local_rows = sorted(row_map.values(), key=lambda row: int(row["issue"]))
    local_latest = int(local_rows[-1]["issue"]) if local_rows else 0
    incoming_rows = sorted(payload["chart"]["rows"], key=lambda row: int(row["issue"]))
    if len(local_rows) >= 50:
        for row in incoming_rows:
            if int(row["issue"]) > local_latest:
                row_map[str(row["issue"])] = {"issue": str(row["issue"]), "red": [int(v) for v in row["red"]], "blue": int(row["blue"])}
    else:
        for row in incoming_rows:
            row_map[str(row["issue"])] = {"issue": str(row["issue"]), "red": [int(v) for v in row["red"]], "blue": int(row["blue"])}
    rows = sorted(row_map.values(), key=lambda row: int(row["issue"]))[-50:]
    payload["chart"]["rows"] = rows
    latest = rows[-1]
    payload["latest"] = {
        "issue": "20" + latest["issue"],
        "date": "",
        "red": [f"{value:02d}" for value in latest["red"]],
        "blue": [f"{latest['blue']:02d}"],
        "source": "500彩票网",
        "updatedAt": payload["chart"]["generatedAt"],
    }
    return payload


def save_data_files(payload):
    assert_lottery_payload(payload)
    write_text_atomic(DATA_ROOT / "chart-data.js", "window.SSQ_CHART_DATA = " + json.dumps(payload["chart"], ensure_ascii=False, separators=(",", ":")) + ";")
    write_text_atomic(DATA_ROOT / "latest-ssq.js", "window.SSQ_LATEST = " + json.dumps(payload["latest"], ensure_ascii=False, separators=(",", ":")) + ";")


def validate_record_payload(payload):
    if not isinstance(payload, dict):
        raise ValueError("record must be an object")
    if "actions" in payload and not isinstance(payload["actions"], list):
        raise ValueError("actions must be an array")
    if len(payload.get("actions", [])) > 5000:
        raise ValueError("too many actions")
    if "picks" in payload and not isinstance(payload["picks"], dict):
        raise ValueError("picks must be an object")
    if "predictionLines" in payload and not isinstance(payload["predictionLines"], dict):
        raise ValueError("predictionLines must be an object")


class SSQHandler(BaseHTTPRequestHandler):
    server_version = "SSQLocalServer/1.0"

    def log_message(self, format, *args):
        return

    def send_bytes(self, status, content_type, body):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_text(self, status, content_type, text):
        self.send_bytes(status, content_type, text.encode("utf-8"))

    def send_json(self, status, payload):
        self.send_text(status, "application/json; charset=utf-8", json.dumps(payload, ensure_ascii=False, separators=(",", ":")))

    def do_GET(self):
        self.handle_request()

    def do_HEAD(self):
        self.handle_request()

    def do_POST(self):
        self.handle_request()

    def handle_request(self):
        parsed = urllib.parse.urlsplit(self.path)
        request_path = urllib.parse.unquote(parsed.path).lstrip("/") or "app/index.html"
        if request_path == "launch-ready.js":
            self.send_text(200, "application/javascript; charset=utf-8", "window.__SSQ_READY__ = true;")
            return
        if request_path == "api/records":
            self.handle_records()
            return
        if request_path == "api/refresh":
            if self.command != "GET":
                self.send_json(405, {"error": "method not allowed"})
                return
            self.handle_refresh()
            return
        self.handle_static(request_path)

    def handle_records(self):
        if self.command == "GET":
            if RECORD_PATH.is_file():
                self.send_bytes(200, "application/json; charset=utf-8", RECORD_PATH.read_bytes())
            else:
                self.send_json(404, {"error": "record file not found"})
            return
        if self.command == "POST":
            try:
                content_length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self.send_json(400, {"error": "invalid content length"})
                return
            if content_length < 1 or content_length > MAX_RECORD_BYTES:
                self.send_json(413, {"error": "record is too large"})
                return
            try:
                body = self.rfile.read(content_length).decode("utf-8")
            except UnicodeDecodeError:
                self.send_json(400, {"error": "record must be utf-8"})
                return
            try:
                payload = json.loads(body)
                validate_record_payload(payload)
            except (json.JSONDecodeError, ValueError) as error:
                self.send_json(400, {"error": "invalid record", "message": str(error)})
                return
            encoded = body.encode("utf-8")
            if RECORD_PATH.is_file() and RECORD_PATH.read_bytes() == encoded:
                self.send_json(200, {"ok": True, "unchanged": True})
                return
            backup_record_file()
            write_text_atomic(RECORD_PATH, body)
            self.send_json(200, {"ok": True})
            return
        self.send_json(405, {"error": "method not allowed"})

    def handle_refresh(self):
        try:
            payload = merge_with_local_history(get_500_payload())
            assert_lottery_payload(payload)
            save_data_files(payload)
            self.send_json(200, payload)
        except Exception as error:
            self.send_json(502, {"error": "refresh failed", "message": str(error)})

    def handle_static(self, request_path):
        if request_path not in PUBLIC_DATA_FILES and not re.fullmatch(r"app/(?:[A-Za-z0-9._-]+\.html|core/[A-Za-z0-9._-]+\.js)", request_path):
            self.send_text(404, "text/plain; charset=utf-8", "Not found")
            return
        full_path = (PROJECT_ROOT / request_path).resolve()
        try:
            full_path.relative_to(PROJECT_ROOT)
        except ValueError:
            self.send_text(404, "text/plain; charset=utf-8", "Not found")
            return
        if not full_path.is_file():
            self.send_text(404, "text/plain; charset=utf-8", "Not found")
            return
        content_type = mimetypes.guess_type(str(full_path))[0] or "application/octet-stream"
        if content_type.startswith("text/") or full_path.suffix in {".js", ".json"}:
            content_type += "; charset=utf-8"
        self.send_bytes(200, content_type, full_path.read_bytes())


def main():
    parser = argparse.ArgumentParser(description="双色球分析标注本地服务")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    os.chdir(PROJECT_ROOT)
    if test_existing_server(args.port):
        return 0

    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), SSQHandler)
    except OSError as error:
        print(f"无法启动本地服务：端口 {args.port} 已被其他程序占用。请关闭占用程序后重试。({error})", file=sys.stderr)
        return 2
    save_server_state(server.server_port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
