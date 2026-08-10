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

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「errors when a hoistable component becomes a Resource」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 DOM host 属性写入与提交路径。
   */
  it('errors when a hoistable component becomes a Resource', async () => {
    const errors = [];
    /** `onError`：封装当前用例复用的操作、回调或断言步骤。 */
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

  /** 测试场景：验证「errors when a hoistable Resource becomes an instance」描述的渲染、交互或错误处理结果。 */
  it('errors when a hoistable Resource becomes an instance', async () => {
    const errors = [];
    /** `onError`：封装当前用例复用的操作、回调或断言步骤。 */
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
