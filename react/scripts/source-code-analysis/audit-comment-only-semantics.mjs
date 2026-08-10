#!/usr/bin/env node

/**
 * 比较当前 React Flow/JavaScript 源码与编辑前基线的非注释语义。
 *
 * @remarks
 * 声明覆盖只能证明“有说明”，不能证明补注释时没有碰到业务代码。本脚本同时
 * 比较去除注释和位置信息后的 Hermes AST，以及完整的非注释 token 序列；任一
 * 文件解析失败、基线缺失或比较不等价都会让命令失败。
 */

import crypto from 'node:crypto';
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

const AST_METADATA_KEYS = new Set([
  'comments',
  'end',
  'errors',
  'innerComments',
  'leadingComments',
  'loc',
  'range',
  'start',
  'tokens',
  'trailingComments',
]);

/** 输出命令行帮助。 */
function printHelp() {
  process.stdout.write(`Usage:
  node audit-comment-only-semantics.mjs --root <repo> --baseline-root <repo> \\
    --path <source> --hermes-parser <path> [options]

Options:
  --root <dir>             Current repository root. Defaults to cwd.
  --baseline-root <dir>    Unedited repository snapshot root. Required.
  --path <path>            JavaScript file or directory to compare. Repeatable.
  --exclude <path>         Repository-relative path or directory name to skip.
  --hermes-parser <path>   Hermes Parser package directory or entry file.
  --format <markdown|json> Output format. Defaults to markdown.
  --help                   Show this help.
`);
}

/** 解析 CLI 参数，并把两个源码根目录都规范成绝对路径。 */
function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    scanPaths: [],
    excludes: [],
    format: 'markdown',
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
    else if (flag === '--baseline-root') {
      options.baselineRoot = takeValue(index++, flag);
    } else if (flag === '--path') {
      options.scanPaths.push(takeValue(index++, flag));
    } else if (flag === '--exclude') {
      options.excludes.push(takeValue(index++, flag));
    } else if (flag === '--hermes-parser') {
      options.hermesParser = takeValue(index++, flag);
    } else if (flag === '--format') {
      options.format = takeValue(index++, flag);
    } else {
      throw new Error(`Unknown option: ${flag}`);
    }
  }

  if (!['json', 'markdown'].includes(options.format)) {
    throw new Error('--format must be markdown or json');
  }
  if (!options.help && !options.baselineRoot) {
    throw new Error('--baseline-root is required');
  }
  if (options.scanPaths.length === 0) options.scanPaths.push('src');
  options.root = path.resolve(options.root);
  if (options.baselineRoot) {
    options.baselineRoot = path.resolve(options.baselineRoot);
  }
  // 两侧快照必须复用同一仓库相对路径。允许调用方给出当前 root 内的绝对路径，
  // 但先在这里归一化，避免把该绝对路径原样套到 baseline root 后误判越界。
  const rootPrefix = `${options.root}${path.sep}`;
  options.scanPaths = options.scanPaths.map(scanPath => {
    const absolutePath = path.resolve(options.root, scanPath);
    if (absolutePath !== options.root && !absolutePath.startsWith(rootPrefix)) {
      throw new Error(`Scan path escapes repository root: ${scanPath}`);
    }
    return normalizeRelative(path.relative(options.root, absolutePath)) || '.';
  });
  return options;
}

/** 从显式路径、当前仓库或脚本目录加载 Hermes Parser。 */
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

/** 语义门禁只接收 Hermes 能解析的 JavaScript 与 JSX 文件。 */
function isSourceFile(filePath) {
  return /\.(?:[cm]?js|jsx)$/i.test(filePath);
}

/** 递归收集当前快照文件；跳过软链接，避免越界或重复遍历。 */
function collectFiles(root, scanPaths, excludes) {
  const files = new Set();
  const visited = new Set();
  const resolvedRoot = path.resolve(root);
  const rootPrefix = `${resolvedRoot}${path.sep}`;

  const visit = absolutePath => {
    // 某一侧整个目录都不存在时先返回空集合；随后用两侧并集把它报告为
    // current-missing 或 baseline-missing，而不是在收集阶段提前吞掉删除/新增证据。
    if (!fs.existsSync(absolutePath)) return;
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

  for (const scanPath of scanPaths) {
    const absolutePath = path.resolve(resolvedRoot, scanPath);
    if (absolutePath !== resolvedRoot && !absolutePath.startsWith(rootPrefix)) {
      throw new Error(`Scan path escapes repository root: ${scanPath}`);
    }
    visit(absolutePath);
  }
  return [...files].sort();
}

/** 生成稳定 SHA-256，供逐文件和聚合报告复核。 */
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * 递归移除注释、源码位置和解析器附带错误槽，并稳定对象键顺序。
 *
 * @remarks
 * 业务节点、字面量原文和指令仍保留；因此该 AST 归一化不会把代码改写误当成
 * 注释变化。数组顺序也保持原样，以覆盖语句、参数和属性顺序。
 */
function normalizeAst(value) {
  if (Array.isArray(value)) return value.map(normalizeAst);
  if (value === null || typeof value !== 'object') return value;

  const normalized = {};
  for (const key of Object.keys(value).sort()) {
    if (AST_METADATA_KEYS.has(key)) continue;
    const child = value[key];
    if (child !== undefined) normalized[key] = normalizeAst(child);
  }
  return normalized;
}

/**
 * 提取会影响类型检查、lint、测试 gate、覆盖率或打包器的注释指令签名。
 *
 * @remarks
 * 普通解释性文字允许翻译，因此不能比较全部注释原文；这里只保留工具真正消费的
 * 标记、错误码、规则列表、gate 表达式和 webpack 参数。Flow/TS 指令后的自然语言
 * 说明不属于签名，避免把合法翻译误报为语义变化。
 */
function extractToolDirectives(comments) {
  const directives = [];
  for (const comment of comments ?? []) {
    for (const rawLine of String(comment.value ?? '').split(/\r?\n/)) {
      const line = rawLine.replace(/^\s*\*?\s*/, '').trim();
      if (!line) continue;

      for (const match of line.matchAll(
        /@flow(?:\s+(?:strict(?:-local)?|weak))?|\$Flow(?:FixMe|ExpectedError|Issue)(?:\[[^\]\r\n]+\])?/g,
      )) {
        directives.push(match[0]);
      }

      const eslintIndex = line.search(/eslint-(?:disable|enable)/);
      if (eslintIndex !== -1) {
        directives.push(
          line.slice(eslintIndex).split(/\s+--\s+/, 1)[0].trim(),
        );
      }

      for (const match of line.matchAll(
        /prettier-ignore(?:-start|-end)?|@ts-(?:check|expect-error|ignore|nocheck)|#__PURE__|@__NO_SIDE_EFFECTS__|@noinline|@generated|@noflow|@react-refresh\b/gi,
      )) {
        directives.push(match[0]);
      }

      if (line.startsWith('@gate')) directives.push(line);

      for (const match of line.matchAll(/(?:istanbul|c8)\s+ignore(?:\s+\w+)?/gi)) {
        directives.push(match[0]);
      }

      const webpackIndex = line.search(/webpack[A-Za-z]+\s*:/);
      if (webpackIndex !== -1) {
        directives.push(line.slice(webpackIndex).trim());
      }
    }
  }
  return directives;
}

/** 解析单份源码，并返回去注释 AST 与非注释 token 的稳定摘要。 */
function summarizeSource(hermes, sourceText, relativeFile) {
  const parseOptions = {
    flow: 'all',
    sourceFilename: relativeFile,
    sourceType: 'module',
  };
  const file = hermes.parse(sourceText, {...parseOptions, babel: true});
  const tokenFile = hermes.parse(sourceText, {
    ...parseOptions,
    babel: false,
    tokens: true,
  });
  const tokens = (tokenFile.tokens ?? []).map(token => [token.type, token.value]);
  const directives = extractToolDirectives(file.comments);
  return {
    astHash: sha256(JSON.stringify(normalizeAst(file))),
    tokenHash: sha256(JSON.stringify(tokens)),
    tokenCount: tokens.length,
    directiveHash: sha256(JSON.stringify(directives)),
    directiveCount: directives.length,
  };
}

/** 对比一个相对路径在当前快照与基线快照中的解析摘要。 */
function compareFile(hermes, relativeFile, filePath, baselinePath) {
  if (!fs.existsSync(filePath)) {
    return {file: relativeFile, status: 'current-missing'};
  }
  if (!fs.existsSync(baselinePath)) {
    return {file: relativeFile, status: 'baseline-missing'};
  }

  try {
    const current = summarizeSource(
      hermes,
      fs.readFileSync(filePath, 'utf8'),
      relativeFile,
    );
    const baseline = summarizeSource(
      hermes,
      fs.readFileSync(baselinePath, 'utf8'),
      relativeFile,
    );
    const astEqual = current.astHash === baseline.astHash;
    const tokenEqual = current.tokenHash === baseline.tokenHash;
    const directiveEqual = current.directiveHash === baseline.directiveHash;
    return {
      file: relativeFile,
      status:
        astEqual && tokenEqual && directiveEqual ? 'equal' : 'different',
      astEqual,
      tokenEqual,
      directiveEqual,
      current,
      baseline,
    };
  } catch (error) {
    const line = error.loc?.line ?? error.location?.start?.line ?? 1;
    const column = error.loc?.column ?? error.location?.start?.column ?? 0;
    return {
      file: relativeFile,
      status: 'parse-error',
      error: `${line}:${column + 1} ${error.message}`,
    };
  }
}

/** 汇总逐文件结果，并生成能复核完整集合的聚合哈希。 */
function buildResult(options, currentFiles, baselineFiles, comparisons) {
  const equal = comparisons.filter(item => item.status === 'equal');
  const mismatches = comparisons.filter(item => item.status !== 'equal');
  const tokenCount = equal.reduce(
    (total, item) => total + item.current.tokenCount,
    0,
  );
  const directiveCount = equal.reduce(
    (total, item) => total + item.current.directiveCount,
    0,
  );
  const astManifest = equal
    .map(item => `${item.file}\0${item.current.astHash}`)
    .join('\n');
  const tokenManifest = equal
    .map(item => `${item.file}\0${item.current.tokenHash}`)
    .join('\n');

  return {
    root: options.root,
    baselineRoot: options.baselineRoot,
    scanPaths: options.scanPaths,
    excludes: options.excludes,
    summary: {
      files: comparisons.length,
      currentFiles: currentFiles.length,
      baselineFiles: baselineFiles.length,
      equal: equal.length,
      astEqual: comparisons.filter(item => item.astEqual === true).length,
      tokenEqual: comparisons.filter(item => item.tokenEqual === true).length,
      directiveEqual: comparisons.filter(item => item.directiveEqual === true)
        .length,
      tokenCount,
      directiveCount,
      mismatches: mismatches.length,
      aggregateAstSha256: sha256(astManifest),
      aggregateTokenSha256: sha256(tokenManifest),
    },
    mismatches,
  };
}

/** 生成便于人工阅读与复制进验收账本的 Markdown 报告。 */
function renderMarkdown(result) {
  const {summary} = result;
  const lines = [
    '# 注释编辑语义等价审计',
    '',
    `- 文件：${summary.files}`,
    `- 当前文件：${summary.currentFiles}`,
    `- 基线文件：${summary.baselineFiles}`,
    `- 完全等价：${summary.equal}`,
    `- AST 等价：${summary.astEqual}`,
    `- token 等价：${summary.tokenEqual}`,
    `- 工具指令等价：${summary.directiveEqual}`,
    `- 非注释 token：${summary.tokenCount}`,
    `- 工具指令签名：${summary.directiveCount}`,
    `- 不等价/错误：${summary.mismatches}`,
    `- 聚合 AST SHA-256：\`${summary.aggregateAstSha256}\``,
    `- 聚合 token SHA-256：\`${summary.aggregateTokenSha256}\``,
  ];

  if (result.mismatches.length > 0) {
    lines.push('', '## 不等价或无法解析的文件', '');
    for (const item of result.mismatches) {
      const details = item.error
        ? `${item.status}: ${item.error}`
        : `${item.status}; AST=${item.astEqual}; token=${item.tokenEqual}; directives=${item.directiveEqual}`;
      lines.push(`- \`${item.file}\` — ${details}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** 执行门禁；任一文件不等价、缺少基线或解析失败都返回非零退出码。 */
function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return;
    }

    if (!fs.existsSync(options.baselineRoot)) {
      throw new Error(`Baseline root does not exist: ${options.baselineRoot}`);
    }
    const hermes = loadHermesParser(options.root, options.hermesParser);
    const currentFiles = collectFiles(
      options.root,
      options.scanPaths,
      options.excludes,
    );
    const baselineFiles = collectFiles(
      options.baselineRoot,
      options.scanPaths,
      options.excludes,
    );
    if (currentFiles.length === 0 && baselineFiles.length === 0) {
      throw new Error('No JavaScript source files matched');
    }

    const currentByRelative = new Map(
      currentFiles.map(filePath => [
        normalizeRelative(path.relative(options.root, filePath)),
        filePath,
      ]),
    );
    const baselineByRelative = new Map(
      baselineFiles.map(filePath => [
        normalizeRelative(path.relative(options.baselineRoot, filePath)),
        filePath,
      ]),
    );
    const relativeFiles = [
      ...new Set([...currentByRelative.keys(), ...baselineByRelative.keys()]),
    ].sort();
    const comparisons = relativeFiles.map(relativeFile =>
      compareFile(
        hermes,
        relativeFile,
        currentByRelative.get(relativeFile) ?? '',
        baselineByRelative.get(relativeFile) ?? '',
      ),
    );
    const result = buildResult(
      options,
      currentFiles,
      baselineFiles,
      comparisons,
    );
    const output =
      options.format === 'json'
        ? `${JSON.stringify(result, null, 2)}\n`
        : renderMarkdown(result);
    process.stdout.write(output);
    if (result.summary.mismatches > 0) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`audit-comment-only-semantics: ${error.message}\n`);
    process.exitCode = 2;
  }
}

main();
