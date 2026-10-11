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
    global.requestAnimationFrame =
      /** 以定时器提供 Fizz runtime 所需 rAF，允许 serverAct 推进揭示指令。 */
      global.window.requestAnimationFrame = cb =>
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

  /** 等待一次服务器工作轮次，重抛流错误，将当前缓冲作为完整片段插入并执行脚本，再推进 reveal 定时器；不逐字节解析。 */
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

  /** 记录文本 render，并返回 span，区别组件执行日志与实际可见节点。 */
  function Text(props) {
    Scheduler.log(props.text);
    return <span>{props.text}</span>;
  }

  /** 创建带手动 resolve/reject 方法的异步组件；两种方法均解决同一 ping promise，组件下一次 render 再按 resolved/error 决定输出或抛错。 */
  function createAsyncText(text) {
    let resolved = false;
    let error = undefined;

    /** 优先抛已保存 error，其次挂起未完成 promise，完成后返回带日志的 Text。 */
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
      /** 先标记 resolved 再解决 promise，使被唤醒 render 能输出原 text。 */
      Component.resolve = function () {
        resolved = true;
        return resolve();
      };
      /** 保存错误后解决 ping promise；并非 reject 原 Promise，而是让下一次组件 render 抛该错误。 */
      Component.reject = function (e) {
        error = e;
        return resolve();
      };
    });
    return Component;
  }

  // @gate enableSuspenseList

  /** 默认列表 A/B pending、C预先完成；先显示三 fallback，解决 A只揭示 A，解决 B再揭示 B/C，验证默认前向门槛而非按完成时间独立展示。 */
  it('shows content forwards by default', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** 构造无 revealOrder 的 A/B/C 列表，覆盖默认前向门槛。 */
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

  /** independent 列表先完成 A，随后先解决 C再 B；各项独立揭示，验证无前项阻塞。 */
  it('independently with revealOrder="independent"', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** 构造 independent 列表，允许 C 在 pending B之后先揭示。 */
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

  /** together 列表先完成 A，解决 B仍保持三个 fallback，最后 C完成才一起显示 A/B/C，验证全列表门槛。 */
  it('displays all "together"', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** 构造 together 三边界，观察全部完成前的整体遮挡。 */
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

  /** 三个同步 Text 放在 together 列表；日志仍执行三个 fallback 准备，但原始首批 HTML 只含完成 A/B/C，验证执行 fallback 不等于输出它。 */
  it('displays all "together" in a single pass', async () => {

    /** 同步三项也放 together 列表，观察 fallback 准备与首批输出区别。 */
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

  /** together 的三个边界分别嵌在两 div 兄弟子树，A先完成、B后完成仍全 fallback，C完成才全揭示，验证门槛穿透主机嵌套。 */
  it('displays all "together" even when nested as siblings', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** 把三个边界嵌在两兄弟 div 内，验证 together 搜集嵌套任务。 */
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

  /** 外 together 含 A和内 together 的 B/C，A/B预先完成但 C pending；全 fallback直至 C完成，验证内列表任务参与外列表门槛。 */
  it('displays all "together" in nested SuspenseLists', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** 外 together 嵌内 together，测试内列表参与外门槛。 */
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

  /** 外 together 包含内 independent 的 B/C，A/B已完成仍被外层门槛遮住；C完成后全部揭示，验证内 independent 不绕过外 together。 */
  it('displays all "together" in nested SuspenseLists where the inner is "independent"', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** 外 together 嵌内 independent，测试内独立揭示受外列表约束。 */
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

  /** 显式 forwards/visible，C先完成而 A/B pending；依次解决 A、B只允许连续前缀揭示，覆盖可见 tail fallback。 */
  it('displays each items in "forwards" order', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** 显式 forwards/visible 的 A/B/C 列表。 */
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

  /** backwards 列表按 C/B/A 输入且 A先完成，DOM 顺序为 A/B/C；先解决 C只显示末端 C，B完成才全部显示，验证逆向挂载次序与完成门槛。 */
  it('displays each items in "backwards" mount order', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** backwards 按 C/B/A 输入，让挂载输出反转为 A/B/C并从末端揭示。 */
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

  /** legacy-backwards 输入 A/B/C，A先完成但反向准备 C/B/A；C先解决只揭示 C，B后完成才全显示，验证旧模式保留原 DOM 次序而反向门槛。 */
  it('displays each items in "backwards" order in legacy mode', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** legacy-backwards 保留 A/B/C 输入次序，但倒序准备和揭示。 */
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

  /** 外 forwards 先放内 backwards B/A，再放已完成 C；A完成仍不揭示，B完成才整个内组与外 C一起显示，验证内列表作为外前项的完整门槛。 */
  it('waits for a nested SuspenseList to complete before resolving "forwards"', async () => {
    const A = createAsyncText('A');
    const B = createAsyncText('B');
    const C = createAsyncText('C');

    /** 外 forwards 的首项为内 backwards 列表，后项 C必须等内组完整解除门槛。 */
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

  /** forwards 中 A pending、B同步完成，先显示两 fallback；无原因 abort 后 writable finish 且报告一次默认取消，验证列表未解决任务可取消并关闭流。 */
  it('can abort a pending SuspenseList', async () => {
    const A = createAsyncText('A');

    /** forwards 列表首项异步 A、第二项同步 B，供 abort 解除未完成任务。 */
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

        /** 记录列表取消时的 onError 消息。 */
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

  /** 同样 A pending/B完成，A.reject(hi) 将任务转错误；Loading A 保留而 B可揭示，onError 收 hi且流正常 finish，验证错误解除列表门槛而不致命关闭。 */
  it('can error a pending SuspenseList', async () => {
    const A = createAsyncText('A');

    /** forwards 中 A可转错误、B同步完成，供错误解除列表门槛。 */
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

        /** 记录 A重试抛出的错误消息，流本身仍可完成。 */
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
