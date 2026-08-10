#!/usr/bin/env node

/**
 * 校验分享教程中的代码证据身份。
 *
 * - “连续原码 / 连续测试原码”必须逐字出现在 figcaption 链接的本地文件中；
 * - “删节源码”必须链接到存在的本地文件，但不冒充连续实现；
 * - “教程代码 / 教程伪代码 / 教程命令 / 非仓库源码”明确不参与源码匹配；
 * - 其他 source figure 视为证据身份不明确并失败。
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  let guide = '../share/react';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--guide') {
      guide = argv[++i];
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(
        'Usage: node audit-guide-source-snippets.mjs [--guide ../share/react]',
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return {guide};
}

function decodeEntities(value) {
  const named = new Map([
    ['amp', '&'],
    ['lt', '<'],
    ['gt', '>'],
    ['quot', '"'],
    ['apos', "'"],
    ['nbsp', '\u00a0'],
  ]);
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (_, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1].toLowerCase() === 'x';
      const number = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : _;
    }
    return named.get(entity.toLowerCase()) ?? _;
  });
}

function htmlToText(value) {
  return decodeEntities(value.replace(/<[^>]*>/g, '')).replace(/\r\n?/g, '\n');
}

function trimSnippet(value) {
  return value.replace(/^\n+|\n+$/g, '');
}

function lineAt(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function evidenceKind(caption) {
  if (caption.includes('连续测试原码')) return 'exact-test';
  if (caption.includes('连续原码')) return 'exact-source';
  if (caption.includes('删节源码')) return 'abridged';
  if (
    caption.includes('教程代码') ||
    caption.includes('教程伪代码') ||
    caption.includes('教程命令') ||
    caption.includes('非仓库源码')
  ) {
    return 'tutorial';
  }
  return 'ambiguous';
}

const {guide} = parseArgs(process.argv.slice(2));
const guideRoot = path.resolve(process.cwd(), guide);
if (!fs.existsSync(guideRoot) || !fs.statSync(guideRoot).isDirectory()) {
  throw new Error(`Guide directory does not exist: ${guideRoot}`);
}

const files = fs
  .readdirSync(guideRoot)
  .filter(file => file.endsWith('.html'))
  .sort();

const totals = {
  files: files.length,
  figures: 0,
  exact: 0,
  exactMatched: 0,
  exactSource: 0,
  exactSourceMatched: 0,
  exactTest: 0,
  exactTestMatched: 0,
  abridged: 0,
  tutorial: 0,
};
const errors = [];

for (const file of files) {
  const htmlPath = path.join(guideRoot, file);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const figurePattern = /<figure\s+class="[^"]*\bsource\b[^"]*"[^>]*>([\s\S]*?)<\/figure>/g;
  let match;
  while ((match = figurePattern.exec(html)) !== null) {
    totals.figures++;
    const figure = match[1];
    const captionHtml = figure.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/)?.[1];
    const caption = captionHtml === undefined ? '' : htmlToText(captionHtml).trim();
    const kind = evidenceKind(caption);
    const location = `${file}:${lineAt(html, match.index)}`;
    const href = figure.match(/<a[^>]*\shref="([^"]+)"/)?.[1];

    if (kind === 'ambiguous') {
      errors.push(`${location}: 代码框证据身份不明确：${caption || '(无 figcaption)'}`);
      continue;
    }
    if (kind === 'tutorial') {
      totals.tutorial++;
      continue;
    }

    if (href === undefined || /^(?:https?:|mailto:|#)/.test(href)) {
      errors.push(`${location}: ${caption} 必须链接到本地证据文件`);
      continue;
    }
    const cleanHref = href.split(/[?#]/, 1)[0];
    const target = path.resolve(path.dirname(htmlPath), cleanHref);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      errors.push(`${location}: 本地证据文件不存在：${href}`);
      continue;
    }

    if (kind === 'abridged') {
      totals.abridged++;
      continue;
    }

    totals.exact++;
    if (kind === 'exact-test') {
      totals.exactTest++;
    } else {
      totals.exactSource++;
    }
    const preHtml = figure.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)?.[1];
    if (preHtml === undefined) {
      errors.push(`${location}: ${caption} 缺少 pre 代码块`);
      continue;
    }
    const snippet = trimSnippet(htmlToText(preHtml));
    const targetSource = fs.readFileSync(target, 'utf8').replace(/\r\n?/g, '\n');
    if (snippet.length === 0 || !targetSource.includes(snippet)) {
      const firstLine = snippet.split('\n', 1)[0];
      errors.push(
        `${location}: ${caption} 未在 ${path.relative(process.cwd(), target)} 连续匹配；首行：${firstLine}`,
      );
      continue;
    }
    totals.exactMatched++;
    if (kind === 'exact-test') {
      totals.exactTestMatched++;
    } else {
      totals.exactSourceMatched++;
    }
  }
}

console.log('# 教程源码证据审计');
console.log('');
console.log(`- HTML 文件：${totals.files}`);
console.log(`- source 代码框：${totals.figures}`);
console.log(`- 连续原码/测试：${totals.exactMatched}/${totals.exact}`);
console.log(
  `  - 生产源码：${totals.exactSourceMatched}/${totals.exactSource}`,
);
console.log(`  - 测试源码：${totals.exactTestMatched}/${totals.exactTest}`);
console.log(`- 明确删节源码：${totals.abridged}`);
console.log(`- 教程代码/命令：${totals.tutorial}`);
console.log(`- 错误：${errors.length}`);

if (errors.length > 0) {
  console.log('');
  for (const error of errors) console.log(`- ${error}`);
  process.exitCode = 1;
}
