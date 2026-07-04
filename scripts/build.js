/* Build: compile electron main/preload, typecheck renderer, bundle with vite.
   Invokes tool JS entry points via node directly — the .bin .cmd shims are
   blocked by group policy on some workstations. */
const { spawnSync } = require('child_process')
const path = require('path')

const root = path.join(__dirname, '..')
const node = process.execPath

function run(label, args) {
  console.log(`\n[build] ${label}`)
  const res = spawnSync(node, args, { cwd: root, stdio: 'inherit' })
  if (res.status !== 0) {
    console.error(`[build] ${label} failed (exit ${res.status})`)
    process.exit(res.status ?? 1)
  }
}

run('tsc electron', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.electron.json'])
run('tsc renderer (typecheck)', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.app.json', '--noEmit'])
run('vite build', ['node_modules/vite/bin/vite.js', 'build'])
console.log('\n[build] done')
