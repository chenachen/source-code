/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment ./scripts/jest/ReactDOMServerIntegrationEnvironment
 */

'use strict';

let JSDOM;
let React;
let ReactDOMClient;
let container;
let waitForAll;

describe('ReactDOM HostSingleton', () => {
  beforeEach(() => {
    jest.resetModules();
    JSDOM = require('jsdom').JSDOM;
    // 测试环境
    const jsdom = new JSDOM(
      '<!DOCTYPE html><html><head></head><body><div id="container">',
      {
        runScripts: 'dangerously',
      },
    );
    global.window = jsdom.window;
    global.document = jsdom.window.document;
    container = global.document.getElementById('container');

    React = require('react');
    ReactDOMClient = require('react-dom/client');

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
  });

  /** 同一 link 槽先渲染 preload，再改为带 precedence 的 stylesheet；根 onUncaughtError 应收到不允许普通 hoistable 转资源的诊断，DEV 另带前后 props 差异，验证资源身份不能跨更新改变。 */
  it('errors when a hoistable component becomes a Resource', async () => {
    const errors = [];
    /** 收集普通 link 转 stylesheet 时根报告的未捕获错误消息，区分 DEV 差异输出与生产诊断。 */
    function onError(e) {
      errors.push(e.message);
    }
    const root = ReactDOMClient.createRoot(container, {
      onUncaughtError: onError,
    });

    root.render(
      <div>
        <link rel="preload" href="bar" as="style" />
      </div>,
    );
    await waitForAll([]);

    root.render(
      <div>
        <link rel="stylesheet" href="bar" precedence="default" />
      </div>,
    );
    await waitForAll([]);
    if (__DEV__) {
      expect(errors).toEqual([
        `Expected <link> not to update to be updated to a stylesheet with precedence. Check the \`rel\`, \`href\`, and \`precedence\` props of this component. Alternatively, check whether two different <link> components render in the same slot or share the same key.

  - <link rel=\"preload\" href=\"bar\" ... />
  + <link rel=\"stylesheet\" href=\"bar\" precedence=\"default\" />`,
      ]);
    } else {
      expect(errors).toEqual([
        'Expected <link> not to update to be updated to a stylesheet with precedence. Check the `rel`, `href`, and `precedence` props of this component. Alternatively, check whether two different <link> components render in the same slot or share the same key.',
      ]);
    }
  });

  /** 同一 link 槽先渲染 precedence stylesheet，向查到的 preload 节点派发 load 后改为 rel=foo；根应报告资源不能变普通 link，验证资源记录与实例类别保持不变量。两轮加载查询实际都选择 preload。 */
  it('errors when a hoistable Resource becomes an instance', async () => {
    const errors = [];
    /** 收集 stylesheet 转普通 link 时根报告的错误消息，验证资源类别不能在同一 Fiber 槽更新改变。 */
    function onError(e) {
      errors.push(e.message);
    }
    const root = ReactDOMClient.createRoot(container, {
      onUncaughtError: onError,
    });

    root.render(
      <div>
        <link rel="stylesheet" href="bar" precedence="default" />
      </div>,
    );
    await waitForAll([]);
    const event = new window.Event('load');
    const preloads = document.querySelectorAll('link[rel="preload"]');
    for (let i = 0; i < preloads.length; i++) {
      const node = preloads[i];
      node.dispatchEvent(event);
    }
    const stylesheets = document.querySelectorAll('link[rel="preload"]');
    for (let i = 0; i < stylesheets.length; i++) {
      const node = stylesheets[i];
      node.dispatchEvent(event);
    }

    root.render(
      <div>
        <link rel="foo" href="bar" />
      </div>,
    );
    await waitForAll([]);
    if (__DEV__) {
      expect(errors).toEqual([
        `Expected stylesheet with precedence to not be updated to a different kind of <link>. Check the \`rel\`, \`href\`, and \`precedence\` props of this component. Alternatively, check whether two different <link> components render in the same slot or share the same key.

  - <link rel=\"stylesheet\" href=\"bar\" precedence=\"default\" />
  + <link rel=\"foo\" href=\"bar\" />`,
      ]);
    } else {
      expect(errors).toEqual([
        'Expected stylesheet with precedence to not be updated to a different kind of <link>. Check the `rel`, `href`, and `precedence` props of this component. Alternatively, check whether two different <link> components render in the same slot or share the same key.',
      ]);
    }
  });
});
