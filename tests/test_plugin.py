import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import ip_lib
import statusline


class FakeResponse:
    def __init__(self, value):
        self.value = value

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return json.dumps(self.value).encode()


class PluginTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        base = Path(self.tmp.name)
        self.data_dir = base / "data"
        paths = {
            "DATA_DIR": self.data_dir,
            "CACHE_FILE": self.data_dir / "ip-cache.json",
            "HISTORY_FILE": self.data_dir / "ip-history.json",
            "CONFIG_FILE": self.data_dir / "config.json",
            "LEGACY_DATA_DIR": base / "legacy",
        }
        for name, value in paths.items():
            patcher = patch.object(ip_lib, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.info_a = {
            "ip": "203.0.113.10",
            "city": "Shanghai",
            "region": "Shanghai",
            "country": "CN",
            "timezone": "Asia/Shanghai",
            "asn": "AS64500",
            "asn_name": "Example Backbone",
            "domain_name": "edge-a.example.test",
            "source": "test-a",
        }
        self.info_b = {
            "ip": "203.0.113.11",
            "city": "Los Angeles",
            "region": "CA",
            "country": "US",
            "timezone": "America/Los_Angeles",
            "asn": "AS64501",
            "asn_name": "Example Transit",
            "domain_name": "edge-b.example.test",
            "source": "test-b",
        }

    def write_cli_data(self, data_dir):
        data_dir.mkdir(parents=True)
        (data_dir / "ip-cache.json").write_text(
            json.dumps({"fetched_at": time.time() + 3600, "info": self.info_a}),
            encoding="utf-8",
        )
        (data_dir / "ip-history.json").write_text("[]", encoding="utf-8")
        (data_dir / "config.json").write_text(
            json.dumps({"quiet_start": 0, "quiet_end": 6}),
            encoding="utf-8",
        )

    def run_cli(self, script, data_dir, *args):
        env = os.environ.copy()
        env["CC_FOUR_O_THREE_DATA_DIR"] = str(data_dir)
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        return subprocess.run(
            [sys.executable, str(ROOT / "scripts" / script), *args],
            input="{}",
            text=True,
            capture_output=True,
            env=env,
            timeout=10,
        )

    def test_source_fallback_and_exhaustion(self):
        calls = []

        def fake_urlopen(request, timeout):
            calls.append(request.full_url)
            if len(calls) == 1:
                raise OSError("simulated outage")
            return FakeResponse(
                {
                    "ip": self.info_a["ip"],
                    "city": "Shanghai",
                    "country_code": "CN",
                    "timezone": "Asia/Shanghai",
                }
            )

        with patch.object(ip_lib.urllib.request, "urlopen", fake_urlopen):
            info = ip_lib.fetch_ip(timeout=1)
        self.assertEqual(info["source"], "ipapi.co")
        self.assertEqual(len(calls), 2)
        with patch.object(ip_lib.urllib.request, "urlopen", side_effect=OSError("down")) as request:
            with self.assertRaises(RuntimeError):
                ip_lib.fetch_ip(timeout=1)
        self.assertEqual(request.call_count, 3)

    def test_asn_and_domain_normalization(self):
        ipinfo = ip_lib._normalize_ipinfo({
            "org": "AS64500 Example Backbone",
            "hostname": "edge-a.example.test",
        })
        self.assertEqual(ipinfo["asn"], "AS64500")
        self.assertEqual(ipinfo["asn_name"], "Example Backbone")
        self.assertEqual(ipinfo["domain_name"], "edge-a.example.test")

        ipapi = ip_lib._normalize_ipapi({
            "asn": "AS64501",
            "org": "Example Transit",
            "hostname": "edge-b.example.test",
        })
        self.assertEqual(ipapi["asn"], "AS64501")
        self.assertEqual(ipapi["asn_name"], "Example Transit")
        self.assertEqual(ipapi["domain_name"], "edge-b.example.test")

        ipsb = ip_lib._normalize_ipsb({"asn": 64502, "asn_organization": "Example Wholesale"})
        self.assertEqual(ipsb["asn"], "AS64502")
        self.assertEqual(ipsb["asn_name"], "Example Wholesale")
        self.assertEqual(ipsb["domain_name"], "")
        self.assertEqual(ip_lib._normalize_ipsb({"organization": "Example ISP"})["asn_name"], "Example ISP")
        self.assertEqual(ip_lib._normalize_ipsb({"isp": "Example ISP"})["asn_name"], "Example ISP")

        no_number = ip_lib._normalize_ipinfo({"org": "Example Network"})
        self.assertEqual(no_number["asn"], "")
        self.assertEqual(no_number["asn_name"], "Example Network")
        self.assertEqual(ip_lib.network_str({"domain_name": "edge.example.test"}), "edge.example.test")
        self.assertEqual(ip_lib.network_str(None), "")

    def test_config_validation_and_quiet_edges(self):
        ip_lib._write_json(
            ip_lib.CONFIG_FILE,
            {"quiet_start": "bad", "quiet_end": 99, "cache_ttl": -1, "timeout": 0},
        )
        cfg = ip_lib.load_config()
        self.assertEqual(cfg["quiet_start"], 0)
        self.assertEqual(cfg["quiet_end"], 6)
        self.assertEqual(cfg["cache_ttl"], 300)
        self.assertEqual(cfg["timeout"], 5)
        self.assertFalse(ip_lib.in_quiet_period(3, 6, 6))
        self.assertTrue(ip_lib.in_quiet_period(23, 22, 6))
        self.assertTrue(ip_lib.in_quiet_period(2, 22, 6))
        self.assertFalse(ip_lib.in_quiet_period(12, 22, 6))

    def test_cache_refresh_and_stale_fallback(self):
        with patch.object(ip_lib, "fetch_ip", return_value=self.info_a) as fetch:
            self.assertEqual(ip_lib.current_ip(), self.info_a)
            self.assertEqual(ip_lib.current_ip(), self.info_a)
            self.assertEqual(fetch.call_count, 1)
            ip_lib.current_ip(force=True)
            self.assertEqual(fetch.call_count, 2)
        cache = ip_lib.read_cache()
        cache["fetched_at"] = 0
        ip_lib._write_json(ip_lib.CACHE_FILE, cache)
        with patch.object(ip_lib, "fetch_ip", side_effect=OSError("down")):
            self.assertEqual(ip_lib.current_ip(), self.info_a)
            result = ip_lib.inspect_ip(force=True)
        self.assertEqual(result["info"], self.info_a)
        self.assertTrue(result["from_cache"])
        self.assertTrue(result["is_stale"])
        self.assertIn("down", result["error"])

    def test_stale_snapshot_is_not_recorded_as_a_new_sighting(self):
        with patch.object(ip_lib, "fetch_ip", return_value=self.info_a):
            ip_lib.current_ip()
        cache = ip_lib.read_cache()
        cache["fetched_at"] = 0
        ip_lib._write_json(ip_lib.CACHE_FILE, cache)
        with patch.object(ip_lib, "fetch_ip", side_effect=OSError("down")):
            result = ip_lib.ip_snapshot(force=True, record=True)
        self.assertEqual(result["info"], self.info_a)
        self.assertTrue(result["is_stale"])
        self.assertEqual(result["history"], [])
        self.assertFalse(result["changed"])

    def test_unknown_ip_and_timezone_never_use_system_time(self):
        with patch.object(ip_lib, "fetch_ip", side_effect=OSError("down")):
            result = ip_lib.ip_snapshot(record=True)
        self.assertIsNone(result["info"])
        self.assertEqual(result["timezone"], "unknown")
        self.assertEqual(result["local_time"], "unknown")
        self.assertEqual(result["history"], [])
        now, timezone = ip_lib.ip_local_now({"timezone": "Invalid/Zone"})
        self.assertIsNone(now)
        self.assertEqual(timezone, "unknown")

    def test_legacy_data_is_read_then_written_to_new_directory(self):
        legacy = Path(self.tmp.name) / "legacy"
        legacy.mkdir()
        (legacy / "config.json").write_text(json.dumps({"quiet_start": 22}), encoding="utf-8")
        (legacy / "ip-history.json").write_text(
            json.dumps([{"ip": self.info_a["ip"], "first_seen": "old", "last_seen": "old"}]),
            encoding="utf-8",
        )
        (legacy / "ip-cache.json").write_text(
            json.dumps({"fetched_at": time.time() + 3600, "info": self.info_a}),
            encoding="utf-8",
        )
        self.assertEqual(ip_lib.load_config()["quiet_start"], 22)
        with patch.object(ip_lib, "fetch_ip") as fetch:
            self.assertEqual(ip_lib.current_ip(), self.info_a)
            fetch.assert_not_called()
        changed, previous = ip_lib.record_ip(self.info_b)
        self.assertTrue(changed)
        self.assertEqual(previous["ip"], self.info_a["ip"])
        history = json.loads((self.data_dir / "ip-history.json").read_text())
        self.assertEqual(len(history), 2)
        self.assertTrue((self.data_dir / "ip-history.json").exists())

    def test_history_records_change_revisit_and_metadata_refresh(self):
        changed, previous = ip_lib.record_ip(self.info_a)
        self.assertTrue(changed)
        self.assertIsNone(previous)
        changed, previous = ip_lib.record_ip(self.info_a)
        self.assertFalse(changed)
        self.assertEqual(previous["ip"], self.info_a["ip"])
        changed, previous = ip_lib.record_ip(self.info_b)
        self.assertTrue(changed)
        self.assertEqual(previous["ip"], self.info_a["ip"])
        history = json.loads(ip_lib.HISTORY_FILE.read_text())
        self.assertEqual([row["ip"] for row in history], [self.info_a["ip"], self.info_b["ip"]])
        self.assertTrue(all(row["first_seen"] and row["last_seen"] for row in history))
        self.assertEqual(history[-1]["asn"], "AS64501")
        self.assertEqual(history[-1]["domain_name"], "edge-b.example.test")
        revisited = dict(
            self.info_b,
            timezone="Etc/UTC",
            asn_name="Updated Backbone",
            domain_name="updated.example.test",
        )
        ip_lib.record_ip(revisited)
        history = json.loads(ip_lib.HISTORY_FILE.read_text())
        self.assertEqual(history[-1]["timezone"], "Etc/UTC")
        self.assertEqual(history[-1]["asn_name"], "Updated Backbone")
        self.assertEqual(history[-1]["domain_name"], "updated.example.test")

    def test_real_statusline_and_ip_cli_commands(self):
        data_dir = Path(self.tmp.name) / "cli-data"
        self.write_cli_data(data_dir)
        status = self.run_cli("statusline.py", data_dir)
        self.assertEqual(status.returncode, 0, status.stderr)
        self.assertIn(self.info_a["ip"], status.stdout)
        self.assertIn("AS64500 Example Backbone", status.stdout)
        self.assertIn("Asia/Shanghai", status.stdout)
        self.assertIn("时间", status.stdout)

        inspected = self.run_cli("ip_cli.py", data_dir, "--no-record")
        self.assertEqual(inspected.returncode, 0, inspected.stderr)
        payload = json.loads(inspected.stdout)
        self.assertEqual(payload["info"]["ip"], self.info_a["ip"])
        self.assertEqual(payload["info"]["asn"], "AS64500")
        self.assertEqual(payload["info"]["asn_name"], "Example Backbone")
        self.assertEqual(payload["info"]["domain_name"], "edge-a.example.test")
        self.assertEqual(payload["timezone"], "Asia/Shanghai")
        self.assertNotEqual(payload["local_time"], "unknown")

        first = json.loads(self.run_cli("ip_cli.py", data_dir).stdout)
        second = json.loads(self.run_cli("ip_cli.py", data_dir).stdout)
        self.assertTrue(first["changed"])
        self.assertFalse(second["changed"])
        self.assertEqual(len(second["history"]), 1)

    def test_statusline_prints_unknown_without_an_ip(self):
        output = io.StringIO()
        with patch.object(
            statusline,
            "inspect_ip",
            return_value={"info": None, "from_cache": False},
        ), patch.object(sys, "stdin", io.StringIO("{}")), redirect_stdout(output):
            statusline.main()
        self.assertEqual(
            output.getvalue().strip(),
            "IP unknown · unknown · ASN / 域名 unknown · 时区 unknown · 时间 unknown",
        )


if __name__ == "__main__":
    unittest.main()
