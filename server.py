# server.py — mitmproxy addon (master copy — auto-copied to each instance on restart)
# ─────────────────────────────────────────────────────────────────────────────
#  Auth   : proxy_uids JOIN proxy_keys → IP check only (no UID check)
#           proxy_uids.ip → status + expires_at (Unix timestamp, 0=unlimited)
#           key_instances (optional) → per-port binding
#  Login  : majorlogin intercepted in response()
#           ACTIVE    → 400 + success msg
#           BANNED    → 400 + banned msg
#           EXPIRED   → 400 + expired msg
#           NOT_FOUND → 400 + not_registered msg
#  Inject : 3-stage file match: exact → tilde → keyword prefix
#           Range/ETag/Last-Modified/304/206 full support
#  Hosts  : BLOCKED_HOSTS — only kill confirmed harmful domains (small list)
#           Unknown domains pass through — no whitelist-kill (fixes India/CDN block)
#           FF_DOMAINS — inject on these domains only
# ─────────────────────────────────────────────────────────────────────────────

from mitmproxy import http, ctx
import os, time, threading, ipaddress, hashlib, json
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime, timezone, timedelta

# ══════════════════════════════════════════════════════════════════════════════
#  .env LOADER
# ══════════════════════════════════════════════════════════════════════════════

def _load_dotenv(path):
    result = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                result[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return result

def _find_dotenv():
    d = os.path.dirname(os.path.abspath(__file__))
    for path in [
        os.environ.get("DOTENV_PATH", ""),
        "/root/proxies-bot/.env",
        os.path.join(d, ".env"),
        os.path.join(d, "../.env"),
        os.path.join(d, "../../.env"),
        os.path.join(d, "../../../.env"),
    ]:
        if path and os.path.isfile(path):
            v = _load_dotenv(path)
            if v.get("DB_NAME"):
                print(f"[server.py] .env loaded: {path}")
                return v
    print("[server.py] WARNING: .env not found — using env vars or defaults")
    return {}

_dotenv = _find_dotenv()

def _env(key, default=""):
    return os.environ.get(key) or _dotenv.get(key) or default

# ══════════════════════════════════════════════════════════════════════════════
#  CONFIG
# ══════════════════════════════════════════════════════════════════════════════

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

def _detect_port():
    val = _env("PROXY_PORT", "0")
    if val and val != "0":
        try: return int(val)
        except ValueError: pass
    import re
    for part in [os.path.basename(_SCRIPT_DIR),
                 os.path.basename(os.path.dirname(_SCRIPT_DIR))]:
        m = re.search(r'(\d{4,5})', part)
        if m: return int(m.group(1))
    return 0

_PORT         = _detect_port()
INSTANCES_DIR = _env("INSTANCES_DIR") or _env("INSTANCES_BASE") or os.path.dirname(_SCRIPT_DIR)
BASE_DIR      = os.path.join(INSTANCES_DIR, f"instance_{_PORT}") if _PORT else _SCRIPT_DIR
LOG_PREFIX    = f"proxy:{_PORT}" if _PORT else "proxy"

# MySQL
DB_HOST = _env("DB_HOST", "localhost")
DB_PORT = int(_env("DB_PORT", "3306"))
DB_NAME = _env("DB_NAME", "proxy")
DB_USER = _env("DB_USER", "root")
DB_PASS = _env("DB_PASS", "")

# Cache TTLs
IP_CACHE_TTL  = 5
MSG_CACHE_TTL = 60

LOGIN_KEYWORD = "majorlogin"

_FALLBACK_MSGS = {
    "success":        "[00FF88]✅ Activated Successfully\n[FFFFFF]Turn Off Proxy And Enter Game.\n[FFAA00]UID: [00FFFF]{ip}\n[FFAA00]IP: [00FFFF]{ip}\n[00FF88]Expires: [FFFFFF]{expires}",
    "banned":         "[FF0000]⛔ Access Revoked\n[FFFFFF]Your account has been banned.\n[FFAA00]IP: [00FFFF]{ip}",
    "not_registered": "[FF6600]🔒 Not Activated\n[FFFFFF]IP not registered. Contact admin.\n[FFAA00]IP: [00FFFF]{ip}",
    "expired":        "[FF8800]⏰ Subscription Expired\n[FFFFFF]Contact admin to renew.\n[FFAA00]IP: [00FFFF]{ip}\n[FF6600]Expired: [FFFFFF]{expires}",
}

# Webhook
WEBHOOK_PORT  = 9900 + (_PORT % 100 if _PORT else 1)
WEBHOOK_TOKEN = _env("PROXY_TOKEN", "tokenapi")

# Display timezone
TZ_DISPLAY = timezone(timedelta(hours=7))

# Skip extensions
SKIP_EXT = {".py", ".php", ".json", ".sql", ".md", ".txt", ".log", ".rar", ".sh", ".pyc"}

# Inject keyword priority
INJECT_KEYWORDS = [
    "shaders",
    "assetindexer",
    "optionalavatarres",
    "cache_res",
    "fileinfo",
    "avatar",
    "gameassetbundles",
]

# ── Anti-ban BLOCK list ───────────────────────────────────────────────────────
BLOCKED_HOSTS = []

# ── FF domains ────────────────────────────────────────────────────────────────
FF_DOMAINS = (
    "freefiremobile.com", "freefireind.in", "ffmax",
    "garena.com", "garenasea.com",
    "ggpolarbear.com", "purplevioleto.com", "ggblueshark.com",
    "freefirebr.com", "freefireid.com", "freefireth.com",
    "potatsocontent.com",
    "gameassetbundles.com",
    "optionalavatarres.com",
    "akamaized.net", "akamaihd.net", "akamaiedge.net",
    "cloudfront.net", "amazonaws.com",
    "cdn-gf.garena.com", "cdn.garena.com", "dl.garena.com", "asset.garena.com",
    "byteplus.com", "cdn77.com", "cachefly.net",
)

# Skip URL patterns
SKIP_URL_PATTERNS = (
    "ver.php", "version.php", "versioncheck",
    "config.php", "checkupdate", "getversion",
)

# ══════════════════════════════════════════════════════════════════════════════
#  STATE
# ══════════════════════════════════════════════════════════════════════════════

_ip_cache:  dict = {}
_msg_cache: dict = {}
_cache_lock = threading.Lock()

# ══════════════════════════════════════════════════════════════════════════════
#  IP HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def normalize_ip(ip):
    if not ip: return ""
    ip = str(ip).strip()
    try:
        addr = ipaddress.ip_address(ip)
        if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
            return str(addr.ipv4_mapped)
        return str(addr)
    except ValueError:
        return ip[7:] if ip.startswith("::ffff:") else ip

def _is_private_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
        return addr.is_private or addr.is_loopback or addr.is_link_local
    except ValueError:
        return False

def _client_ip(flow: http.HTTPFlow) -> str:
    try:
        return normalize_ip(flow.client_conn.peername[0])
    except Exception:
        return ""

# ══════════════════════════════════════════════════════════════════════════════
#  MYSQL CONNECTION
# ══════════════════════════════════════════════════════════════════════════════

def _db_connect():
    kw = dict(
        host=DB_HOST, port=DB_PORT,
        user=DB_USER, password=DB_PASS,
        database=DB_NAME, charset="utf8mb4",
    )
    try:
        import pymysql
        return pymysql.connect(
            **kw, connect_timeout=5, read_timeout=5,
            write_timeout=5, autocommit=True
        )
    except ImportError:
        pass
    try:
        import mysql.connector
        return mysql.connector.connect(**kw, connection_timeout=5)
    except ImportError:
        print(f"❌ {LOG_PREFIX} No MySQL driver! Run: pip install pymysql")
        return None

# ══════════════════════════════════════════════════════════════════════════════
#  DB: IP AUTH LOOKUP
# ══════════════════════════════════════════════════════════════════════════════

def _query_ip(client_ip):
    conn = _db_connect()
    if not conn: return None
    try:
        cur = conn.cursor()
        row = None
        for ip_val in dict.fromkeys([normalize_ip(client_ip), client_ip]):
            cur.execute("""
                SELECT pu.status,
                       pu.expires_at,
                       pk.id          AS pk_id,
                       COALESCE(pk.status, 'active') AS key_status
                FROM   proxy_uids pu
                JOIN   proxy_keys pk ON pk.id = pu.key_id
                WHERE  pu.ip = %s
                LIMIT  1
            """, (ip_val,))
            row = cur.fetchone()
            if row: break

        if not row:
            cur.close(); conn.close()
            return {"status": "NOT_FOUND", "expires_at": 0}

        uid_status, expires_at, pk_id, key_status = row

        if key_status and str(key_status) != "active":
            cur.close(); conn.close()
            return {"status": "NOT_FOUND", "expires_at": 0}

        if _PORT:
            try:
                cur.execute(
                    "SELECT COUNT(*) FROM key_instances WHERE key_id=%s",
                    (pk_id,)
                )
                count = (cur.fetchone() or [0])[0]
                if count > 0:
                    cur.execute("""
                        SELECT 1
                        FROM   key_instances ki
                        JOIN   proxy_instances pi ON pi.id = ki.instance_id
                        WHERE  ki.key_id = %s
                          AND  pi.port   = %s
                        LIMIT  1
                    """, (pk_id, _PORT))
                    if not cur.fetchone():
                        print(f"🚫 {LOG_PREFIX} Key #{pk_id} not bound to port {_PORT} — deny {client_ip}")
                        cur.close(); conn.close()
                        return {"status": "NOT_FOUND", "expires_at": 0}
            except Exception as e:
                print(f"⚠️  {LOG_PREFIX} key_instances check skipped: {e}")

        cur.close(); conn.close()
        return {
            "status":     str(uid_status),
            "expires_at": int(expires_at or 0),
        }

    except Exception as e:
        print(f"⚠️  {LOG_PREFIX} DB error in _query_ip: {e}")
        try: conn.close()
        except Exception: pass
        return None

# ══════════════════════════════════════════════════════════════════════════════
#  DB: MESSAGES
# ══════════════════════════════════════════════════════════════════════════════

def _get_msg(key):
    now = time.time()
    with _cache_lock:
        cached = _msg_cache.get(key)
        if cached and now - cached[1] < MSG_CACHE_TTL:
            return cached[0]
    conn = _db_connect()
    if conn:
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT content FROM proxy_messages WHERE msg_key=%s LIMIT 1",
                (key,)
            )
            row = cur.fetchone()
            cur.close(); conn.close()
            if row:
                content = str(row[0])
                with _cache_lock: _msg_cache[key] = (content, now)
                return content
        except Exception:
            try: conn.close()
            except Exception: pass
    return _FALLBACK_MSGS.get(key, "")

# ══════════════════════════════════════════════════════════════════════════════
#  IP AUTH (cached)
# ══════════════════════════════════════════════════════════════════════════════

def _lookup(client_ip):
    now = time.time()
    with _cache_lock:
        c = _ip_cache.get(client_ip)
        if c and now - c["fetched_at"] < IP_CACHE_TTL:
            return c
    result = _query_ip(client_ip)
    if result is None:
        with _cache_lock:
            stale = _ip_cache.get(client_ip)
        if stale:
            print(f"⚠️  {LOG_PREFIX} DB down — using stale cache for {client_ip}")
            return stale
        return {"status": "DB_ERROR", "expires_at": 0, "fetched_at": now}
    result["fetched_at"] = now
    with _cache_lock: _ip_cache[client_ip] = result
    return result

def auth_ip(client_ip):
    d  = _lookup(client_ip)
    st = d.get("status", "NOT_FOUND")
    ex = int(d.get("expires_at", 0))

    if st == "DB_ERROR":  return "NOT_FOUND", "DB unavailable"
    if st == "NOT_FOUND": return "NOT_FOUND", "IP not registered"
    if st == "blocked":   return "BANNED",    "IP blocked"
    if st == "active":
        if ex == 0 or ex > int(time.time()):
            return "ACTIVE", "OK"
        return "EXPIRED", "Subscription expired"
    return "NOT_FOUND", f"Unknown status: {st}"

def _authorized(ip):
    return auth_ip(ip)[0] == "ACTIVE"

def _expiry_text(ip):
    ex = int(_lookup(ip).get("expires_at", 0))
    if not ex: return "Unlimited"
    dt  = datetime.fromtimestamp(ex, tz=TZ_DISPLAY)
    rem = ex - int(time.time())
    s   = dt.strftime("%d/%m/%Y %H:%M")
    if rem > 0:
        d,h,m = int(rem//86400), int(rem%86400//3600), int(rem%3600//60)
        tag = f"{d}d {h}h left" if d>0 else f"{h}h {m}m left" if h>0 else f"{m}m left"
        return f"{s} ({tag})"
    return f"{s} (expired)"

def _fmt(msg, ip):
    return msg.format(ip=ip or "unknown", expires=_expiry_text(ip))

# ══════════════════════════════════════════════════════════════════════════════
#  FILE INJECT HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _list_local_files():
    try:
        return [
            f for f in os.listdir(BASE_DIR)
            if not f.startswith(".")
            and not f.startswith("._")
            and f != "__MACOSX"
            and not any(f.endswith(e) for e in SKIP_EXT)
            and os.path.isfile(os.path.join(BASE_DIR, f))
        ]
    except Exception:
        return []

def _find_local_file(keyword: str):
    for fname in _list_local_files():
        if fname.lower().startswith(keyword.lower()):
            return fname
    return None

def _find_inject_target(url: str):
    candidates = _list_local_files()
    url_lower  = url.lower()

    url_name = url.rstrip("/").split("?")[0].split("/")[-1]
    if url_name in candidates:
        ctx.log.info(f"⚡ [{LOG_PREFIX}] inject exact: {url_name}")
        return url_name, "exact"

    tilde_name = url_name.replace("%", "~")
    if tilde_name in candidates:
        ctx.log.info(f"⚡ [{LOG_PREFIX}] inject tilde: {tilde_name}")
        return tilde_name, "tilde"

    for keyword in INJECT_KEYWORDS:
        if keyword in url_lower:
            local_file = _find_local_file(keyword)
            if local_file:
                ctx.log.info(f"⚡ [{LOG_PREFIX}] inject keyword({keyword}): {local_file}")
                return local_file, keyword
            else:
                ctx.log.warn(
                    f"[{LOG_PREFIX}] keyword '{keyword}' matched URL "
                    f"but no file in {BASE_DIR}"
                )

    return None, None

def _serve(flow: http.HTTPFlow, fname: str, ip: str):
    file_path = os.path.join(BASE_DIR, fname)
    if not os.path.exists(file_path):
        ctx.log.warn(f"[{LOG_PREFIX}] File missing: {file_path}")
        return

    with open(file_path, "rb") as fp:
        data = fp.read()

    total = len(data)
    etag  = '"' + hashlib.md5(data).hexdigest() + '"'
    mtime = os.path.getmtime(file_path)
    last_modified = datetime.fromtimestamp(mtime, tz=timezone.utc).strftime(
        "%a, %d %b %Y %H:%M:%S GMT"
    )

    if flow.request.headers.get("If-None-Match") == etag:
        flow.response = http.Response.make(
            304, b"",
            {
                "ETag":          etag,
                "Cache-Control": "public, max-age=31536000, immutable",
            }
        )
        ctx.log.info(f"📦 [{LOG_PREFIX}] 304 cached {fname} → {ip}")
        return

    common = {
        "Content-Type":  "application/octet-stream",
        "Accept-Ranges": "bytes",
        "ETag":          etag,
        "Last-Modified": last_modified,
        "Cache-Control": "public, max-age=31536000, immutable",
    }

    rh = flow.request.headers.get("Range", "")
    if rh.startswith("bytes="):
        try:
            spec  = rh.split("=", 1)[1].split(",")[0].strip()
            s_s, e_s = spec.split("-")
            start = int(s_s) if s_s else max(0, total - int(e_s))
            end   = int(e_s) if e_s else total - 1
            start = max(0, min(start, total - 1))
            end   = max(start, min(end, total - 1))
        except Exception:
            start, end = 0, total - 1

        if start >= total or start > end:
            flow.response = http.Response.make(
                416, b"",
                {**common, "Content-Range": f"bytes */{total}"}
            )
            return

        chunk = data[start:end + 1]
        flow.response = http.Response.make(
            206, chunk,
            {
                **common,
                "Content-Length": str(len(chunk)),
                "Content-Range":  f"bytes {start}-{end}/{total}",
                "Connection":     "keep-alive",
            }
        )
        ctx.log.info(f"📦 [{LOG_PREFIX}] 206 {fname} {start}-{end}/{total} → {ip}")
        return

    flow.response = http.Response.make(
        200, data,
        {
            **common,
            "Content-Length": str(total),
            "Connection":     "keep-alive",
        }
    )
    ctx.log.info(f"📦 [{LOG_PREFIX}] 200 {fname} ({total}B) → {ip}")

# ══════════════════════════════════════════════════════════════════════════════
#  PROXY ADDON
# ══════════════════════════════════════════════════════════════════════════════

class ProxyAddon:

    def request(self, flow: http.HTTPFlow) -> None:
        try:
            host = flow.request.host
            if any(kw in host for kw in BLOCKED_HOSTS):
                ctx.log.warn(f"[{LOG_PREFIX}] anti-ban KILL → {host}")
                flow.kill()
                return
        except Exception as e:
            ctx.log.error(f"[{LOG_PREFIX}] request() error: {e}")

    def response(self, flow: http.HTTPFlow) -> None:
        try:
            host = flow.request.host
            url  = flow.request.pretty_url
            ip   = _client_ip(flow)

            # ── 1. majorlogin intercept ───────────────────────────────────────
            if LOGIN_KEYWORD in url.lower():
                if flow.response:
                    status, detail = auth_ip(ip)
                    print(f"\n{'═'*52}\n  {LOG_PREFIX}  IP={ip}  Auth={status} ({detail})\n{'═'*52}\n")
                    msg_key = {"ACTIVE": "success", "BANNED": "banned", "EXPIRED": "expired"}.get(status, "not_registered")
                    body = _fmt(_get_msg(msg_key), ip).encode("utf-8")
                    flow.response.status_code = 400
                    flow.response.content = body
                    flow.response.headers["Content-Type"] = "text/plain; charset=utf-8"
                    flow.response.headers["Content-Length"] = str(len(body))
                    icon = "✅" if status == "ACTIVE" else "🚫"
                    print(f"{icon} {LOG_PREFIX} {status} → {ip}")
                return

            # Only inject on FF domains or bare IP CDN
            is_ff = any(d in host for d in FF_DOMAINS)

            is_bare_ip = False
            try:
                ipaddress.ip_address(host)
                is_bare_ip = True
            except ValueError:
                pass

            if not is_ff and not is_bare_ip:
                return

            if any(p in url for p in SKIP_URL_PATTERNS):
                ctx.log.info(f"[{LOG_PREFIX}] skip version/config: {url}")
                return

            target, matched_by = _find_inject_target(url)
            if not target:
                return

            status, detail = auth_ip(ip)
            if status != "ACTIVE":
                ctx.log.warn(
                    f"[{LOG_PREFIX}] inject DENIED {status} ({detail}) "
                    f"IP={ip} url={url}"
                )
                return

            _serve(flow, target, ip)

        except Exception as e:
            ctx.log.error(f"[{LOG_PREFIX}] response() error: {e}")

# ══════════════════════════════════════════════════════════════════════════════
#  WEBHOOK SERVER
# ══════════════════════════════════════════════════════════════════════════════

class _WH(BaseHTTPRequestHandler):

    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length", 0) or 0)
            if n > 0: self.rfile.read(n)
        except Exception:
            pass

        if self.headers.get("X-Proxy-Token", "") != WEBHOOK_TOKEN:
            self._send(401, {"error": "unauthorized"})
            return

        with _cache_lock:
            _ip_cache.clear()
            _msg_cache.clear()

        self._send(200, {"ok": True, "port": _PORT, "msg": "ip+msg cache cleared"})
        print(f"📡 {LOG_PREFIX} Cache cleared via webhook")

    def do_GET(self):
        with _cache_lock:
            n_ip  = len(_ip_cache)
            n_msg = len(_msg_cache)
        self._send(200, {
            "status":       "online",
            "port":         _PORT,
            "base_dir":     BASE_DIR,
            "db":           f"{DB_USER}@{DB_HOST}/{DB_NAME}",
            "cached_ips":   n_ip,
            "cached_msgs":  n_msg,
            "local_files":  _list_local_files(),
            "blocked_hosts_count": len(BLOCKED_HOSTS),
        "ff_domains_count":    len(FF_DOMAINS),
        })

    def _send(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type",   "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass

def _start_webhook():
    try:
        HTTPServer(("0.0.0.0", WEBHOOK_PORT), _WH).serve_forever()
    except Exception as e:
        print(f"⚠️  {LOG_PREFIX} Webhook error: {e}")

# ══════════════════════════════════════════════════════════════════════════════
#  STARTUP
# ══════════════════════════════════════════════════════════════════════════════

print(f"🚀 {LOG_PREFIX}  port={_PORT}  db={DB_USER}@{DB_HOST}/{DB_NAME}")
print(f"📁 {LOG_PREFIX}  BASE_DIR={BASE_DIR}")
print(f"📡 {LOG_PREFIX}  Webhook port={WEBHOOK_PORT}")
print(f"✅ {LOG_PREFIX}  v3.3 — BLOCKED_HOSTS passthrough | no whitelist-kill | India fix")

os.makedirs(BASE_DIR, exist_ok=True)

files = _list_local_files()
if files:
    print(f"📂 {LOG_PREFIX}  Injectable files: {files}")
else:
    print(f"⚠️  {LOG_PREFIX}  No injectable files in {BASE_DIR}")

threading.Thread(target=_start_webhook, daemon=True).start()

_test = _query_ip("0.0.0.0")
if _test is not None:
    print(f"✅ {LOG_PREFIX}  MySQL connected — {DB_NAME}@{DB_HOST}")
else:
    print(f"❌ {LOG_PREFIX}  MySQL FAILED — check .env")
    print(f"   pip install pymysql  (inside mitmproxy venv)")

addons = [ProxyAddon()]
