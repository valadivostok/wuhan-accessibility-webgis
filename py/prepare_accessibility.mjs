import { spawn } from 'node:child_process'
import { pythonExecutable } from '../server/accessibility.js'

const child = spawn(pythonExecutable(), ['py/prepare_accessibility.py', ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true })
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
