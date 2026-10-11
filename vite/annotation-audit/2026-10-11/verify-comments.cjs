// 独立验证本阶段的注释改动；不修改共享技能脚本或源码。
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '../../..')
const baselineRoot = process.argv[2] || '/tmp/vite-annotation-stage-original'
const ts = require(path.join(root, 'vite/node_modules/typescript'))
const scope = JSON.parse(fs.readFileSync(path.join(__dirname, 'scope.json')))
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')

// 比较所有语法节点、声明模式、标识符与字面量值；注释和位置不进入 AST 指纹。
function astKey(sf) {
  function visit(n) {
    const children = []
    ts.forEachChild(n, (c) => { children.push(visit(c)) })
    const flags = ts.isVariableDeclarationList(n)
      ? n.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const | ts.NodeFlags.Using | ts.NodeFlags.AwaitUsing)
      : 0
    let value = ''
    if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) value = n.escapedText
    else if (ts.isLiteralExpression(n) || ts.isTemplateLiteralToken(n)) value = n.text
    return [n.kind, flags, value, children]
  }
  return JSON.stringify(visit(sf))
}

// 从已解析语法树提取实际 token，避免正则、JSX 和模板内容被裸扫描器误判。
function tokenKey(sf) {
  const tokens = []
  function visit(n) {
    if (n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode) return
    const children = n.getChildren(sf)
    if (!children.length && n.kind !== ts.SyntaxKind.EndOfFileToken) tokens.push([n.kind, n.getText(sf)])
    else for (const child of children) visit(child)
  }
  visit(sf)
  return JSON.stringify(tokens)
}

// 跳过 AST 确认的字面量，再比较法律文字、工具指令和源码映射标记的原文及顺序。
function protectedComments(sf, source) {
  const literals = new Map(), result = []
  function collect(n) {
    if (ts.isLiteralExpression(n) || ts.isTemplateLiteralToken(n)) {
      const start = n.getStart(sf)
      if (n.end > start) literals.set(start, n.end)
    }
    ts.forEachChild(n, collect)
  }
  collect(sf)
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source)
  let last = -1
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    const start = scanner.getTokenPos()
    if (start <= last) throw Error('扫描未前进：' + sf.fileName)
    last = start
    if (literals.has(start)) { scanner.setTextPos(literals.get(start)); continue }
    if (kind !== ts.SyntaxKind.SingleLineCommentTrivia && kind !== ts.SyntaxKind.MultiLineCommentTrivia) continue
    const text = scanner.getTokenText()
    if (/^\/\/[\t ]*[@#]\s*(?:ts-|sourceMappingURL|sourceURL)/.test(text) ||
      /^\/\/[\t ]*eslint-|^\/\*[\t ]*eslint-|^\/\/\/[\t ]*<(?:reference|amd-)\b/.test(text) ||
      /^\/\/[\t ]*prettier-ignore\b|^\/\*[\t ]*(?:global|globals)\b|^\/\*\*?[\t ]*[@#]__[A-Z_]+__|^\/\*[\t ]*@vite-ignore[\t ]*\*\//.test(text) ||
      /Copyright|MIT License|Permission is hereby granted|SPDX-License-Identifier|This source code is licensed/.test(text)) result.push(text)
  }
  return JSON.stringify(result)
}

// 保存原有 JSDoc 类型标注；新增中文说明不应丢失 JS 文件的类型信息。
function typedTags(sf) {
  const result = []
  function visit(n) {
    for (const doc of n.jsDoc || []) for (const tag of doc.tags || []) {
      if (tag.typeExpression) result.push(JSON.stringify({
        kind: ts.SyntaxKind[tag.kind], type: tag.typeExpression.getText(sf).replace(/\s/g, ''), name: tag.name?.getText(sf),
      }))
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return result
}

const result = { compilerVersion: ts.version, baselineRoot, scopeFiles: scope.files.length,
  changedFiles: [], astMismatches: [], tokenMismatches: [], protectedCommentMismatches: [],
  missingOriginalTypedTags: [], parseDiagnostics: [], fileChecks: [] }
for (const file of scope.files) {
  const before = fs.readFileSync(path.join(baselineRoot, file)), after = fs.readFileSync(path.join(root, file))
  const check = { file, beforeSha256: sha(before), afterSha256: sha(after), sameBytes: before.equals(after) }
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.jsx') ? ts.ScriptKind.JSX
    : /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const current = ts.createSourceFile(file, after.toString('utf8'), ts.ScriptTarget.Latest, true, kind)
  for (const diagnostic of current.parseDiagnostics || []) result.parseDiagnostics.push({file, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')})
  if (!check.sameBytes) {
    result.changedFiles.push(file)
    const original = ts.createSourceFile(file, before.toString('utf8'), ts.ScriptTarget.Latest, true, kind)
    check.beforeAstSha256 = sha(astKey(original)); check.afterAstSha256 = sha(astKey(current))
    check.beforeTokenSha256 = sha(tokenKey(original)); check.afterTokenSha256 = sha(tokenKey(current))
    if (check.beforeAstSha256 !== check.afterAstSha256) result.astMismatches.push(file)
    if (check.beforeTokenSha256 !== check.afterTokenSha256) result.tokenMismatches.push(file)
    if (protectedComments(original, before.toString('utf8')) !== protectedComments(current, after.toString('utf8'))) result.protectedCommentMismatches.push(file)
    const remaining = typedTags(current)
    for (const tag of typedTags(original)) {
      const index = remaining.indexOf(tag)
      if (index < 0) result.missingOriginalTypedTags.push({file, tag})
      else remaining.splice(index, 1)
    }
  }
  result.fileChecks.push(check)
}
fs.writeFileSync(path.join(__dirname, 'verification.json'), JSON.stringify(result, null, 2) + '\n')
const summary = {...result, changedFiles: result.changedFiles.length, fileChecks: result.fileChecks.length}
console.log(JSON.stringify(summary))
if (result.astMismatches.length || result.tokenMismatches.length || result.protectedCommentMismatches.length || result.missingOriginalTypedTags.length || result.parseDiagnostics.length) process.exitCode = 1
