#!/usr/bin/env node
/**
 * RUN VALIDATION CHECK
 *
 * Delegates to the standalone validator (no dev server or public API required).
 *
 * Usage:
 *   node scripts/run-validation-check.js
 *   node scripts/run-validation-check.js mlb
 *   node scripts/run-validation-check.js --limit 500
 */

import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(__dirname, 'validate-pending-props.js')
const args = process.argv.slice(2)

const child = spawn(process.execPath, [script, ...args], { stdio: 'inherit' })

child.on('exit', (code) => process.exit(code ?? 0))
