#!/usr/bin/env node

/**
 * 使用 Hermes Parser 对 React 的 Flow 源码执行声明级注释覆盖审计。
 *
 * @remarks
 * 技能自带的 TypeScript 审计器无法解析 Flow 的精确对象、variance、opaque type
 * 等语法。本脚本保持相同的状态模型和豁免格式，只把 JavaScript/JSX 解析层替换为
 * React 自身锁定版本的 Hermes Parser；TypeScript 文件仍应交给原审计器处理。
 */

import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

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
]);

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
]);

const DIRECTIVE_COMMENT =
  /(?:eslint|prettier-|istanbul|\bc8\b|@flow|\$Flow(?:FixMe|ExpectedError|Issue)|@ts-(?:check|expect-error|ignore|nocheck)|#__PURE__|@__NO_SIDE_EFFECTS__|vite-ignore)/i;

/** 输出命令行帮助。 */
function printHelp() {
  process.stdout.write(`Usage:
  node audit-flow-comment-coverage.mjs --root <repo> --path <source> [options]

Options:
  --root <dir>             Repository root. Defaults to current directory.
  --path <path>            JavaScript file or directory to scan. Repeatable.
  --exclude <path>         Repository-relative path or directory name to skip.
  --hermes-parser <path>   Hermes Parser package directory or entry file.
  --exemptions <json>      JSON map of declaration ID to non-empty reason.
  --format <markdown|json> Output format. Defaults to markdown.
  --missing-only           Print unresolved declarations only.
  --strict-exemptions      Fail when exemptions do not match scanned declarations.
  --fail-on-missing        Exit 1 when unresolved declarations remain.
  --help                   Show this help.
`);
}

/** 解析 CLI 参数，并把路径基准统一到仓库根目录。 */
function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    scanPaths: [],
    excludes: [],
    format: 'markdown',
    missingOnly: false,
    strictExemptions: false,
    failOnMissing: false,
  };

  const takeValue = (index, flag) => {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help') options.help = true;
    else if (flag === '--root') options.root = takeValue(index++, flag);
    else if (flag === '--path') options.scanPaths.push(takeValue(index++, flag));
    else if (flag === '--exclude') options.excludes.push(takeValue(index++, flag));
    else if (flag === '--hermes-parser') {
      options.hermesParser = takeValue(index++, flag);
    } else if (flag === '--exemptions') {
      options.exemptions = takeValue(index++, flag);
    } else if (flag === '--format') options.format = takeValue(index++, flag);
    else if (flag === '--missing-only') options.missingOnly = true;
    else if (flag === '--strict-exemptions') options.strictExemptions = true;
    else if (flag === '--fail-on-missing') options.failOnMissing = true;
    else throw new Error(`Unknown option: ${flag}`);
  }

  if (!['json', 'markdown'].includes(options.format)) {
    throw new Error('--format must be markdown or json');
  }
  if (options.scanPaths.length === 0) options.scanPaths.push('src');
  options.root = path.resolve(options.root);
  return options;
}

/** 从显式路径、目标仓库或脚本目录加载 Hermes Parser。 */
function loadHermesParser(root, explicitModule) {
  const rootRequire = createRequire(path.join(root, 'package.json'));
  const localRequire = createRequire(import.meta.url);
  const candidates = explicitModule
    ? [
        path.isAbsolute(explicitModule)
          ? explicitModule
          : path.resolve(root, explicitModule),
      ]
    : ['hermes-parser'];

  for (const candidate of candidates) {
    for (const requireModule of [rootRequire, localRequire]) {
      try {
        return requireModule(candidate);
      } catch {
        // 继续尝试下一个解析根目录。
      }
    }
  }

  const hint = explicitModule
    ? `Cannot load Hermes Parser from ${explicitModule}`
    : 'Cannot load Hermes Parser from target repository or script directory';
  throw new Error(
    `${hint}. Install repository dependencies or pass --hermes-parser <path>.`,
  );
}

/** 把平台路径转换成稳定的仓库相对路径。 */
function normalizeRelative(value) {
  return value.replaceAll(path.sep, '/').replace(/^\.\//, '').replace(/\/$/, '');
}

/** 判断文件是否命中默认或用户声明的排除项。 */
function isExcluded(relativePath, excludes) {
  const normalized = normalizeRelative(relativePath);
  const segments = normalized.split('/');
  if (segments.some(segment => DEFAULT_EXCLUDED_DIRS.has(segment))) return true;
  return excludes.some(entry => {
    const excluded = normalizeRelative(entry);
    return excluded.includes('/')
      ? normalized === excluded || normalized.startsWith(`${excluded}/`)
      : segments.includes(excluded);
  });
}

/** Flow 审计只接收 Hermes 能解析的 JavaScript 与 JSX 文件。 */
function isSourceFile(filePath) {
  return /\.(?:[cm]?js|jsx)$/i.test(filePath);
}

/** 递归收集扫描文件；跳过软链接，避免越出目标树或重复遍历。 */
function collectFiles(root, scanPaths, excludes) {
  const files = new Set();
  const visited = new Set();

  const visit = absolutePath => {
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Scan path does not exist: ${absolutePath}`);
    }
    const relativePath = normalizeRelative(path.relative(root, absolutePath));
    if (relativePath && isExcluded(relativePath, excludes)) return;

    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) {
      if (isSourceFile(absolutePath)) files.add(absolutePath);
      return;
    }
    if (!stat.isDirectory()) return;

    const realPath = fs.realpathSync(absolutePath);
    if (visited.has(realPath)) return;
    visited.add(realPath);
    for (const entry of fs.readdirSync(absolutePath).sort()) {
      visit(path.join(absolutePath, entry));
    }
  };

  for (const scanPath of scanPaths) visit(path.resolve(root, scanPath));
  return [...files].sort();
}

/** 读取声明级豁免；空原因会直接让审计失败。 */
function loadExemptions(root, exemptionsPath) {
  if (!exemptionsPath) return new Map();
  const absolutePath = path.resolve(root, exemptionsPath);
  const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  const source = parsed.exemptions ?? parsed;
  if (!source || Array.isArray(source) || typeof source !== 'object') {
    throw new Error(
      'Exemptions JSON must contain an object map under "exemptions"',
    );
  }

  const exemptions = new Map();
  for (const [id, reason] of Object.entries(source)) {
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new Error(`Exemption reason must be non-empty: ${id}`);
    }
    exemptions.set(id, reason.trim());
  }
  return exemptions;
}

/** 返回标识符、字面量或模式在源码中的稳定名称。 */
function nodeName(node, sourceText) {
  if (!node) return '';
  if (node.type === 'Identifier' || node.type === 'PrivateName') {
    return node.name ?? node.id?.name ?? '';
  }
  if (
    node.type === 'StringLiteral' ||
    node.type === 'NumericLiteral' ||
    node.type === 'BooleanLiteral'
  ) {
    return String(node.value);
  }
  if (Number.isInteger(node.start) && Number.isInteger(node.end)) {
    return sourceText.slice(node.start, node.end).replace(/\s+/g, ' ').trim();
  }
  return '';
}

/** 从变量、属性或导出包装中恢复匿名类/函数的声明名称。 */
function inferredContainerName(node, parentMap, sourceText) {
  if (!node) return '';
  const own = nodeName(node.id, sourceText);
  if (own) return own;
  const parent = parentMap.get(node);
  if (parent?.type === 'VariableDeclarator') {
    return nodeName(parent.id, sourceText);
  }
  if (
    parent?.type === 'ObjectProperty' ||
    parent?.type === 'ClassProperty' ||
    parent?.type === 'ClassPrivateProperty'
  ) {
    return nodeName(parent.key, sourceText);
  }
  return '';
}

/** 生成带容器前缀的符号名，避免不同类和嵌套函数中的同名声明混淆。 */
function qualifiedName(node, ownName, parentMap, sourceText) {
  const owners = [];
  let current = parentMap.get(node);
  while (current && current.type !== 'Program') {
    let name = '';
    if (
      current.type === 'ClassDeclaration' ||
      current.type === 'ClassExpression' ||
      current.type === 'FunctionDeclaration' ||
      current.type === 'FunctionExpression' ||
      current.type === 'ArrowFunctionExpression' ||
      current.type === 'InterfaceDeclaration' ||
      current.type === 'DeclareInterface' ||
      current.type === 'TypeAlias' ||
      current.type === 'DeclareTypeAlias' ||
      current.type === 'OpaqueType' ||
      current.type === 'DeclareOpaqueType'
    ) {
      name = inferredContainerName(current, parentMap, sourceText);
    } else if (
      current.type === 'ClassMethod' ||
      current.type === 'ClassPrivateMethod' ||
      current.type === 'ObjectMethod'
    ) {
      name = nodeName(current.key, sourceText);
    }
    if (name) owners.unshift(name);
    current = parentMap.get(current);
  }
  return [...owners, ownName || '<anonymous>'].join('.');
}

/** 找到注释真正应贴附的声明起点，例如 `export const` 而非内部 declarator。 */
function commentTarget(node, parentMap) {
  let target = node;
  if (node.type === 'VariableDeclarator') {
    const declaration = parentMap.get(node);
    if (declaration?.type === 'VariableDeclaration') target = declaration;
  }
  const parent = parentMap.get(target);
  if (
    parent?.type === 'ExportNamedDeclaration' ||
    parent?.type === 'ExportDefaultDeclaration' ||
    parent?.type === 'DeclareExportDeclaration'
  ) {
    target = parent;
  }
  return target;
}

/** 判定紧邻声明的最后一条注释类型；指令不能充当解释性注释。 */
function commentKind(node, parentMap, comments, sourceText) {
  const target = commentTarget(node, parentMap);
  const targetStart = target.start;
  let candidateIndex = -1;
  for (let index = 0; index < comments.length; index += 1) {
    if (comments[index].end > targetStart) break;
    candidateIndex = index;
  }
  if (candidateIndex === -1) return 'none';

  let boundary = targetStart;
  let skippedDirective = false;
  while (candidateIndex >= 0) {
    const candidate = comments[candidateIndex];
    const gap = sourceText.slice(candidate.end, boundary);
    if (/\S/.test(gap) || /\n\s*\n/.test(gap)) {
      return skippedDirective ? 'directive' : 'none';
    }

    const raw = sourceText.slice(candidate.start, candidate.end);
    if (DIRECTIVE_COMMENT.test(raw)) {
      // Flow/ESLint 等指令必须紧邻声明，解释性 TSDoc 往往只能放在指令之前。
      // 跳过连续指令继续向前找；若没有解释注释，仍返回 directive，不能误计为已记录。
      skippedDirective = true;
      boundary = candidate.start;
      candidateIndex -= 1;
      continue;
    }
    if (raw.startsWith('/**')) return 'tsdoc';
    if (raw.startsWith('//')) return 'line';
    return 'block';
  }
  return skippedDirective ? 'directive' : 'none';
}

/** 判断变量是否为源码文件直接声明的顶层 `const`。 */
function isTopLevelConst(node, parentMap) {
  const declaration = parentMap.get(node);
  if (declaration?.type !== 'VariableDeclaration' || declaration.kind !== 'const') {
    return false;
  }
  let parent = parentMap.get(declaration);
  if (
    parent?.type === 'ExportNamedDeclaration' ||
    parent?.type === 'ExportDefaultDeclaration'
  ) {
    parent = parentMap.get(parent);
  }
  return parent?.type === 'Program';
}

/** 判断节点是否是函数表达式。 */
function isFunctionValue(node) {
  return (
    node?.type === 'ArrowFunctionExpression' ||
    node?.type === 'FunctionExpression'
  );
}

/** 把 Hermes 的语法错误规范化为可定位诊断。 */
function formatParseError(relativeFile, error) {
  const line = error.loc?.line ?? error.location?.start?.line ?? 1;
  const column = error.loc?.column ?? error.location?.start?.column ?? 0;
  return `${relativeFile}:${line}:${column + 1} ${error.message}`;
}

/** 审计单个 Flow 文件，产出解析诊断和声明记录。 */
function auditFile(hermes, root, filePath) {
  const sourceText = fs.readFileSync(filePath, 'utf8');
  const relativeFile = normalizeRelative(path.relative(root, filePath));
  let file;
  try {
    file = hermes.parse(sourceText, {
      babel: true,
      flow: 'all',
      sourceFilename: relativeFile,
      sourceType: 'unambiguous',
    });
  } catch (error) {
    return {diagnostics: [formatParseError(relativeFile, error)], records: []};
  }

  const comments = [...(file.comments ?? [])].sort((left, right) => left.end - right.end);
  const parentMap = new WeakMap();
  const records = [];

  const add = (node, kind, name) => {
    records.push({
      file: relativeFile,
      line: node.loc?.start?.line ?? 1,
      column: (node.loc?.start?.column ?? 0) + 1,
      kind,
      name: qualifiedName(node, name, parentMap, sourceText),
      comment: commentKind(node, parentMap, comments, sourceText),
    });
  };

  const visit = (node, parent = null) => {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
    if (parent) parentMap.set(node, parent);

    switch (node.type) {
      case 'FunctionDeclaration':
      case 'DeclareFunction':
      case 'ComponentDeclaration':
      case 'DeclareComponent':
      case 'HookDeclaration':
      case 'DeclareHook':
        add(node, 'function', nodeName(node.id, sourceText) || '<default>');
        break;
      case 'ClassDeclaration':
      case 'DeclareClass':
        add(node, 'class', nodeName(node.id, sourceText) || '<default>');
        break;
      case 'InterfaceDeclaration':
      case 'DeclareInterface':
        add(node, 'interface', nodeName(node.id, sourceText));
        break;
      case 'TypeAlias':
      case 'DeclareTypeAlias':
      case 'OpaqueType':
      case 'DeclareOpaqueType':
        add(node, 'type', nodeName(node.id, sourceText));
        break;
      case 'EnumDeclaration':
        add(node, 'enum', nodeName(node.id, sourceText));
        break;
      case 'ClassMethod':
      case 'ClassPrivateMethod': {
        const name = nodeName(node.key, sourceText);
        const kind =
          node.kind === 'constructor'
            ? 'constructor'
            : node.kind === 'get'
              ? 'getter'
              : node.kind === 'set'
                ? 'setter'
                : 'method';
        add(node, kind, node.kind === 'constructor' ? 'constructor' : name);
        break;
      }
      case 'ObjectMethod': {
        const kind =
          node.kind === 'get' ? 'getter' : node.kind === 'set' ? 'setter' : 'method';
        add(node, kind, nodeName(node.key, sourceText));
        break;
      }
      case 'ClassProperty':
      case 'ClassPrivateProperty':
        add(
          node,
          isFunctionValue(node.value) ? 'function-property' : 'field',
          nodeName(node.key, sourceText),
        );
        break;
      case 'ObjectTypeProperty':
        add(
          node,
          node.method
            ? 'method-signature'
            : node.value?.type === 'FunctionTypeAnnotation'
              ? 'function-property'
              : 'field',
          nodeName(node.key, sourceText),
        );
        break;
      case 'ObjectTypeCallProperty':
        add(node, 'call-signature', '<call>');
        break;
      case 'ObjectTypeIndexer':
      case 'ObjectTypeInternalSlot':
        add(node, 'field', nodeName(node.id ?? node.key, sourceText) || '[index]');
        break;
      case 'VariableDeclarator': {
        const name = nodeName(node.id, sourceText);
        if (isFunctionValue(node.init)) add(node, 'function-variable', name);
        else if (node.init?.type === 'ClassExpression') add(node, 'class', name);
        else if (isTopLevelConst(node, parentMap)) add(node, 'constant', name);
        break;
      }
      case 'ObjectProperty':
        if (isFunctionValue(node.value)) {
          add(node, 'function-property', nodeName(node.key, sourceText));
        }
        break;
      case 'DeclareVariable':
        add(node, 'constant', nodeName(node.id, sourceText));
        break;
      case 'ArrowFunctionExpression':
      case 'FunctionExpression':
        if (parent?.type === 'ExportDefaultDeclaration') {
          add(node, 'function', '<default>');
        }
        break;
      default:
        if (/^Enum.*Member$/.test(node.type)) {
          add(node, 'enum-member', nodeName(node.id ?? node.key, sourceText));
        }
        break;
    }

    for (const [key, value] of Object.entries(node)) {
      if (
        key === 'loc' ||
        key === 'comments' ||
        key === 'tokens' ||
        key === 'errors' ||
        key === 'leadingComments' ||
        key === 'trailingComments' ||
        key === 'innerComments'
      ) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const child of value) visit(child, node);
      } else {
        visit(value, node);
      }
    }
  };

  visit(file.program);
  return {diagnostics: [], records};
}

/** 为同文件同名声明追加稳定 occurrence 后缀。 */
function assignIds(records) {
  records.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.column - right.column ||
      left.kind.localeCompare(right.kind),
  );
  const seen = new Map();
  for (const record of records) {
    const base = `${record.file}#${record.kind}#${record.name}`;
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    record.id = occurrence === 1 ? base : `${base}@${occurrence}`;
  }
}

/** 按结构注释、TSDoc 要求和显式豁免归类每个声明。 */
function classify(records, exemptions) {
  const usedExemptions = new Set();
  for (const record of records) {
    const reason = exemptions.get(record.id);
    if (reason) {
      record.status = 'exempt';
      record.reason = reason;
      usedExemptions.add(record.id);
    } else if (record.comment === 'none' || record.comment === 'directive') {
      record.status = 'missing';
    } else if (TSDOC_KINDS.has(record.kind) && record.comment !== 'tsdoc') {
      record.status = 'needs-tsdoc';
    } else {
      record.status = 'documented';
    }
  }
  return [...exemptions.keys()].filter(id => !usedExemptions.has(id));
}

/** 汇总文件数、声明数、分类状态和声明类别。 */
function buildSummary(files, records) {
  const byStatus = {documented: 0, exempt: 0, missing: 0, 'needs-tsdoc': 0};
  // `constructor` 本身也是声明类别，必须使用无原型对象，避免命中
  // `Object.prototype.constructor` 后把原生函数字符串拼进计数。
  const byKind = Object.create(null);
  for (const record of records) {
    byStatus[record.status] += 1;
    byKind[record.kind] = (byKind[record.kind] ?? 0) + 1;
  }
  return {
    files: files.length,
    declarations: records.length,
    unresolved: byStatus.missing + byStatus['needs-tsdoc'],
    byStatus,
    byKind,
  };
}

/** 转义 Markdown 表格单元格。 */
function escapeCell(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

/** 生成与技能审计器兼容的 Markdown 报告。 */
function renderMarkdown(result, missingOnly) {
  const {summary, diagnostics, unusedExemptions} = result;
  const lines = [
    '# Flow 注释覆盖审计',
    '',
    `- 文件：${summary.files}`,
    `- 声明：${summary.declarations}`,
    `- 已记录：${summary.byStatus.documented}`,
    `- 已豁免：${summary.byStatus.exempt}`,
    `- 缺少注释：${summary.byStatus.missing}`,
    `- 需要 TSDoc：${summary.byStatus['needs-tsdoc']}`,
    `- 未解决：${summary.unresolved}`,
  ];

  if (diagnostics.length > 0) {
    lines.push('', '## 解析错误', '', ...diagnostics.map(item => `- ${item}`));
  }
  if (unusedExemptions.length > 0) {
    lines.push('', '## 未匹配豁免', '', ...unusedExemptions.map(item => `- ${item}`));
  }

  const visible = missingOnly
    ? result.records.filter(record =>
        ['missing', 'needs-tsdoc'].includes(record.status),
      )
    : result.records;
  lines.push(
    '',
    '## 声明',
    '',
    '| 状态 | 类别 | 符号 | 位置 | 注释 | 豁免原因 |',
    '|---|---|---|---|---|---|',
  );
  for (const record of visible) {
    lines.push(
      `| ${escapeCell(record.status)} | ${escapeCell(record.kind)} | ${escapeCell(record.name)} | ` +
        `${escapeCell(`${record.file}:${record.line}`)} | ${escapeCell(record.comment)} | ${escapeCell(record.reason)} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/** 执行审计；解析错误、悬空豁免和未解决声明分别返回稳定退出码。 */
function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return;
    }

    const hermes = loadHermesParser(options.root, options.hermesParser);
    const files = collectFiles(options.root, options.scanPaths, options.excludes);
    if (files.length === 0) throw new Error('No Flow source files matched scan paths');

    const diagnostics = [];
    const records = [];
    for (const file of files) {
      const result = auditFile(hermes, options.root, file);
      diagnostics.push(...result.diagnostics);
      records.push(...result.records);
    }
    assignIds(records);

    const exemptions = loadExemptions(options.root, options.exemptions);
    const unusedExemptions = classify(records, exemptions);
    const result = {
      root: options.root,
      scanPaths: options.scanPaths,
      parser: `hermes-parser@${hermes.version ?? 'unknown'}`,
      summary: buildSummary(files, records),
      diagnostics,
      unusedExemptions,
      records: options.missingOnly
        ? records.filter(record =>
            ['missing', 'needs-tsdoc'].includes(record.status),
          )
        : records,
    };

    const output =
      options.format === 'json'
        ? `${JSON.stringify(result, null, 2)}\n`
        : renderMarkdown({...result, records}, options.missingOnly);
    process.stdout.write(output);

    if (diagnostics.length > 0) process.exitCode = 2;
    else if (options.strictExemptions && unusedExemptions.length > 0) {
      process.exitCode = 2;
    } else if (options.failOnMissing && result.summary.unresolved > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`audit-flow-comment-coverage: ${error.message}\n`);
    process.exitCode = 2;
  }
}

main();
