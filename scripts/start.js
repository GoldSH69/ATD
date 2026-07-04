/* Start the built app (expects `node scripts/build.js` to have run). */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('[start] dist/index.html missing — run `npm run build` first')
  process.exit(1)
}
const env = { ...process.env }
// VS Code terminals export this; it would make electron.exe run as plain node.
delete env.ELECTRON_RUN_AS_NODE
spawn(process.execPath, ['node_modules/electron/cli.js', '.'], { cwd: root, stdio: 'inherit', env })
