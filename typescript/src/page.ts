
// The one page the view serves. Its script runs under a per-response
// nonce, and writes every value it shows as text, never as markup.
export function page(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Station traffic</title>
<style nonce="${nonce}">
:root { --bg: #fbfbfa; --fg: #1d1d1b; --muted: #6b6b66; --line: #e4e3df; --head: #f1f0ec;
  --ok: #2e7d32; --bad: #c62828; --pick: #e8f0fe; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #161615; --fg: #e9e8e4; --muted: #9a9993; --line: #2c2c2a; --head: #1f1f1d;
    --ok: #81c784; --bad: #ef9a9a; --pick: #23324a; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg);
  font: 14px/1.4 system-ui, -apple-system, Segoe UI, sans-serif; }
header { display: flex; align-items: baseline; gap: 16px; padding: 12px 16px;
  border-bottom: 1px solid var(--line); }
h1 { font-size: 16px; margin: 0; }
#count { color: var(--muted); }
form { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 16px;
  border-bottom: 1px solid var(--line); }
label { display: flex; flex-direction: column; font-size: 12px; color: var(--muted); }
select, input { font: inherit; padding: 4px 6px; color: var(--fg); background: var(--bg);
  border: 1px solid var(--line); border-radius: 4px; }
main { display: grid; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 900px) { main { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); } }
.scroll { overflow: auto; max-height: calc(100vh - 140px); }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--line);
  white-space: nowrap; }
th { position: sticky; top: 0; background: var(--head); font-weight: 600; }
tbody tr { cursor: pointer; }
tbody tr.picked { background: var(--pick); }
td.ok { color: var(--ok); }
td.bad { color: var(--bad); font-weight: 600; }
td.num { text-align: right; }
pre { margin: 0; padding: 12px 16px; white-space: pre-wrap; word-break: break-word;
  font: 12px/1.5 ui-monospace, Menlo, Consolas, monospace; }
#empty { padding: 16px; color: var(--muted); }
</style>
</head>
<body>
<header><h1>Station traffic</h1><span id="count">0 records</span></header>
<form id="filter">
  <label>Source<select name="source">
    <option value="">all</option><option>telemetry</option><option>debug</option>
    <option>audit</option><option>station</option></select></label>
  <label>SDK<select name="sdk"><option value="">all</option></select></label>
  <label>Operation<input name="op" placeholder="planet.list"></label>
  <label>Status<select name="status">
    <option value="">all</option><option>2xx</option><option>4xx</option>
    <option>5xx</option><option value="failed">failed</option></select></label>
</form>
<main>
  <div class="scroll">
    <table>
      <thead><tr><th>Time</th><th>Source</th><th>SDK</th><th>Operation</th><th>Method</th>
        <th>Path</th><th>Status</th><th>ms</th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
    <div id="empty">No traffic yet.</div>
  </div>
  <div class="scroll"><pre id="detail"></pre></div>
</main>
<script nonce="${nonce}">
const records = []
const sdks = new Set()
const form = document.getElementById('filter')
const rows = document.getElementById('rows')
const detail = document.getElementById('detail')
const count = document.getElementById('count')
const empty = document.getElementById('empty')
let picked = null

function want(rec) {
  const f = Object.fromEntries(new FormData(form))
  if (f.source && f.source !== rec.source) { return false }
  if (f.sdk && f.sdk !== rec.sdk) { return false }
  if (f.op && !String(rec.op || '').includes(f.op)) { return false }
  if ('failed' === f.status) { return false === rec.ok }
  if (f.status) { return null != rec.status && f.status[0] === String(rec.status)[0] }
  return true
}

function cell(tr, text, cls) {
  const td = document.createElement('td')
  td.textContent = null == text ? '' : String(text)
  if (cls) { td.className = cls }
  tr.appendChild(td)
}

function row(rec) {
  const tr = document.createElement('tr')
  tr.dataset.seq = rec.seq
  cell(tr, new Date(rec.t).toISOString().slice(11, 23))
  cell(tr, 'station' === rec.source ? 'station:' + rec.kind : rec.source)
  cell(tr, rec.sdk)
  cell(tr, rec.op)
  cell(tr, rec.method)
  cell(tr, rec.path)
  cell(tr, rec.status, false === rec.ok ? 'bad' : (true === rec.ok ? 'ok' : ''))
  cell(tr, null == rec.ms ? '' : Math.round(rec.ms), 'num')
  if (picked === rec.seq) { tr.className = 'picked' }
  tr.addEventListener('click', () => {
    picked = rec.seq
    detail.textContent = JSON.stringify(rec.detail, null, 2)
    render()
  })
  return tr
}

function render() {
  const shown = records.filter(want).slice(-500).reverse()
  rows.replaceChildren(...shown.map(row))
  count.textContent = shown.length + ' of ' + records.length + ' records'
  empty.hidden = 0 < shown.length
}

function keep(rec) {
  records.push(rec)
  if (2000 < records.length) { records.shift() }
  if (rec.sdk && !sdks.has(rec.sdk)) {
    sdks.add(rec.sdk)
    const opt = document.createElement('option')
    opt.textContent = rec.sdk
    form.elements.sdk.appendChild(opt)
  }
}

form.addEventListener('input', render)

fetch('api/records').then((res) => res.json()).then((list) => {
  list.forEach(keep)
  render()
  const last = list.length ? list[list.length - 1].seq : 0
  const live = new EventSource('api/stream?since=' + last)
  live.onmessage = (msg) => { keep(JSON.parse(msg.data)); render() }
})
</script>
</body>
</html>
`
}
