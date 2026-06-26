// Capture a running local page to a PNG via headless Chrome + the DevTools Protocol.
// Unlike --virtual-time-budget (which fights the Firebase SDK's timers and often
// shoots mid-spinner), this drives Chrome over CDP and WAITS for real content — a
// readiness string to appear in the page — before capturing. It also strips Next's
// dev badge so the shot is clean.
//
//   node scripts/capture-screenshot.mjs [url] [outPath] [WxH] [readyText]
//
// Requires the target serving locally (e.g. `pnpm dev:web` + seeded emulators).
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const url = process.argv[2] || 'http://localhost:3000/public/iron-circle-gym/shop'
const out = resolve(process.argv[3] || 'apps/landing/src/assets/product/shop.png')
const [w, h] = (process.argv[4] || '640,1000').split(',').map(Number)
const readyText = process.argv[5] || 'CHF' // wait until this text renders (= data loaded)
const PORT = 9333

mkdirSync(dirname(out), { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    '--force-device-scale-factor=2',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${resolve(tmpdir(), 'linyup-shot-profile')}`,
    `--remote-debugging-port=${PORT}`,
    `--window-size=${w},${h}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

let ws
let msgId = 0
const pending = new Map()
const seen = new Set()
const send = (method, params = {}) => {
  const id = ++msgId
  return new Promise((res, rej) => {
    pending.set(id, { res, rej })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

try {
  // Find the page target's WebSocket URL.
  let wsUrl
  for (let i = 0; i < 50 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl
    } catch {}
    if (!wsUrl) await sleep(300)
  }
  if (!wsUrl) throw new Error('Chrome DevTools endpoint never came up')

  ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? rej(new Error(m.error.message)) : res(m.result)
    } else if (m.method) {
      seen.add(m.method)
    }
  }

  await send('Page.enable')
  await send('Runtime.enable')
  console.log('navigating', url)
  await send('Page.navigate', { url })
  for (let i = 0; i < 80 && !seen.has('Page.loadEventFired'); i++) await sleep(250)

  console.log(`waiting for "${readyText}" to render…`)
  let ready = false
  for (let i = 0; i < 60; i++) {
    const r = await send('Runtime.evaluate', {
      expression: `!!document.body && document.body.innerText.includes(${JSON.stringify(readyText)})`,
      returnByValue: true,
    })
    if (r.result?.value === true) {
      ready = true
      break
    }
    await sleep(500)
  }
  console.log(ready ? 'content ready' : `warning: "${readyText}" never appeared — capturing anyway`)
  await sleep(700) // settle fonts/layout

  // Strip Next's dev badge / overlays so the marketing shot is clean.
  await send('Runtime.evaluate', {
    expression: `(() => {
      const sels = ['nextjs-portal','[data-next-badge-root]','[data-next-badge]','[data-nextjs-toast]','#__next-build-watcher','[data-nextjs-dev-tools-button]'];
      let n = 0;
      for (const s of sels) document.querySelectorAll(s).forEach((e) => { e.remove(); n++; });
      // Clean white canvas + no scrollbar gutter (kills the dark strip on the edge).
      document.documentElement.style.background = '#fff';
      document.body.style.background = '#fff';
      document.documentElement.style.overflow = 'hidden';
      return n;
    })()`,
    returnByValue: true,
  })

  // Optional: scroll a selector to the top of the viewport before capturing (handles
  // anchor links that land short after late layout shifts / scroll-reveal).
  const scrollSel = process.argv[6]
  if (scrollSel) {
    await send('Runtime.evaluate', {
      expression: `document.querySelector(${JSON.stringify(scrollSel)})?.scrollIntoView({ block: 'start' })`,
    })
    await sleep(900)
  }

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log('saved', out)
} finally {
  try {
    ws?.close()
  } catch {}
  chrome.kill()
}
