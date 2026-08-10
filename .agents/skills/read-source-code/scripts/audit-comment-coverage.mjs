#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const DEFAULT_EXCLUDED_DIRS = new Set([
  '.git',
  '.next',
  '.nuxt',
  'build',
  'coverage',
  'dist',
  'lib',
  'node_modules',
  'vendor',
])

const TSDOC_KINDS = new Set([
  'call-signature',
  'class',
  'construct-signature',
  'constructor',
  'enum',
  'function',
  'function-property',
  'function-variable',
  'getter',
  'interface',
  'method',
  'method-signature',
  'setter',
  'type',
])

const DIRECTIVE_COMMENT = /(?:eslint|prettier-|istanbul|\bc8\b|@ts-(?:check|expect-error|ignore|nocheck)|#__PURE__|@__NO_SIDE_EFFECTS__|vite-ignore)/i

function printHelp() {
  process.stdout.write(`Usage:
  node audit-comment-coverage.mjs --root <repo> --path <source> [options]

Options:
  --root <dir>             Repository root. Defaults to current directory.
  --path <path>            File or directory to scan. Repeatable; defaults to src.
  --exclude <path>         Repository-relative path or directory name to skip.
  --typescript <module>    TypeScript module or absolute compiler JS path.
  --exemptions <json>      JSON map of declaration ID to non-empty reason.
  --format <markdown|json> Output format. Defaults to markdown.
  --missing-only           Print unresolved declarations only.
  --include-dts            Include declaration files.
  --strict-exemptions      Fail when exemptions do not match scanned declarations.
  --fail-on-missing        Exit 1 when unresolved declarations remain.
  --help                   Show this help.
`)
}

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    scanPaths: [],
    excludes: [],
    format: 'markdown',
    missingOnly: false,
    includeDts: false,
    strictExemptions: false,
    failOnMissing: false,
  }

  const takeValue = (index, flag) => {
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
    return value
  }

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--help') options.help = true
    else if (flag === '--root') options.root = takeValue(index++, flag)
    else if (flag === '--path') options.scanPaths.push(takeValue(index++, flag))
    else if (flag === '--exclude') options.excludes.push(takeValue(index++, flag))
    else if (flag === '--typescript') options.typescript = takeValue(index++, flag)
    else if (flag === '--exemptions') options.exemptions = takeValue(index++, flag)
    else if (flag === '--format') options.format = takeValue(index++, flag)
    else if (flag === '--missing-only') options.missingOnly = true
    else if (flag === '--include-dts') options.includeDts = true
    else if (flag === '--strict-exemptions') options.strictExemptions = true
    else if (flag === '--fail-on-missing') options.failOnMissing = true
    else throw new Error(`Unknown option: ${flag}`)
  }

  if (!['json', 'markdown'].includes(options.format)) {
    throw new Error('--format must be markdown or json')
  }
  if (options.scanPaths.length === 0) options.scanPaths.push('src')
  options.root = path.resolve(options.root)
  return options
}

function loadTypeScript(root, explicitModule) {
  const rootRequire = createRequire(path.join(root, 'package.json'))
  const localRequire = createRequire(import.meta.url)
  const candidates = explicitModule
    ? [path.isAbsolute(explicitModule) ? explicitModule : path.resolve(root, explicitModule)]
    : ['typescript']

  for (const candidate of candidates) {
    for (const requireModule of [rootRequire, localRequire]) {
      try {
        return requireModule(candidate)
      } catch {
        // Try next resolution root.
      }
    }
  }

  const hint = explicitModule
    ? `Cannot load TypeScript compiler from ${explicitModule}`
    : 'Cannot load TypeScript compiler from target repository or skill directory'
  throw new Error(`${hint}. Install repository dependencies or pass --typescript <compiler-path>.`)
}

function normalizeRelative(value) {
  return value.replaceAll(path.sep, '/').replace(/^\.\//, '').replace(/\/$/, '')
}

function isExcluded(relativePath, excludes) {
  const normalized = normalizeRelative(relativePath)
  const segments = normalized.split('/')
  if (segments.some((segment) => DEFAULT_EXCLUDED_DIRS.has(segment))) return true
  return excludes.some((entry) => {
    const excluded = normalizeRelative(entry)
    return excluded.includes('/')
      ? normalized === excluded || normalized.startsWith(`${excluded}/`)
      : segments.includes(excluded)
  })
}

function isSourceFile(filePath, includeDts) {
  const normalized = filePath.toLowerCase()
  if (!includeDts && /\.d\.[cm]?ts$/.test(normalized)) return false
  return /\.(?:[cm]?[jt]s|[jt]sx)$/.test(normalized)
}

function collectFiles(root, scanPaths, excludes, includeDts) {
  const files = new Set()
  const visited = new Set()

  const visit = (absolutePath) => {
    if (!fs.existsSync(absolutePath)) throw new Error(`Scan path does not exist: ${absolutePath}`)
    const relativePath = normalizeRelative(path.relative(root, absolutePath))
    if (relativePath && isExcluded(relativePath, excludes)) return

    const stat = fs.lstatSync(absolutePath)
    if (stat.isSymbolicLink()) return
    if (stat.isFile()) {
      if (isSourceFile(absolutePath, includeDts)) files.add(absolutePath)
      return
    }
    if (!stat.isDirectory()) return

    const realPath = fs.realpathSync(absolutePath)
    if (visited.has(realPath)) return
    visited.add(realPath)
    for (const entry of fs.readdirSync(absolutePath).sort()) {
      visit(path.join(absolutePath, entry))
    }
  }

  for (const scanPath of scanPaths) visit(path.resolve(root, scanPath))
  return [...files].sort()
}

function loadExemptions(root, exemptionsPath) {
  if (!exemptionsPath) return new Map()
  const absolutePath = path.resolve(root, exemptionsPath)
  const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8'))
  const source = parsed.exemptions ?? parsed
  if (!source || Array.isArray(source) || typeof source !== 'object') {
    throw new Error('Exemptions JSON must contain an object map under "exemptions"')
  }

  const exemptions = new Map()
  for (const [id, reason] of Object.entries(source)) {
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new Error(`Exemption reason must be non-empty: ${id}`)
    }
    exemptions.set(id, reason.trim())
  }
  return exemptions
}

function scriptKind(ts, filePath) {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (/\.[cm]?js$/.test(lower)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function nodeName(node, sourceFile) {
  if (!node?.name) return ''
  return node.name.getText(sourceFile).replace(/\s+/g, ' ')
}

function containerName(ts, node, sourceFile) {
  const ownName = nodeName(node, sourceFile)
  if (ownName) return ownName
  if ((ts.isClassExpression(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent)) {
    return node.parent.name.getText(sourceFile)
  }
  return ''
}

function qualifiedName(ts, node, ownName, sourceFile) {
  const owners = []
  let current = node.parent
  while (current && !ts.isSourceFile(current)) {
    if (
      ts.isClassDeclaration(current) ||
      ts.isClassExpression(current) ||
      ts.isInterfaceDeclaration(current) ||
      ts.isTypeAliasDeclaration(current) ||
      ts.isEnumDeclaration(current) ||
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isMethodDeclaration(current)
    ) {
      const name = containerName(ts, current, sourceFile)
      if (name) owners.unshift(name)
    }
    current = current.parent
  }
  return [...owners, ownName || '<anonymous>'].join('.')
}

function commentTarget(ts, node) {
  if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)) {
    const statement = node.parent.parent
    if (ts.isVariableStatement(statement)) return statement
  }
  return node
}

function commentKind(ts, node, sourceFile, sourceText) {
  const target = commentTarget(ts, node)
  const ranges = ts.getLeadingCommentRanges(sourceText, target.getFullStart()) ?? []
  const targetStart = target.getStart(sourceFile)
  const adjacent = ranges.filter((range) => {
    const gap = sourceText.slice(range.end, targetStart)
    return !/\n\s*\n/.test(gap)
  })
  const range = adjacent.at(-1)
  if (!range) return 'none'

  const raw = sourceText.slice(range.pos, range.end)
  if (DIRECTIVE_COMMENT.test(raw)) return 'directive'
  if (raw.startsWith('/**')) return 'tsdoc'
  if (raw.startsWith('//')) return 'line'
  return 'block'
}

function isTopLevelConst(ts, node) {
  if (!ts.isVariableDeclarationList(node.parent)) return false
  const statement = node.parent.parent
  return (
    ts.isVariableStatement(statement) &&
    ts.isSourceFile(statement.parent) &&
    Boolean(node.parent.flags & ts.NodeFlags.Const)
  )
}

function auditFile(ts, root, filePath) {
  const sourceText = fs.readFileSync(filePath, 'utf8')
  const relativeFile = normalizeRelative(path.relative(root, filePath))
  const sourceFile = ts.createSourceFile(
    relativeFile,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(ts, filePath),
  )
  const diagnostics = (sourceFile.parseDiagnostics ?? []).map((diagnostic) => {
    const position = diagnostic.start ?? 0
    const location = sourceFile.getLineAndCharacterOfPosition(position)
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')
    return `${relativeFile}:${location.line + 1}:${location.character + 1} ${message}`
  })
  const records = []

  const add = (node, kind, name) => {
    const position = node.getStart(sourceFile)
    const location = sourceFile.getLineAndCharacterOfPosition(position)
    records.push({
      file: relativeFile,
      line: location.line + 1,
      column: location.character + 1,
      kind,
      name: qualifiedName(ts, node, name, sourceFile),
      comment: commentKind(ts, node, sourceFile, sourceText),
    })
  }

  const visit = (node) => {
    if (ts.isFunctionDeclaration(node)) add(node, 'function', nodeName(node, sourceFile) || '<default>')
    else if (ts.isClassDeclaration(node)) add(node, 'class', nodeName(node, sourceFile) || '<default>')
    else if (ts.isInterfaceDeclaration(node)) add(node, 'interface', nodeName(node, sourceFile))
    else if (ts.isTypeAliasDeclaration(node)) add(node, 'type', nodeName(node, sourceFile))
    else if (ts.isEnumDeclaration(node)) add(node, 'enum', nodeName(node, sourceFile))
    else if (ts.isEnumMember(node)) add(node, 'enum-member', nodeName(node, sourceFile))
    else if (ts.isConstructorDeclaration(node)) add(node, 'constructor', 'constructor')
    else if (ts.isGetAccessorDeclaration(node)) add(node, 'getter', nodeName(node, sourceFile))
    else if (ts.isSetAccessorDeclaration(node)) add(node, 'setter', nodeName(node, sourceFile))
    else if (ts.isMethodDeclaration(node)) add(node, 'method', nodeName(node, sourceFile))
    else if (ts.isMethodSignature(node)) add(node, 'method-signature', nodeName(node, sourceFile))
    else if (ts.isCallSignatureDeclaration(node)) add(node, 'call-signature', '<call>')
    else if (ts.isConstructSignatureDeclaration(node)) add(node, 'construct-signature', '<new>')
    else if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) {
      const initializer = node.initializer
      const kind = initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
        ? 'function-property'
        : 'field'
      add(node, kind, nodeName(node, sourceFile))
    } else if (ts.isVariableDeclaration(node)) {
      const initializer = node.initializer
      const name = node.name.getText(sourceFile)
      if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
        add(node, 'function-variable', name)
      } else if (initializer && ts.isClassExpression(initializer)) {
        add(node, 'class', name)
      } else if (isTopLevelConst(ts, node)) {
        add(node, 'constant', name)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return { diagnostics, records }
}

function assignIds(records) {
  records.sort((left, right) =>
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    left.column - right.column ||
    left.kind.localeCompare(right.kind),
  )
  const seen = new Map()
  for (const record of records) {
    const base = `${record.file}#${record.kind}#${record.name}`
    const occurrence = (seen.get(base) ?? 0) + 1
    seen.set(base, occurrence)
    record.id = occurrence === 1 ? base : `${base}@${occurrence}`
  }
}

function classify(records, exemptions) {
  const usedExemptions = new Set()
  for (const record of records) {
    const reason = exemptions.get(record.id)
    if (reason) {
      record.status = 'exempt'
      record.reason = reason
      usedExemptions.add(record.id)
    } else if (record.comment === 'none' || record.comment === 'directive') {
      record.status = 'missing'
    } else if (TSDOC_KINDS.has(record.kind) && record.comment !== 'tsdoc') {
      record.status = 'needs-tsdoc'
    } else {
      record.status = 'documented'
    }
  }
  return [...exemptions.keys()].filter((id) => !usedExemptions.has(id))
}

function buildSummary(files, records) {
  const byStatus = { documented: 0, exempt: 0, missing: 0, 'needs-tsdoc': 0 }
  const byKind = {}
  for (const record of records) {
    byStatus[record.status] += 1
    byKind[record.kind] = (byKind[record.kind] ?? 0) + 1
  }
  return {
    files: files.length,
    declarations: records.length,
    unresolved: byStatus.missing + byStatus['needs-tsdoc'],
    byStatus,
    byKind,
  }
}

function escapeCell(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ')
}

function renderMarkdown(result, missingOnly) {
  const { summary, diagnostics, unusedExemptions } = result
  const lines = [
    '# 注释覆盖审计',
    '',
    `- 文件：${summary.files}`,
    `- 声明：${summary.declarations}`,
    `- 已记录：${summary.byStatus.documented}`,
    `- 已豁免：${summary.byStatus.exempt}`,
    `- 缺少注释：${summary.byStatus.missing}`,
    `- 需要 TSDoc：${summary.byStatus['needs-tsdoc']}`,
    `- 未解决：${summary.unresolved}`,
  ]

  if (diagnostics.length > 0) {
    lines.push('', '## 解析错误', '', ...diagnostics.map((item) => `- ${item}`))
  }
  if (unusedExemptions.length > 0) {
    lines.push('', '## 未匹配豁免', '', ...unusedExemptions.map((item) => `- ${item}`))
  }

  const visible = missingOnly
    ? result.records.filter((record) => ['missing', 'needs-tsdoc'].includes(record.status))
    : result.records
  lines.push('', '## 声明', '', '| 状态 | 类别 | 符号 | 位置 | 注释 | 豁免原因 |', '|---|---|---|---|---|---|')
  for (const record of visible) {
    lines.push(
      `| ${escapeCell(record.status)} | ${escapeCell(record.kind)} | ${escapeCell(record.name)} | ` +
      `${escapeCell(`${record.file}:${record.line}`)} | ${escapeCell(record.comment)} | ${escapeCell(record.reason)} |`,
    )
  }
  return `${lines.join('\n')}\n`
}

function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
    if (options.help) {
      printHelp()
      return
    }

    const ts = loadTypeScript(options.root, options.typescript)
    const files = collectFiles(
      options.root,
      options.scanPaths,
      options.excludes,
      options.includeDts,
    )
    if (files.length === 0) throw new Error('No source files matched scan paths')

    const diagnostics = []
    const records = []
    for (const file of files) {
      const result = auditFile(ts, options.root, file)
      diagnostics.push(...result.diagnostics)
      records.push(...result.records)
    }
    assignIds(records)

    const exemptions = loadExemptions(options.root, options.exemptions)
    const unusedExemptions = classify(records, exemptions)
    const result = {
      root: options.root,
      scanPaths: options.scanPaths,
      summary: buildSummary(files, records),
      diagnostics,
      unusedExemptions,
      records: options.missingOnly
        ? records.filter((record) => ['missing', 'needs-tsdoc'].includes(record.status))
        : records,
    }

    const output = options.format === 'json'
      ? `${JSON.stringify(result, null, 2)}\n`
      : renderMarkdown({ ...result, records }, options.missingOnly)
    process.stdout.write(output)

    if (diagnostics.length > 0) process.exitCode = 2
    else if (options.strictExemptions && unusedExemptions.length > 0) process.exitCode = 2
    else if (options.failOnMissing && result.summary.unresolved > 0) process.exitCode = 1
  } catch (error) {
    process.stderr.write(`audit-comment-coverage: ${error.message}\n`)
    process.exitCode = 2
  }
}

main()
