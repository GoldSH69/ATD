/* Dev: start the vite dev server, wait for it, compile the electron layer,
   then launch electron pointed at the dev server. Ctrl-C tears both down.
   Invokes tool JS entry points via node directly — the .bin .cmd shims are
   blocked by group policy on some workstations. */
const { spawn, spawnSync } = require('child_process')
const net = require('net')
const path = require('path')

const root = path.join(__dirname, '..')
const node = process.execPath
const PORT = 5174

const vite = spawn(node, ['node_modules/vite/bin/vite.js'], { cwd: root, stdio: 'inherit' })

function waitForPort(port, tries = 120) {
  return new Promise((resolve, reject) => {
    const attempt = (left) => {
      const sock = net.connect(port, '127.0.0.1')
      sock.once('connect', () => {
        sock.destroy()
        resolve()
      })
      sock.once('error', () => {
        sock.destroy()
        if (left <= 0) reject(new Error('vite dev server never came up'))
        else setTimeout(() => attempt(left - 1), 500)
      })
    }
    attempt(tries)
  })
}

async function main() {
  await waitForPort(PORT)
  const tsc = spawnSync(node, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.electron.json'], {
    cwd: root,
    stdio: 'inherit',
  })
  if (tsc.status !== 0) {
    vite.kill()
    process.exit(tsc.status ?? 1)
  }
  const env = { ...process.env, VITE_DEV_SERVER_URL: `http://localhost:${PORT}` }
  // VS Code terminals export this; it would make electron.exe run as plain node.
  delete env.ELECTRON_RUN_AS_NODE
  const electron = spawn(node, ['node_modules/electron/cli.js', '.'], {
    cwd: root,
    stdio: 'inherit',
    env,
  })
  electron.on('exit', () => {
    vite.kill()
    process.exit(0)
  })
}

process.on('SIGINT', () => {
  vite.kill()
  process.exit(0)
})

main().catch((err) => {
  console.error(err)
  vite.kill()
  process.exit(1)
})
