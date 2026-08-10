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
import {
  insertNodesAndExecuteScripts,
  getVisibleChildren,
} from '../test-utils/FizzTestUtils';

let JSDOM;
let React;
let Suspense;
let SuspenseList;
let assertLog;
let Scheduler;
let ReactDOMFizzServer;
let Stream;
let document;
let writable;
let container;
let buffer = '';
let hasErrored = false;
let hasCompleted = false;
let fatalError = undefined;

describe('ReactDOMFizzSuspenseList', () => {
  beforeEach(() => {
    jest.resetModules();
    JSDOM = require('jsdom').JSDOM;
    React = require('react');
    assertLog = require('internal-test-utils').assertLog;
    ReactDOMFizzServer = require('react-dom/server');
    Stream = require('stream');

    Suspense = React.Suspense;
    SuspenseList = React.unstable_SuspenseList;

    Scheduler = require('scheduler');

    // 测试环境
    const jsdom = new JSDOM(
      '<!DOCTYPE html><html><head></head><body><div id="container">',
      {
        runScripts: 'dangerously',
      },
    );
    document = jsdom.window.document;
    container = document.getElementById('container');
    global.window = jsdom.window;
    // Fizz runtime 假定 requestAnimationFrame 存在，因此这里需要提供 polyfill。
    global.requestAnimationFrame = global.window.requestAnimationFrame = cb =>
      setTimeout(cb);

    buffer = '';
    hasErrored = false;
    hasCompleted = false;

    writable = new Stream.PassThrough();
    writable.setEncoding('utf8');
    writable.on('data', chunk => {
      buffer += chunk;
    });
    writable.on('error', error => {
      hasErrored = true;
      fatalError = error;
    });
    writable.on('finish', () => {
      hasCompleted = true;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** `serverAct`：封装当前用例复用的操作、回调或断言步骤。 */
  async function serverAct(callback) {
    await callback();
    // 等待一次事件循环的轮询。 这假设我们已经将所有东西都冲刷了。
    await new Promise(resolve => {
      setImmediate(resolve);
    });
    if (hasErrored) {
      throw fatalError;
    }
    // JSDOM 不支持流式 HTML 解析器，因此必须交给它完整片段；同时还要执行其中嵌入的脚本。到这里可假
    // 定已收到一个完整可解析的 HTML 片段。
    const bufferedContent = buffer;
    buffer = '';
    const temp = document.createElement('body');
    temp.innerHTML = bufferedContent;
    await insertNodesAndExecuteScripts(temp, container, null);
    jest.runAllTimers();
  }

  /** `Text`：封装当前用例复用的操作、回调或断言步骤。 */
  function Text(props) {
    Scheduler.log(props.text);
    return <span>{props.text}</span>;
  }

  /** `createAsyncText`：封装当前用例复用的操作、回调或断言步骤。 */
  function createAsyncText(text) {
    let resolved = false;
    let error = undefined;
    /** `createAsyncText.Component`：封装当前用例复用的操作、回调或断言步骤。 */
    const Component = function () {
      if (error !== undefined) {
        Scheduler.log('Error! [' + error.message + ']');
        throw error;
      }
      if (!resolved) {
        Scheduler.log('Suspend! [' + text + ']');
        throw promise;
      }
      return <Text text={text} />;
    };
    const promise = new Promise(resolve => {
      Component.resolve = function () {
        resolved = true;
        return resolve();
      };
      Component.reject = function (e) {
        error = e;
        return resolve();
      };
    });
    return Component;
  }

  // @gate enableSuspenseList
  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「shows content forwards by default」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言覆盖 react-dom 的服务端流适配层；完整 Fizz 状态机位于 react-server。
   */
  it('shows content forwards by default', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      return (
        <div>
          <SuspenseList>
            <Suspense fallback={<Text text="Loading A" />}>
              <A />
            </Suspense>
            <Suspense fallback={<Text text="Loading B" />}>
              <B />
            </Suspense>
            <Suspense fallback={<Text text="Loading C" />}>
              <C />
            </Suspense>
          </SuspenseList>
        </div>
      );
    }

    await C.resolve();

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<Foo />);
      pipe(writable);
    });

    assertLog([
      'Suspend! [A]',
      'Suspend! [B]', // TODO：若前一项已挂起，则在 fallback 之后延迟渲染内容。
      'C',
      'Loading A',
      'Loading B',
      'Loading C',
    ]);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Loading A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </div>,
    );

    await serverAct(() => A.resolve());
    assertLog(['A']);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </div>,
    );

    await serverAct(() => B.resolve());
    assertLog(['B']);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </div>,
    );
  });

  // @gate enableSuspenseList
  /** 测试场景：验证「independently with revealOrder="independent"」描述的渲染、交互或错误处理结果。 */
  it('independently with revealOrder="independent"', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      return (
        <div>
          <SuspenseList revealOrder="independent">
            <Suspense fallback={<Text text="Loading A" />}>
              <A />
            </Suspense>
            <Suspense fallback={<Text text="Loading B" />}>
              <B />
            </Suspense>
            <Suspense fallback={<Text text="Loading C" />}>
              <C />
            </Suspense>
          </SuspenseList>
        </div>
      );
    }

    await A.resolve();

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<Foo />);
      pipe(writable);
    });

    assertLog(['A', 'Suspend! [B]', 'Suspend! [C]', 'Loading B', 'Loading C']);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </div>,
    );

    await serverAct(() => C.resolve());
    assertLog(['C']);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>A</span>
        <span>Loading B</span>
        <span>C</span>
      </div>,
    );

    await serverAct(() => B.resolve());
    assertLog(['B']);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </div>,
    );
  });

  // @gate enableSuspenseList
  /** 测试场景：验证「displays all "together"」描述的渲染、交互或错误处理结果。 */
  it('displays all "together"', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      return (
        <div>
          <SuspenseList revealOrder="together">
            <Suspense fallback={<Text text="Loading A" />}>
              <A />
            </Suspense>
            <Suspense fallback={<Text text="Loading B" />}>
              <B />
            </Suspense>
            <Suspense fallback={<Text text="Loading C" />}>
              <C />
            </Suspense>
          </SuspenseList>
        </div>
      );
    }

    await A.resolve();

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<Foo />);
      pipe(writable);
    });

    assertLog([
      'A',
      'Suspend! [B]',
      'Suspend! [C]',
      'Loading A',
      'Loading B',
      'Loading C',
    ]);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Loading A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </div>,
    );

    await serverAct(() => B.resolve());
    assertLog(['B']);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Loading A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </div>,
    );

    await serverAct(() => C.resolve());
    assertLog(['C']);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </div>,
    );
  });

  // @gate enableSuspenseList
  /** 测试场景：验证「displays all "together" in a single pass」描述的渲染、交互或错误处理结果。 */
  it('displays all "together" in a single pass', async () => {
    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      return (
        <div>
          <SuspenseList revealOrder="together">
            <Suspense fallback={<Text text="Loading A" />}>
              <Text text="A" />
            </Suspense>
            <Suspense fallback={<Text text="Loading B" />}>
              <Text text="B" />
            </Suspense>
            <Suspense fallback={<Text text="Loading C" />}>
              <Text text="C" />
            </Suspense>
          </SuspenseList>
        </div>
      );
    }

    const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<Foo />);
    pipe(writable);
    await 0;
    const bufferedContent = buffer;
    buffer = '';

    assertLog(['A', 'B', 'C', 'Loading A', 'Loading B', 'Loading C']);

    expect(bufferedContent).toMatchInlineSnapshot(
      `"<div><!--$--><span>A</span><!--/$--><!--$--><span>B</span><!--/$--><!--$--><span>C</span><!--/$--></div>"`,
    );
  });

  // @gate enableSuspenseList
  /** 测试场景：验证「displays all "together" even when nested as siblings」描述的渲染、交互或错误处理结果。 */
  it('displays all "together" even when nested as siblings', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      return (
        <div>
          <SuspenseList revealOrder="together">
            <div>
              <Suspense fallback={<Text text="Loading A" />}>
                <A />
              </Suspense>
              <Suspense fallback={<Text text="Loading B" />}>
                <B />
              </Suspense>
            </div>
            <div>
              <Suspense fallback={<Text text="Loading C" />}>
                <C />
              </Suspense>
            </div>
          </SuspenseList>
        </div>
      );
    }

    await A.resolve();

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<Foo />);
      pipe(writable);
    });

    assertLog([
      'A',
      'Suspend! [B]',
      'Suspend! [C]',
      'Loading A',
      'Loading B',
      'Loading C',
    ]);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div>
          <span>Loading A</span>
          <span>Loading B</span>
        </div>
        <div>
          <span>Loading C</span>
        </div>
      </div>,
    );

    await serverAct(() => B.resolve());
    assertLog(['B']);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div>
          <span>Loading A</span>
          <span>Loading B</span>
        </div>
        <div>
          <span>Loading C</span>
        </div>
      </div>,
    );

    await serverAct(() => C.resolve());
    assertLog(['C']);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <div>
          <span>A</span>
          <span>B</span>
        </div>
        <div>
          <span>C</span>
        </div>
      </div>,
    );
  });

  // @gate enableSuspenseList
  /** 测试场景：验证「displays all "together" in nested SuspenseLists」描述的渲染、交互或错误处理结果。 */
  it('displays all "together" in nested SuspenseLists', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      return (
        <div>
          <SuspenseList revealOrder="together">
            <Suspense fallback={<Text text="Loading A" />}>
              <A />
            </Suspense>
            <SuspenseList revealOrder="together">
              <Suspense fallback={<Text text="Loading B" />}>
                <B />
              </Suspense>
              <Suspense fallback={<Text text="Loading C" />}>
                <C />
              </Suspense>
            </SuspenseList>
          </SuspenseList>
        </div>
      );
    }

    await A.resolve();
    await B.resolve();

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<Foo />);
      pipe(writable);
    });

    assertLog([
      'A',
      'B',
      'Suspend! [C]',
      'Loading A',
      'Loading B',
      'Loading C',
    ]);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Loading A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </div>,
    );

    await serverAct(() => C.resolve());
    assertLog(['C']);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </div>,
    );
  });

  // @gate enableSuspenseList
  /** 测试场景：验证「displays all "together" in nested SuspenseLists where the inner is "independent"」描述的渲染、交互或错误处理结果。 */
  it('displays all "together" in nested SuspenseLists where the inner is "independent"', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      return (
        <div>
          <SuspenseList revealOrder="together">
            <Suspense fallback={<Text text="Loading A" />}>
              <A />
            </Suspense>
            <SuspenseList revealOrder="independent">
              <Suspense fallback={<Text text="Loading B" />}>
                <B />
              </Suspense>
              <Suspense fallback={<Text text="Loading C" />}>
                <C />
              </Suspense>
            </SuspenseList>
          </SuspenseList>
        </div>
      );
    }

    await A.resolve();
    await B.resolve();

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<Foo />);
      pipe(writable);
    });

    assertLog([
      'A',
      'B',
      'Suspend! [C]',
      'Loading A',
      'Loading B',
      'Loading C',
    ]);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Loading A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </div>,
    );

    await serverAct(() => C.resolve());
    assertLog(['C']);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </div>,
    );
  });

  // @gate enableSuspenseList
  /** 测试场景：验证「displays each items in "forwards" order」描述的渲染、交互或错误处理结果。 */
  it('displays each items in "forwards" order', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      return (
        <div>
          <SuspenseList revealOrder="forwards" tail="visible">
            <Suspense fallback={<Text text="Loading A" />}>
              <A />
            </Suspense>
            <Suspense fallback={<Text text="Loading B" />}>
              <B />
            </Suspense>
            <Suspense fallback={<Text text="Loading C" />}>
              <C />
            </Suspense>
          </SuspenseList>
        </div>
      );
    }

    await C.resolve();

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<Foo />);
      pipe(writable);
    });

    assertLog([
      'Suspend! [A]',
      'Suspend! [B]', // TODO：若前一项已挂起，则在 fallback 之后延迟渲染内容。
      'C',
      'Loading A',
      'Loading B',
      'Loading C',
    ]);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Loading A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </div>,
    );

    await serverAct(() => A.resolve());
    assertLog(['A']);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </div>,
    );

    await serverAct(() => B.resolve());
    assertLog(['B']);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </div>,
    );
  });

  // @gate enableSuspenseList
  /** 测试场景：验证「displays each items in "backwards" mount order」描述的渲染、交互或错误处理结果。 */
  it('displays each items in "backwards" mount order', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      return (
        <div>
          <SuspenseList revealOrder="backwards" tail="visible">
            <Suspense fallback={<Text text="Loading C" />}>
              <C />
            </Suspense>
            <Suspense fallback={<Text text="Loading B" />}>
              <B />
            </Suspense>
            <Suspense fallback={<Text text="Loading A" />}>
              <A />
            </Suspense>
          </SuspenseList>
        </div>
      );
    }

    await A.resolve();

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<Foo />);
      pipe(writable);
    });

    assertLog([
      'Suspend! [C]',
      'Suspend! [B]', // TODO：若前一项已挂起，则在 fallback 之后延迟渲染内容。
      'A',
      'Loading C',
      'Loading B',
      'Loading A',
    ]);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Loading A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </div>,
    );

    await serverAct(() => C.resolve());
    assertLog(['C']);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Loading A</span>
        <span>Loading B</span>
        <span>C</span>
      </div>,
    );

    await serverAct(() => B.resolve());
    assertLog(['B']);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </div>,
    );
  });

  // @gate enableSuspenseList
  /** 测试场景：验证「displays each items in "backwards" order in legacy mode」描述的渲染、交互或错误处理结果。 */
  it('displays each items in "backwards" order in legacy mode', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      return (
        <div>
          <SuspenseList revealOrder="unstable_legacy-backwards" tail="visible">
            <Suspense fallback={<Text text="Loading A" />}>
              <A />
            </Suspense>
            <Suspense fallback={<Text text="Loading B" />}>
              <B />
            </Suspense>
            <Suspense fallback={<Text text="Loading C" />}>
              <C />
            </Suspense>
          </SuspenseList>
        </div>
      );
    }

    await A.resolve();

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<Foo />);
      pipe(writable);
    });

    assertLog([
      'Suspend! [C]',
      'Suspend! [B]', // TODO：若前一项已挂起，则在 fallback 之后延迟渲染内容。
      'A',
      'Loading C',
      'Loading B',
      'Loading A',
    ]);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Loading A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </div>,
    );

    await serverAct(() => C.resolve());
    assertLog(['C']);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Loading A</span>
        <span>Loading B</span>
        <span>C</span>
      </div>,
    );

    await serverAct(() => B.resolve());
    assertLog(['B']);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </div>,
    );
  });

  // @gate enableSuspenseList
  /** 测试场景：验证「waits for a nested SuspenseList to complete before resolving "forwards"」描述的渲染、交互或错误处理结果。 */
  it('waits for a nested SuspenseList to complete before resolving "forwards"', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      return (
        <div>
          <SuspenseList revealOrder="forwards" tail="visible">
            <SuspenseList revealOrder="backwards" tail="visible">
              <Suspense fallback={<Text text="Loading B" />}>
                <B />
              </Suspense>
              <Suspense fallback={<Text text="Loading A" />}>
                <A />
              </Suspense>
            </SuspenseList>
            <Suspense fallback={<Text text="Loading C" />}>
              <C />
            </Suspense>
          </SuspenseList>
        </div>
      );
    }

    await C.resolve();

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<Foo />);
      pipe(writable);
    });

    assertLog([
      'Suspend! [B]',
      'Suspend! [A]',
      'C',
      'Loading B',
      'Loading A',
      'Loading C',
    ]);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Loading A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </div>,
    );

    await serverAct(() => A.resolve());
    assertLog(['A']);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Loading A</span>
        <span>Loading B</span>
        <span>Loading C</span>
      </div>,
    );

    await serverAct(() => B.resolve());
    assertLog(['B']);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </div>,
    );
  });

  // @gate enableSuspenseList
  /** 测试场景：验证「can abort a pending SuspenseList」描述的渲染、交互或错误处理结果。 */
  it('can abort a pending SuspenseList', async () => {
    const A = createAsyncText('A');

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      return (
        <div>
          <SuspenseList revealOrder="forwards" tail="visible">
            <Suspense fallback={<Text text="Loading A" />}>
              <A />
            </Suspense>
            <Suspense fallback={<Text text="Loading B" />}>
              <Text text="B" />
            </Suspense>
          </SuspenseList>
        </div>
      );
    }

    const errors = [];
    let abortStream;
    await serverAct(async () => {
      const {pipe, abort} = ReactDOMFizzServer.renderToPipeableStream(<Foo />, {
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onError(error) {
          errors.push(error.message);
        },
      });
      pipe(writable);
      abortStream = abort;
    });

    assertLog([
      'Suspend! [A]',
      'B', // TODO：若前一项已挂起，则在 fallback 之后延迟渲染内容。
      'Loading A',
      'Loading B',
    ]);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Loading A</span>
        <span>Loading B</span>
      </div>,
    );

    await serverAct(() => {
      abortStream();
    });

    expect(hasCompleted).toBe(true);
    expect(errors).toEqual([
      'The render was aborted by the server without a reason.',
    ]);
  });

  // @gate enableSuspenseList
  /** 测试场景：验证「can error a pending SuspenseList」描述的渲染、交互或错误处理结果。 */
  it('can error a pending SuspenseList', async () => {
    const A = createAsyncText('A');

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      return (
        <div>
          <SuspenseList revealOrder="forwards" tail="visible">
            <Suspense fallback={<Text text="Loading A" />}>
              <A />
            </Suspense>
            <Suspense fallback={<Text text="Loading B" />}>
              <Text text="B" />
            </Suspense>
          </SuspenseList>
        </div>
      );
    }

    const errors = [];
    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<Foo />, {
        /** `onError`：实现测试夹具的生命周期、渲染或交互步骤。 */
        onError(error) {
          errors.push(error.message);
        },
      });
      pipe(writable);
    });

    assertLog([
      'Suspend! [A]',
      'B', // TODO：若前一项已挂起，则在 fallback 之后延迟渲染内容。
      'Loading A',
      'Loading B',
    ]);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Loading A</span>
        <span>Loading B</span>
      </div>,
    );

    await serverAct(async () => {
      A.reject(new Error('hi'));
    });

    assertLog(['Error! [hi]']);

    expect(getVisibleChildren(container)).toEqual(
      <div>
        <span>Loading A</span>
        <span>B</span>
      </div>,
    );

    expect(errors).toEqual(['hi']);
    expect(hasErrored).toBe(false);
    expect(hasCompleted).toBe(true);
  });
});
