#!/usr/bin/env node

/**
 * 对离线多页源码指南执行结构与链接门禁。
 *
 * 校验：
 * - 常用结构标签严格闭合；
 * - 每页恰有一个 main、aside、h1 与 aria-current="page"；
 * - id 页内唯一；
 * - href/src 指向存在的仓库内文件，HTML fragment 指向真实 id；
 * - 所有 HTML 页面都能从 index.html 沿本地链接到达。
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
      console.log('Usage: node audit-guide-html.mjs [--guide ../share/react]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return {guide};
}

function countTag(html, tag) {
  return (html.match(new RegExp(`<${tag}\\b`, 'gi')) ?? []).length;
}

function lineAt(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function stripQuery(value) {
  return value.split(/[?#]/, 1)[0];
}

function fragmentOf(value) {
  const index = value.indexOf('#');
  if (index === -1) return '';
  return decodeURIComponent(value.slice(index + 1).split('?', 1)[0]);
}

const {guide} = parseArgs(process.argv.slice(2));
const guideRoot = path.resolve(process.cwd(), guide);
const repositoryRoot = path.resolve(guideRoot, '..', '..');
if (!fs.existsSync(guideRoot) || !fs.statSync(guideRoot).isDirectory()) {
  throw new Error(`Guide directory does not exist: ${guideRoot}`);
}

const files = fs
  .readdirSync(guideRoot)
  .filter(file => file.endsWith('.html'))
  .sort();
const htmlByFile = new Map(
  files.map(file => [file, fs.readFileSync(path.join(guideRoot, file), 'utf8')]),
);
const idsByFile = new Map();
const graph = new Map(files.map(file => [file, new Set()]));
const errors = [];
let linkCount = 0;
let fragmentCount = 0;

const voidTags = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

for (const file of files) {
  const html = htmlByFile.get(file);
  const cleanHtml = html.replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  const tagPattern = /<\/?([a-z][\w:-]*)\b[^>]*>/gi;
  let tagMatch;
  while ((tagMatch = tagPattern.exec(cleanHtml)) !== null) {
    const full = tagMatch[0];
    const tag = tagMatch[1].toLowerCase();
    if (voidTags.has(tag) || full.endsWith('/>') || full.startsWith('<!')) continue;
    if (!full.startsWith('</')) {
      stack.push({tag, line: lineAt(cleanHtml, tagMatch.index)});
      continue;
    }
    const opened = stack.pop();
    if (opened === undefined || opened.tag !== tag) {
      errors.push(
        `${file}:${lineAt(cleanHtml, tagMatch.index)}: 标签 </${tag}> 与 ${
          opened === undefined ? '空栈' : `<${opened.tag}>（第 ${opened.line} 行）`
        } 不匹配`,
      );
    }
  }
  for (const opened of stack) {
    errors.push(`${file}:${opened.line}: 标签 <${opened.tag}> 未闭合`);
  }

  for (const tag of ['main', 'aside', 'h1']) {
    const count = countTag(html, tag);
    if (count !== 1) errors.push(`${file}: <${tag}> 数量应为 1，实际 ${count}`);
  }
  const currentCount = (html.match(/\saria-current=["']page["']/gi) ?? []).length;
  if (currentCount !== 1) {
    errors.push(`${file}: aria-current="page" 数量应为 1，实际 ${currentCount}`);
  }

  const ids = new Set();
  const idPattern = /\sid=["']([^"']+)["']/gi;
  let idMatch;
  while ((idMatch = idPattern.exec(html)) !== null) {
    if (ids.has(idMatch[1])) errors.push(`${file}: 重复 id：${idMatch[1]}`);
    ids.add(idMatch[1]);
  }
  idsByFile.set(file, ids);
}

for (const file of files) {
  const html = htmlByFile.get(file);
  const attributePattern = /\s(href|src)=["']([^"']+)["']/gi;
  let attributeMatch;
  while ((attributeMatch = attributePattern.exec(html)) !== null) {
    const [, attribute, value] = attributeMatch;
    if (/^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(value)) {
      errors.push(`${file}:${lineAt(html, attributeMatch.index)}: 离线指南含外部 ${attribute}：${value}`);
      continue;
    }
    linkCount++;
    const clean = stripQuery(value);
    const fragment = fragmentOf(value);
    const target = clean === '' ? path.join(guideRoot, file) : path.resolve(guideRoot, clean);
    if (target !== repositoryRoot && !target.startsWith(repositoryRoot + path.sep)) {
      errors.push(`${file}:${lineAt(html, attributeMatch.index)}: 链接逃出仓库：${value}`);
      continue;
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      errors.push(`${file}:${lineAt(html, attributeMatch.index)}: 本地目标不存在：${value}`);
      continue;
    }
    if (fragment !== '') {
      fragmentCount++;
      const targetFile = path.basename(target);
      if (target.endsWith('.html')) {
        const targetIds = idsByFile.get(targetFile);
        if (targetIds === undefined || !targetIds.has(fragment)) {
          errors.push(`${file}:${lineAt(html, attributeMatch.index)}: fragment 不存在：${value}`);
        }
      }
    }
    if (attribute.toLowerCase() === 'href' && target.endsWith('.html')) {
      const targetFile = path.basename(target);
      if (graph.has(targetFile)) graph.get(file).add(targetFile);
    }
  }
}

if (!htmlByFile.has('index.html')) {
  errors.push('缺少 index.html');
} else {
  const reachable = new Set(['index.html']);
  const queue = ['index.html'];
  while (queue.length > 0) {
    const file = queue.shift();
    for (const target of graph.get(file) ?? []) {
      if (!reachable.has(target)) {
        reachable.add(target);
        queue.push(target);
      }
    }
  }
  for (const file of files) {
    if (!reachable.has(file)) errors.push(`${file}: 无法从 index.html 沿本地链接到达`);
  }
}

console.log('# 教程 HTML 完整性审计');
console.log('');
console.log(`- HTML 文件：${files.length}`);
console.log(`- 本地 href/src：${linkCount}`);
console.log(`- fragment：${fragmentCount}`);
console.log(`- 错误：${errors.length}`);
if (errors.length > 0) {
  console.log('');
  for (const error of errors) console.log(`- ${error}`);
  process.exitCode = 1;
}
