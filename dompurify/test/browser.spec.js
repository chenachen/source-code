/**
 * 为两个浏览器构建入口各注册一个 Playwright 外层场景。
 * 实际清洗/XSS 断言由 test-suite 注册，entry.js 发布整套 QUnit 结果；这里等待完成、
 * 检查页面异常及失败断言数，并拒绝 total=0 的空跑。浏览器 console error 仅作失败诊断。
 */

'use strict';

/** Playwright 的场景注册和断言 API；浏览器与 baseURL 由 config/playwright.config.js 提供。 */
const { test, expect } = require('@playwright/test');

/** 同一 QUnit 语料分别加载普通 UMD 与压缩 UMD；参数只改变 HTML/构建，不改变断言集。 */
const suites = [
  { label: 'purify.js', path: '/test/browser/index.html' },
  { label: 'purify.min.js', path: '/test/browser/index.min.html' },
];

for (const suite of suites) {
  /**
   * 场景：打开当前 suite.path，在当前 Playwright project 的浏览器中运行共享 QUnit 套件。
   * 操作：收集 pageerror/console，再等待 __qunitDone__ 最长 90 秒；超时或导航异常交给 Playwright。
   * 预期：无未捕获页面错误、QUnit 失败断言数为 0、总断言数大于 0；两参数分别覆盖 purify.js / purify.min.js。
   * 验证目标：真实浏览器中两种分发构建都能完成非空套件，失败时保留逐断言诊断。
   */
  test(`${suite.label} — QUnit suite passes`, async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => {
      pageErrors.push(err.stack || err.message);
    });

    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(suite.path);

    // entry.js 完成回调先写结果再置完成标志；每 100ms 轮询，页面挂起时由 90s 上限报错。
    await page.waitForFunction(() => window.__qunitDone__ === true, null, {
      timeout: 90_000,
      polling: 100,
    });

    const { result, failures } = await page.evaluate(() => ({
      result: window.__qunitResult__,
      failures: window.__qunitFailures__,
    }));

    // QUnit 失败时先打印用例与失败断言；随后外层 expect 正式使该参数场景失败。
    if (failures.length > 0) {
      const lines = ['', `${failures.length} QUnit test(s) reported failures:`];
      for (const f of failures) {
        lines.push(`  ${f.module} > ${f.name}  (${f.failed}/${f.total})`);
        for (const a of f.assertions) {
          lines.push(`    - ${a.message || '(no message)'}`);
          lines.push(`        expected: ${JSON.stringify(a.expected)}`);
          lines.push(`        actual:   ${JSON.stringify(a.actual)}`);
        }
      }
      // eslint-disable-next-line no-console
      console.error(lines.join('\n'));
    }

    expect(
      pageErrors,
      `uncaught page error(s):\n${pageErrors.join('\n---\n')}`
    ).toEqual([]);

    expect(
      result.failed,
      `${result.failed} of ${result.total} QUnit assertions failed`
    ).toBe(0);

    // failed=0 也可能来自空套件；total>0 把“未注册或未执行任何断言”单独拒绝。
    expect(result.total, 'QUnit reported zero total tests').toBeGreaterThan(0);

    // 打印当前参数构建的断言计数与耗时，方便比较浏览器项目。
    // eslint-disable-next-line no-console
    console.log(
      `  ${suite.label}: ${result.passed}/${result.total} passed in ${result.runtime} ms`
    );

    // 某些用例故意产生 console error，因此它不单独决定通过与否；只在 QUnit 失败时追加诊断。
    if (failures.length > 0 && consoleErrors.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `browser console errors during failing run:\n  ${consoleErrors.join('\n  ')}`
      );
    }
  });
}
