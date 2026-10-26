"""为 Claude Code Mod 提供 IP 状态的结构化 JSON。"""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ip_lib import ip_snapshot, load_config


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--no-record", action="store_true")
    parser.add_argument("--timeout", type=float)
    args = parser.parse_args()
    try:
        result = ip_snapshot(
            force=args.force,
            record=not args.no_record,
            timeout=args.timeout,
        )
        result["config"] = load_config()
    except Exception as exc:
        result = {
            "info": None,
            "fetched_at": 0,
            "from_cache": False,
            "is_stale": False,
            "error": str(exc),
            "changed": False,
            "previous": None,
            "history": [],
            "timezone": "unknown",
            "local_time": "unknown",
            "config": load_config(),
        }
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
