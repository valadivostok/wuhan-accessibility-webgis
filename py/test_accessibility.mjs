import { spawn } from 'node:child_process'
import { pythonExecutable } from '../server/accessibility.js'
const child = spawn(pythonExecutable(), ['py/test_accessibility.py'], { stdio: 'inherit', windowsHide: true })
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
