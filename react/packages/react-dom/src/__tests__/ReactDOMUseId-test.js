/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment ./scripts/jest/ReactDOMServerIntegrationEnvironment
 */
let JSDOM;
let React;
let ReactDOMClient;
let clientAct;
let ReactDOMFizzServer;
let Stream;
let Suspense;
let useId;
let useState;
let document;
let writable;
let container;
let buffer = '';
let hasErrored = false;
let fatalError = undefined;
let waitForPaint;
let SuspenseList;

describe('useId', () => {
  beforeEach(() => {
    jest.resetModules();
    JSDOM = require('jsdom').JSDOM;
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    clientAct = require('internal-test-utils').act;
    ReactDOMFizzServer = require('react-dom/server');
    Stream = require('stream');
    Suspense = React.Suspense;
    useId = React.useId;
    useState = React.useState;
    if (gate(flags => flags.enableSuspenseList)) {
      SuspenseList = React.unstable_SuspenseList;
    }

    const InternalTestUtils = require('internal-test-utils');
    waitForPaint = InternalTestUtils.waitForPaint;

    // 测试环境
    const jsdom = new JSDOM(
      '<!DOCTYPE html><html><head></head><body><div id="container">',
      {
        runScripts: 'dangerously',
      },
    );
    document = jsdom.window.document;
    container = document.getElementById('container');

    buffer = '';
    hasErrored = false;

    writable = new Stream.PassThrough();
    writable.setEncoding('utf8');
    writable.on('data', chunk => {
      buffer += chunk;
    });
    writable.on('error', error => {
      hasErrored = true;
      fatalError = error;
    });
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
    // 由于 JSDOM 不支持流解析器，我们需要给它一个适当的片段。 我们还想执行嵌入式的任何脚本. 我们假
    // 设现在已经接收到一个适当的片段的 HTML。
    const bufferedContent = buffer;
    buffer = '';
    const fakeBody = document.createElement('body');
    fakeBody.innerHTML = bufferedContent;
    while (fakeBody.firstChild) {
      const node = fakeBody.firstChild;
      if (node.nodeName === 'SCRIPT') {
        const script = document.createElement('script');
        script.textContent = node.textContent;
        fakeBody.removeChild(node);
        container.appendChild(script);
      } else {
        container.appendChild(node);
      }
    }
  }

  /** `normalizeTreeIdForTesting`：封装当前用例复用的操作、回调或断言步骤。 */
  function normalizeTreeIdForTesting(id) {
    const result = id.match(/_(R|r)_([a-z0-9]*)(H([0-9]*))?_/);
    if (result === undefined) {
      throw new Error('Invalid id format');
    }
    const [, serverClientPrefix, base32, hookIndex] = result;
    if (serverClientPrefix.endsWith('r')) {
  // 客户端 ID 不稳定；测试时去掉其中的计数器部分。
      return (
        'CLIENT_GENERATED_ID' +
        (hookIndex !== undefined ? ` (${hookIndex})` : '')
      );
    }
    // 格式化树 ID 为二进制序列。 这样更容易可视化结构。
    return (
      parseInt(base32, 32).toString(2) +
      (hookIndex !== undefined ? ` (${hookIndex})` : '')
    );
  }

  /** `DivWithId`：封装当前用例复用的操作、回调或断言步骤。 */
  function DivWithId({children}) {
    const id = normalizeTreeIdForTesting(useId());
    return <div id={id}>{children}</div>;
  }

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「basic example」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('basic example', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <div>
          <div>
            <DivWithId />
            <DivWithId />
          </div>
          <DivWithId />
        </div>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <div>
          <div>
            <div
              id="101"
            />
            <div
              id="1001"
            />
          </div>
          <div
            id="10"
          />
        </div>
      </div>
    `);
  });

  /** 测试场景：验证「indirections」描述的渲染、交互或错误处理结果。 */
  it('indirections', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      // 没有分支。 但是父组件和子组件应该有不同的 id。
      return (
        <DivWithId>
          <div>
            <div>
              <div>
                <DivWithId />
              </div>
            </div>
          </div>
        </DivWithId>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <div
          id="0"
        >
          <div>
            <div>
              <div>
                <div
                  id="1"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    `);
  });

  /** 测试场景：验证「StrictMode double rendering」描述的渲染、交互或错误处理结果。 */
  it('StrictMode double rendering', async () => {
    const {StrictMode} = React;

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <StrictMode>
          <DivWithId />
        </StrictMode>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <div
          id="0"
        />
      </div>
    `);
  });

  /** 测试场景：验证「empty (null) children」描述的渲染、交互或错误处理结果。 */
  it('empty (null) children', async () => {
    // 空子节点与非空子节点采用相同规则，因此生成 id 时也会占用一个槽位。
    // 这不是语义上的必需，只是 Fiber 会为列表中的 null 子节点分配 Fiber，性能上并不理想；
    // 对 id 生成而言，关键是 Fizz 与 Fiber 保持一致。
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <>
          {null}
          <DivWithId />
          {null}
          <DivWithId />
        </>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <div
          id="10"
        />
        <div
          id="100"
        />
      </div>
    `);
  });

  /** 测试场景：验证「large ids」描述的渲染、交互或错误处理结果。 */
  it('large ids', async () => {
    // 该组件会输出一棵带 id 的递归节点树；这些 id 的底层二进制位按 1、0 交替排列，形如 101010101。
    // 因为使用 base-32 编码，结果除 `R:` 前缀和其后的首字符外，应交替出现 `a`（01010）与
    // `l`（10101），例如 `_Rclalalalalalalala...`；首字符可能不足完整的 5 位。
    // 这个规律可用于验证超过 32 位位运算安全范围的大 id；算法理论上应支持任意长度的 id。

    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child({children}) {
      const id = useId();
      return <div id={id}>{children}</div>;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      let tree = <Child />;
      for (let i = 0; i < 50; i++) {
        tree = (
          <>
            <Child />
            {tree}
          </>
        );
      }
      return tree;
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
    const divs = container.querySelectorAll('div');

    // 确认每个ID符合预期模式
    for (let i = 0; i < divs.length; i++) {
      // 示例：_Rclalalalalalalala...:
      expect(divs[i].id).toMatch(/^_R_.(((al)*a?)((la)*l?))*_$/);
    }
  });

  /** 测试场景：验证「multiple ids in a single component」描述的渲染、交互或错误处理结果。 */
  it('multiple ids in a single component', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const id1 = useId();
      const id2 = useId();
      const id3 = useId();
      return `${id1}, ${id2}, ${id3}`;
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
    // 我们为 id 添加后缀以区分它们。
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        _R_0_, _R_0H1_, _R_0H2_
      </div>
    `);
  });

  /** 测试场景：验证「local render phase updates」描述的渲染、交互或错误处理结果。 */
  it('local render phase updates', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({swap}) {
      const [count, setCount] = useState(0);
      if (count < 3) {
        setCount(count + 1);
      }
      return useId();
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        _R_0_
      </div>
    `);
  });

  // @gate enableSuspenseList
  /** 测试场景：验证「Supports SuspenseList (reveal order independent)」描述的渲染、交互或错误处理结果。 */
  it('Supports SuspenseList (reveal order independent)', async () => {
    /** `Baz`：封装当前用例复用的操作、回调或断言步骤。 */
    function Baz({id, children}) {
      return <span id={id}>{children}</span>;
    }

    /** `Bar`：封装当前用例复用的操作、回调或断言步骤。 */
    function Bar({children}) {
      const id = useId();
      return <Baz id={id}>{children}</Baz>;
    }

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="independent">
          <Bar>A</Bar>
          <Bar>B</Bar>
        </SuspenseList>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<Foo />);
      pipe(writable);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <span
          id="_R_1_"
        >
          A
        </span>
        <span
          id="_R_2_"
        >
          B
        </span>
      </div>
    `);

    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <Foo />);
    });

    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <span
          id="_R_1_"
        >
          A
        </span>
        <span
          id="_R_2_"
        >
          B
        </span>
      </div>
    `);
  });

  // @gate enableSuspenseList
  /** 测试场景：验证「Supports SuspenseList (reveal order "together")」描述的渲染、交互或错误处理结果。 */
  it('Supports SuspenseList (reveal order "together")', async () => {
    /** `Baz`：封装当前用例复用的操作、回调或断言步骤。 */
    function Baz({id, children}) {
      return <span id={id}>{children}</span>;
    }

    /** `Bar`：封装当前用例复用的操作、回调或断言步骤。 */
    function Bar({children}) {
      const id = useId();
      return <Baz id={id}>{children}</Baz>;
    }

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="together">
          <Bar>A</Bar>
          <Bar>B</Bar>
        </SuspenseList>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<Foo />);
      pipe(writable);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <span
          id="_R_1_"
        >
          A
        </span>
        <span
          id="_R_2_"
        >
          B
        </span>
      </div>
    `);

    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <Foo />);
    });

    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <span
          id="_R_1_"
        >
          A
        </span>
        <span
          id="_R_2_"
        >
          B
        </span>
      </div>
    `);
  });

  // @gate enableSuspenseList
  /** 测试场景：验证「Supports SuspenseList (reveal order "forwards")」描述的渲染、交互或错误处理结果。 */
  it('Supports SuspenseList (reveal order "forwards")', async () => {
    /** `Baz`：封装当前用例复用的操作、回调或断言步骤。 */
    function Baz({id, children}) {
      return <span id={id}>{children}</span>;
    }

    /** `Bar`：封装当前用例复用的操作、回调或断言步骤。 */
    function Bar({children}) {
      const id = useId();
      return <Baz id={id}>{children}</Baz>;
    }

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="forwards" tail="visible">
          <Bar>A</Bar>
          <Bar>B</Bar>
        </SuspenseList>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<Foo />);
      pipe(writable);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <span
          id="_R_1_"
        >
          A
        </span>
        <span
          id="_R_2_"
        >
          B
        </span>
      </div>
    `);

    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <Foo />);
    });

    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <span
          id="_R_1_"
        >
          A
        </span>
        <span
          id="_R_2_"
        >
          B
        </span>
      </div>
    `);
  });

  // @gate enableSuspenseList
  /** 测试场景：验证「Supports SuspenseList (reveal order "backwards") with a single child in a list of many」描述的渲染、交互或错误处理结果。 */
  it('Supports SuspenseList (reveal order "backwards") with a single child in a list of many', async () => {
    /** `Baz`：封装当前用例复用的操作、回调或断言步骤。 */
    function Baz({id, children}) {
      return <span id={id}>{children}</span>;
    }

    /** `Bar`：封装当前用例复用的操作、回调或断言步骤。 */
    function Bar({children}) {
      const id = useId();
      return <Baz id={id}>{children}</Baz>;
    }

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="unstable_legacy-backwards" tail="visible">
          {null}
          <Bar>A</Bar>
          {null}
        </SuspenseList>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<Foo />);
      pipe(writable);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <span
          id="_R_2_"
        >
          A
        </span>
        <!-- -->
      </div>
    `);

    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <Foo />);
    });

    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <span
          id="_R_2_"
        >
          A
        </span>
        <!-- -->
      </div>
    `);
  });

  // @gate enableSuspenseList
  /** 测试场景：验证「Supports SuspenseList (reveal order "backwards")」描述的渲染、交互或错误处理结果。 */
  it('Supports SuspenseList (reveal order "backwards")', async () => {
    /** `Baz`：封装当前用例复用的操作、回调或断言步骤。 */
    function Baz({id, children}) {
      return <span id={id}>{children}</span>;
    }

    /** `Bar`：封装当前用例复用的操作、回调或断言步骤。 */
    function Bar({children}) {
      const id = useId();
      return <Baz id={id}>{children}</Baz>;
    }

    /** `Foo`：封装当前用例复用的操作、回调或断言步骤。 */
    function Foo() {
      return (
        <SuspenseList revealOrder="unstable_legacy-backwards" tail="visible">
          <Bar>A</Bar>
          <Bar>B</Bar>
        </SuspenseList>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<Foo />);
      pipe(writable);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <span
          id="_R_1_"
        >
          A
        </span>
        <span
          id="_R_2_"
        >
          B
        </span>
      </div>
    `);

    // TODO：这是 revealOrder="backwards" 的缺陷：它会以反向顺序执行 hydration。
    await expect(async () => {
      await clientAct(async () => {
        ReactDOMClient.hydrateRoot(container, <Foo />);
      });
    }).rejects.toThrowError(
      `Hydration failed because the server rendered text didn't match the client. As a result this tree will be regenerated on the client.`,
    );

    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <span
          id="_r_1_"
        >
          A
        </span>
        <span
          id="_r_0_"
        >
          B
        </span>
      </div>
    `);
  });

  /** 测试场景：验证「basic incremental hydration」描述的渲染、交互或错误处理结果。 */
  it('basic incremental hydration', async () => {
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      return (
        <div>
          <Suspense fallback="Loading...">
            <DivWithId label="A" />
            <DivWithId label="B" />
          </Suspense>
          <DivWithId label="C" />
        </div>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <div>
          <!--$-->
          <div
            id="101"
          />
          <div
            id="1001"
          />
          <!--/$-->
          <div
            id="10"
          />
        </div>
      </div>
    `);
  });

  /** 测试场景：验证「inserting/deleting siblings outside a dehydrated Suspense boundary」描述的渲染、交互或错误处理结果。 */
  it('inserting/deleting siblings outside a dehydrated Suspense boundary', async () => {
    const span = React.createRef(null);
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({swap}) {
      // 注意：使用动态数组，因此它们被视为插入和删除而不是更新。 因为 Fiber 目前为任何子节点分配了一
      // 个节点，即使子节点为空。
      const children = [
        <DivWithId key="A" />,
        swap ? <DivWithId key="C" /> : <DivWithId key="B" />,
        <DivWithId key="D" />,
      ];
      return (
        <>
          {children}
          <Suspense key="boundary" fallback="Loading...">
            <DivWithId />
            <span ref={span} />
          </Suspense>
        </>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    const dehydratedSpan = container.getElementsByTagName('span')[0];
    await clientAct(async () => {
      const root = ReactDOMClient.hydrateRoot(container, <App />);
      await waitForPaint([]);
      expect(container).toMatchInlineSnapshot(`
        <div
          id="container"
        >
          <div
            id="101"
          />
          <div
            id="1001"
          />
          <div
            id="1101"
          />
          <!--$-->
          <div
            id="110"
          />
          <span />
          <!--/$-->
        </div>
      `);

      // 内层边界尚未完成水合。
      expect(span.current).toBe(null);

      // 换B换C
      root.render(<App swap={true} />);
    });
    // 元素交换不应导致 hydration mismatch。
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <div
          id="101"
        />
        <div
          id="CLIENT_GENERATED_ID"
        />
        <div
          id="1101"
        />
        <!--$-->
        <div
          id="110"
        />
        <span />
        <!--/$-->
      </div>
    `);
    // 应该成功hydration
    expect(span.current).toBe(dehydratedSpan);
  });

  /** 测试场景：验证「inserting/deleting siblings inside a dehydrated Suspense boundary」描述的渲染、交互或错误处理结果。 */
  it('inserting/deleting siblings inside a dehydrated Suspense boundary', async () => {
    const span = React.createRef(null);
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({swap}) {
      // 注意：使用动态数组，因此它们被视为插入和删除而不是更新。 因为 Fiber 目前为任何子节点分配了一
      // 个节点，即使子节点为空。
      const children = [
        <DivWithId key="A" />,
        swap ? <DivWithId key="C" /> : <DivWithId key="B" />,
        <DivWithId key="D" />,
      ];
      return (
        <Suspense key="boundary" fallback="Loading...">
          {children}
          <span ref={span} />
        </Suspense>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    const dehydratedSpan = container.getElementsByTagName('span')[0];
    await clientAct(async () => {
      const root = ReactDOMClient.hydrateRoot(container, <App />);
      await waitForPaint([]);
      expect(container).toMatchInlineSnapshot(`
        <div
          id="container"
        >
          <!--$-->
          <div
            id="101"
          />
          <div
            id="1001"
          />
          <div
            id="1101"
          />
          <span />
          <!--/$-->
        </div>
      `);

      // 内层边界尚未完成水合。
      expect(span.current).toBe(null);

      // 换B换C
      root.render(<App swap={true} />);
    });
    // 元素交换不应导致 hydration mismatch。
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <!--$-->
        <div
          id="101"
        />
        <div
          id="CLIENT_GENERATED_ID"
        />
        <div
          id="1101"
        />
        <span />
        <!--/$-->
      </div>
    `);
    // 应该成功hydration
    expect(span.current).toBe(dehydratedSpan);
  });

  /** 测试场景：验证「identifierPrefix option」描述的渲染、交互或错误处理结果。 */
  it('identifierPrefix option', async () => {
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      const id = useId();
      return <div>{id}</div>;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({showMore}) {
      return (
        <>
          <Child />
          <Child />
          {showMore && <Child />}
        </>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />, {
        identifierPrefix: 'custom-prefix-',
      });
      pipe(writable);
    });
    let root;
    await clientAct(async () => {
      root = ReactDOMClient.hydrateRoot(container, <App />, {
        identifierPrefix: 'custom-prefix-',
      });
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <div>
          _custom-prefix-R_1_
        </div>
        <div>
          _custom-prefix-R_2_
        </div>
      </div>
    `);

    // 挂载一个新的，仅客户端使用的 ID
    await clientAct(async () => {
      root.render(<App showMore={true} />);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <div>
          _custom-prefix-R_1_
        </div>
        <div>
          _custom-prefix-R_2_
        </div>
        <div>
          _custom-prefix-r_0_
        </div>
      </div>
    `);
  });

  // https://github.com/vercel/next.js/issues/43033：Strict Mode 重渲染曾重置 localIdCounter，
  // 但 rerender Hook 不会再次递增它；问题只会影响后续 useId 的子级与 sibling 计数器，而非首个 ID。
  /** 测试场景：验证「does not forget it mounted an id when re-rendering in dev」描述的渲染、交互或错误处理结果。 */
  it('does not forget it mounted an id when re-rendering in dev', async () => {
    /** `Parent`：封装当前用例复用的操作、回调或断言步骤。 */
    function Parent() {
      const id = useId();
      return (
        <div>
          {id} <Child />
        </div>
      );
    }
    /** `Child`：封装当前用例复用的操作、回调或断言步骤。 */
    function Child() {
      const id = useId();
      return <div>{id}</div>;
    }

    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App({showMore}) {
      return (
        <React.StrictMode>
          <Parent />
        </React.StrictMode>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <div>
          _R_0_
          <!-- -->
           
          <div>
            _R_7_
          </div>
        </div>
      </div>
    `);

    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
    expect(container).toMatchInlineSnapshot(`
      <div
        id="container"
      >
        <div>
          _R_0_
          <!-- -->
           
          <div>
            _R_7_
          </div>
        </div>
      </div>
    `);
  });
});
