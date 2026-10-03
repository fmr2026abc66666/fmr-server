const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '64kb' }));

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || '123456';
const API_KEY = process.env.API_KEY || 'change-me';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const APK_DIR = path.join(DATA_DIR, 'apk');
fs.mkdirSync(APK_DIR, { recursive: true });
const META_FILE = path.join(DATA_DIR, 'update.json');

// Small demo store. For permanent statistics, use a database in production.
const stats = new Map();

function today() { return new Date().toISOString().slice(0, 10); }
function authApi(req, res, next) {
  if (req.get('X-API-Key') !== API_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
}
function dashboardToken() {
  return Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64');
}
function authDashboard(req, res, next) {
  if (req.get('Authorization') !== 'Bearer ' + dashboardToken()) return res.status(401).json({ error: 'unauthorized' });
  next();
}
function readMeta() {
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch (_) { return null; }
}
function writeMeta(meta) { fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2)); }

const upload = multer({
  storage: multer.diskStorage({
    destination: APK_DIR,
    filename: function (_req, _file, cb) { cb(null, 'latest.apk'); }
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: function (_req, file, cb) {
    const ok = path.extname(file.originalname).toLowerCase() === '.apk';
    cb(ok ? null : new Error('只允许上传 APK 文件'), ok);
  }
});

app.get('/', (req, res) => res.type('html').send(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FMR后台</title>
<style>body{font-family:Arial,sans-serif;background:#eef6ff;margin:0;padding:18px;color:#17324d}.box{max-width:760px;margin:auto;background:#fff;border-radius:18px;padding:20px;box-shadow:0 4px 20px #0001}input,button{box-sizing:border-box;width:100%;padding:13px;margin:7px 0;border-radius:10px;border:1px solid #ccd8e5;font-size:16px}button{background:#1688e8;color:#fff;border:0}.card{background:#f4f9ff;border-radius:14px;padding:18px;margin-top:14px}.num{font-size:30px;font-weight:bold}.muted{color:#66809a}.danger{color:#b23b3b}.file{padding:12px;background:#fff;border:1px dashed #9ab4cc;border-radius:10px;margin:8px 0}</style></head>
<body><div class="box"><h1>FMR 服务器后台</h1>
<div id="login"><p class="muted">管理员登录</p><input id="u" placeholder="账号"><input id="p" type="password" placeholder="密码"><button onclick="login()">登录</button><p id="msg"></p></div>
<div id="dash" style="display:none">
<div class="card"><h2>今日统计</h2><p>日期：<b id="date"></b></p><p>活跃设备：<b id="devices">0</b></p><p>启动次数：<b id="opens">0</b></p><p>请求次数：<b id="requests">0</b></p><p>拦截次数：<b id="blocked">0</b></p><button onclick="load()">刷新数据</button></div>
<div class="card"><h2>远程更新</h2><p class="muted">这里只允许选择 APK 文件。选择后再点击“确认上传”。</p><input id="apk" type="file" accept=".apk,application/vnd.android.package-archive" onchange="picked()"><div id="picked" class="file" style="display:none"></div><button id="uploadBtn" style="display:none" onclick="uploadApk()">确认上传</button><p id="upmsg"></p></div>
<div class="card"><h2>当前版本</h2><p id="release">暂无 APK</p><a id="download" href="/download/latest.apk" style="display:none">测试下载最新 APK</a></div>
</div></div>
<script>
let token=''; const loginBox=document.getElementById('login'),dash=document.getElementById('dash');
async function login(){const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:u.value,pass:p.value})});const d=await r.json();if(!r.ok){msg.textContent='账号或密码错误';return}token=d.token;loginBox.style.display='none';dash.style.display='block';load();loadUpdate()}
async function load(){const r=await fetch('/api/stats',{headers:{Authorization:'Bearer '+token}});if(!r.ok)return;const d=await r.json();date.textContent=d.date;devices.textContent=d.devices;opens.textContent=d.opens;requests.textContent=d.requests;blocked.textContent=d.blocked}
function picked(){const f=apk.files[0]; if(!f){pickedBox(false);return} const ok=f.name.toLowerCase().endsWith('.apk'); if(!ok){upmsg.textContent='只能选择 APK 文件';apk.value='';pickedBox(false);return} document.getElementById('picked').style.display='block';document.getElementById('picked').textContent='已选择：'+f.name+'（'+Math.round(f.size/1024/1024*10)/10+' MB）';document.getElementById('uploadBtn').style.display='block';upmsg.textContent=''}
function pickedBox(x){document.getElementById('picked').style.display=x?'block':'none';document.getElementById('uploadBtn').style.display=x?'block':'none'}
async function uploadApk(){const f=apk.files[0];if(!f||!f.name.toLowerCase().endsWith('.apk'))return;const fd=new FormData();fd.append('apk',f);upmsg.textContent='正在上传，请稍等…';const r=await fetch('/api/update/upload',{method:'POST',headers:{Authorization:'Bearer '+token},body:fd});const d=await r.json().catch(()=>({}));if(!r.ok){upmsg.textContent=d.error||'上传失败';return}upmsg.textContent='上传成功！';loadUpdate()}
async function loadUpdate(){const r=await fetch('/api/update');const d=await r.json();if(!d.available){release.textContent='暂无 APK';download.style.display='none';return}release.textContent='已发布：'+d.fileName+'，发布时间：'+d.updatedAt;download.style.display='inline'}
</script></body></html>`));

app.post('/api/login', (req, res) => {
  const { user, pass } = req.body || {};
  if (user !== ADMIN_USER || pass !== ADMIN_PASS) return res.status(401).json({ error: 'invalid login' });
  res.json({ token: dashboardToken() });
});

app.post('/api/event', authApi, (req, res) => {
  const { deviceId, opens = 0, requests = 0, blocked = 0 } = req.body || {};
  if (!deviceId) return res.status(400).json({ error: 'deviceId required' });
  const key = `${today()}|${String(deviceId).slice(0, 128)}`;
  const old = stats.get(key) || { date: today(), deviceId: String(deviceId).slice(0,128), opens: 0, requests: 0, blocked: 0 };
  old.opens += Math.max(0, Number(opens) || 0);
  old.requests += Math.max(0, Number(requests) || 0);
  old.blocked += Math.max(0, Number(blocked) || 0);
  stats.set(key, old);
  res.json({ ok: true });
});

app.get('/api/stats', authDashboard, (req, res) => {
  const d = today();
  const rows = [...stats.values()].filter(x => x.date === d);
  res.json({ date: d, devices: rows.length, opens: rows.reduce((a,x)=>a+x.opens,0), requests: rows.reduce((a,x)=>a+x.requests,0), blocked: rows.reduce((a,x)=>a+x.blocked,0) });
});

app.get('/api/update', (req, res) => {
  const meta = readMeta();
  const file = path.join(APK_DIR, 'latest.apk');
  if (!meta || !fs.existsSync(file)) return res.json({ available: false });
  res.json({ available: true, releaseId: meta.releaseId, fileName: meta.fileName, size: meta.size, updatedAt: meta.updatedAt, downloadUrl: '/download/latest.apk' });
});

app.get('/download/latest.apk', (req, res) => {
  const file = path.join(APK_DIR, 'latest.apk');
  if (!fs.existsSync(file)) return res.status(404).send('APK not found');
  res.download(file, 'FMR-latest.apk', { headers: { 'Content-Type': 'application/vnd.android.package-archive', 'Cache-Control': 'no-store' } });
});

app.post('/api/update/upload', authDashboard, upload.single('apk'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '只能上传 APK 文件' });
  const meta = { releaseId: crypto.randomUUID(), fileName: req.file.originalname, size: req.file.size, updatedAt: new Date().toISOString() };
  writeMeta(meta);
  res.json({ ok: true, ...meta, downloadUrl: '/download/latest.apk' });
});

app.use((err, _req, res, _next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'APK 太大，不能超过 200 MB' });
  res.status(400).json({ error: err && err.message ? err.message : '请求失败' });
});

app.listen(PORT, '0.0.0.0', () => console.log(`FMR server listening on ${PORT}`));
