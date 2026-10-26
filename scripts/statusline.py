"""状态栏脚本：向用户持续展示 IP、地区、ASN / 域名和当前时间。

在 ~/.claude/settings.json 中配置：
  "statusLine": { "type": "command", "command": "python3 <本文件路径>" }
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ip_lib import inspect_ip, ip_local_now, network_str, region_str


def main():
    try:
        sys.stdin.read()
    except Exception:
        pass

    try:
        result = inspect_ip(force=False, timeout=2)
        info = result["info"]
        now, tz_name = ip_local_now(info)
        ip = (info or {}).get("ip") or "unknown"
        region = region_str(info) or "unknown"
        network = network_str(info) or "unknown"
        local_time = now.strftime("%Y-%m-%d %H:%M:%S") if now else "unknown"
        cache = " · 缓存" if result["from_cache"] else ""
        print(f"IP {ip} · {region} · ASN / 域名 {network} · 时区 {tz_name} · 时间 {local_time}{cache}")
    except Exception:
        print("IP unknown · unknown · ASN / 域名 unknown · 时区 unknown · 时间 unknown")


if __name__ == "__main__":
    main()
