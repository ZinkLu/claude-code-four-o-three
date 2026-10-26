"""IP 检查、缓存、历史记录的公共库。

检查渠道（海外可靠服务，按顺序尝试，任一成功即用）：
  1. https://ipinfo.io/json   （无需 token 的免费额度）
  2. https://ipapi.co/json
  3. https://api.ip.sb/geoip
"""
import json
import os
import tempfile
import time
import urllib.request
from datetime import datetime
from pathlib import Path

from zoneinfo import ZoneInfo

BASE_DIR = Path(__file__).resolve().parent.parent
PLUGIN_NAME = "cc-four-o-three"
LEGACY_DATA_DIR = BASE_DIR / "data"
DEFAULT_DATA_DIR = Path.home() / ".claude" / "plugins" / "data" / PLUGIN_NAME
DATA_DIR = Path(
    os.environ.get("CC_FOUR_O_THREE_DATA_DIR") or str(DEFAULT_DATA_DIR)
).expanduser()
CACHE_FILE = DATA_DIR / "ip-cache.json"
HISTORY_FILE = DATA_DIR / "ip-history.json"
CONFIG_FILE = DATA_DIR / "config.json"

DEFAULT_CONFIG = {
    "cache_ttl": 300,
    "quiet_start": 0,
    "quiet_end": 6,
    "timeout": 5,
}


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    loaded = _read_json(CONFIG_FILE, {})
    if isinstance(loaded, dict):
        for key in DEFAULT_CONFIG:
            if key in loaded:
                cfg[key] = loaded[key]
    for key in ("quiet_start", "quiet_end"):
        value = cfg[key]
        if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 24:
            cfg[key] = DEFAULT_CONFIG[key]
    for key in ("cache_ttl", "timeout"):
        value = cfg[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
            cfg[key] = DEFAULT_CONFIG[key]
    return cfg


def _text(value):
    return "" if value is None else str(value).strip()


def _asn_fields(asn, name):
    asn = _text(asn)
    if asn.isdigit():
        asn = f"AS{asn}"
    elif asn.upper().startswith("AS") and asn[2:].isdigit():
        asn = asn.upper()
    return {"asn": asn, "asn_name": _text(name)}


def _normalize_ipinfo(d):
    org = _text(d.get("org"))
    prefix, _, name = org.partition(" ")
    if prefix.upper().startswith("AS") and prefix[2:].isdigit():
        network = _asn_fields(prefix, name)
    else:
        network = _asn_fields("", org)
    return {
        "ip": d.get("ip", ""),
        "city": d.get("city", ""),
        "region": d.get("region", ""),
        "country": d.get("country", ""),
        "timezone": d.get("timezone", ""),
        **network,
        "domain_name": _text(d.get("hostname")),
        "source": "ipinfo.io",
    }


def _normalize_ipapi(d):
    return {
        "ip": d.get("ip", ""),
        "city": d.get("city", ""),
        "region": d.get("region", ""),
        "country": d.get("country_code", ""),
        "timezone": d.get("timezone", ""),
        **_asn_fields(d.get("asn"), d.get("org")),
        "domain_name": _text(d.get("hostname")),
        "source": "ipapi.co",
    }


def _normalize_ipsb(d):
    return {
        "ip": d.get("ip", ""),
        "city": d.get("city", ""),
        "region": d.get("region", ""),
        "country": d.get("country_code", ""),
        "timezone": d.get("timezone", ""),
        **_asn_fields(
            d.get("asn"),
            d.get("asn_organization") or d.get("organization") or d.get("isp"),
        ),
        "domain_name": _text(d.get("hostname")),
        "source": "api.ip.sb",
    }


SOURCES = [
    ("https://ipinfo.io/json", _normalize_ipinfo),
    ("https://ipapi.co/json", _normalize_ipapi),
    ("https://api.ip.sb/geoip", _normalize_ipsb),
]


def fetch_ip(timeout=5):
    """从海外渠道获取当前公网 IP 信息，全部失败时抛异常。"""
    last_err = None
    for url, normalize in SOURCES:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "curl/8.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                info = normalize(json.loads(resp.read().decode("utf-8")))
            if info.get("ip"):
                return info
        except Exception as e:  # noqa: BLE001 - 渠道失败属预期，继续下一个
            last_err = e
    raise RuntimeError(f"所有 IP 检查渠道均失败: {last_err}")


def _legacy_path(path):
    if DATA_DIR == LEGACY_DATA_DIR:
        return None
    try:
        relative = path.relative_to(DATA_DIR)
    except ValueError:
        return None
    return LEGACY_DATA_DIR / relative


def _read_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        legacy = _legacy_path(path)
        if legacy is not None:
            try:
                return json.loads(legacy.read_text(encoding="utf-8"))
            except Exception:
                pass
    except Exception:
        pass
    return default


def _write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(obj, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temporary_path, path)
    finally:
        if temporary_path.exists():
            temporary_path.unlink()


def read_cache():
    cache = _read_json(CACHE_FILE, None)
    if not isinstance(cache, dict) or not isinstance(cache.get("info"), dict):
        return None
    if not isinstance(cache["info"].get("ip"), str) or not cache["info"]["ip"]:
        return None
    return cache


def inspect_ip(force=False, timeout=None):
    cfg = load_config()
    timeout = timeout if timeout is not None else cfg["timeout"]
    cache = read_cache()
    try:
        fetched_at = float(cache.get("fetched_at", 0)) if cache else 0
    except (TypeError, ValueError):
        fetched_at = 0
    fresh = bool(cache) and time.time() - fetched_at < cfg["cache_ttl"]
    if not force and fresh:
        return {
            "info": cache["info"],
            "fetched_at": fetched_at,
            "from_cache": True,
            "is_stale": False,
            "error": "",
        }
    try:
        info = fetch_ip(timeout=timeout)
        fetched_at = time.time()
        _write_json(CACHE_FILE, {"fetched_at": fetched_at, "info": info})
        return {
            "info": info,
            "fetched_at": fetched_at,
            "from_cache": False,
            "is_stale": False,
            "error": "",
        }
    except Exception as exc:
        return {
            "info": cache["info"] if cache else None,
            "fetched_at": fetched_at,
            "from_cache": bool(cache),
            "is_stale": bool(cache) and not fresh,
            "error": str(exc),
        }


def current_ip(force=False, timeout=None):
    """获取当前 IP 信息。非 force 时优先用未过期缓存；失败时回退到过期缓存。"""
    result = inspect_ip(force=force, timeout=timeout)
    if result["info"] is None:
        raise RuntimeError(result["error"] or "IP 检查失败")
    return result["info"]


def read_history():
    history = _read_json(HISTORY_FILE, [])
    if not isinstance(history, list):
        return []
    return [row for row in history if isinstance(row, dict)]


def record_ip(info):
    """把当前 IP 记入历史。返回 (是否变化, 上一条记录或 None)。"""
    history = read_history()
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    prev = history[-1] if history else None
    if prev and prev.get("ip") == info["ip"]:
        for key in ("city", "region", "country", "timezone", "asn", "asn_name", "domain_name"):
            prev[key] = info.get(key, "")
        prev["last_seen"] = now
        changed = False
    else:
        history.append(
            {
                "ip": info["ip"],
                "city": info.get("city", ""),
                "region": info.get("region", ""),
                "country": info.get("country", ""),
                "timezone": info.get("timezone", ""),
                "asn": info.get("asn", ""),
                "asn_name": info.get("asn_name", ""),
                "domain_name": info.get("domain_name", ""),
                "first_seen": now,
                "last_seen": now,
            }
        )
        changed = True
    _write_json(HISTORY_FILE, history)
    return changed, prev


def ip_snapshot(force=False, record=False, timeout=None):
    result = inspect_ip(force=force, timeout=timeout)
    info = result["info"]
    changed = False
    previous = None
    if info is not None and record and not result["error"]:
        changed, previous = record_ip(info)
    now, tz_name = ip_local_now(info)
    result.update(
        {
            "changed": changed,
            "previous": previous if changed else None,
            "history": read_history()[-50:],
            "timezone": tz_name,
            "local_time": now.strftime("%Y-%m-%d %H:%M:%S") if now else "unknown",
        }
    )
    return result


def region_str(info):
    parts = [(info or {}).get(key, "") for key in ("city", "region", "country")]
    return ", ".join(p for p in parts if p)


def network_str(info):
    info = info or {}
    parts = [_text(info.get("asn")), _text(info.get("asn_name"))]
    return " ".join(part for part in parts if part) or _text(info.get("domain_name"))


def ip_local_now(info=None):
    """返回 IP 所在时区的当前时间；没有可靠时区时返回 unknown。"""
    tz_name = (info or {}).get("timezone", "")
    if tz_name:
        try:
            return datetime.now(ZoneInfo(tz_name)), tz_name
        except Exception:
            pass
    return None, "unknown"


def in_quiet_period(hour, quiet_start, quiet_end):
    if quiet_start == quiet_end:
        return False
    if quiet_start < quiet_end:
        return quiet_start <= hour < quiet_end
    return hour >= quiet_start or hour < quiet_end
