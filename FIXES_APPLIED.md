# Fixes Applied — Proxies Bot

## Critical Bug: Button Lag (সকল বাটনে লেট হওয়া)

### Root Cause
`vps.status()`, `vps.startAll()`, `vps.startPort()` সব synchronous `execSync` দিয়ে চলত।  
এটা Node.js event loop **পুরোটাই block** করত — মানে একটা বাটন চাপলে bot সব কাজ বন্ধ রেখে অপেক্ষা করত।

**10 ports × status check = ~5 seconds block**  
**startAll() = up to 120 seconds block**

### Fixes in `services/vps.js`
- `shAsync()` function added — `child_process.exec` (Promise-based, non-blocking)
- `isPortListeningAsync()` added — all 3 port checks in one async shell call
- `status()` → now **async + parallel** (Promise.all) — 10 ports checked simultaneously, ~500ms instead of ~5s
- `startAll()` → now **fully async** via `shAsync()` — bot stays responsive during 60s startup
- `startPort()` → uses `async setTimeout()` instead of `sh('sleep 0.5')` — non-blocking wait

### Fixes in `panels/proxy.js`
- All `vps.status()` → `await vps.status()`
- All `vps.startAll/startPort/restartPort` → properly `await`ed
- `ctx.answerCbQuery()` now called **BEFORE** long async operations (prevents Telegram 10s spinner timeout)

---

## Critical Bug: server.py কপি না হওয়া

### Root Cause
দুটো সমস্যা ছিল:

1. **`start_proxies.sh` থেকে** — bash script-এ copy logic ছিল, কিন্তু `SERVER_PY` বা `INSTANCES_DIR` `.env`-এ ভুল path থাকলে copy ভুল জায়গায় যেত (no error shown)।

2. **Bot থেকে restart করলে** — `vps.js`-এর `ensureInstanceServerPy()` ঠিকঠাক কাজ করত, কিন্তু `SERVER_PY_PATH` resolve না হলে silently fail করত।

### Fixes in `services/vps.js`
- `copyAllServerPy()` function added — ALL instance folders-এ একসাথে copy করে
- `startAll()` এ **JS-side guarantee** added: bash script চালানোর আগেই JS থেকে সব instance-এ copy করে
- এখন bash script fail করলেও copy হয়ে যায়
- Better error messages when `SERVER_PY` or `INSTANCES_DIR` is wrong

### Fixes in `panels/proxy.js`
- **নতুন "📋 Copy server.py" বাটন** — manual re-sync without restarting proxies
- Debug Info বাটনে এখন `.env`-এ কী set আছে তা clearly দেখায়, ভুল থাকলে কীভাবে ঠিক করতে হবে তাও দেখায়

### Fixes in `start_proxies.sh`
- প্রতিটি port-এ copy করার পর কতগুলো inject file আছে তা দেখায়
- `SERVER_PY` not found হলে clear error + কোথায় খুঁজবে তা দেখায়
- `mkdir -p` failure-ও এখন detect হয়

---

## `.env` Configuration Fix

### Fix in `.env.example`
- `INSTANCES_DIR` variable যোগ করা হয়েছে (আগে missing ছিল!)
- `SERVER_PY` সঠিক default path দেওয়া হয়েছে
- Comments-এ explain করা হয়েছে কোন path কেন গুরুত্বপূর্ণ

### ⚠️ `.env`-এ চেক করতে হবে
