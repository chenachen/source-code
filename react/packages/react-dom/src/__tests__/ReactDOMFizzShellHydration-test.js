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
let startTransition;
let ReactDOMClient;
let Scheduler;
let clientAct;
let ReactDOMFizzServer;
let Stream;
let document;
let writable;
let container;
let buffer = '';
let hasErrored = false;
let fatalError = undefined;
let textCache;
let assertLog;

describe('ReactDOMFizzShellHydration', () => {
  beforeEach(() => {
    jest.resetModules();
    JSDOM = require('jsdom').JSDOM;
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    Scheduler = require('scheduler');
    clientAct = require('internal-test-utils').act;
    ReactDOMFizzServer = require('react-dom/server');
    Stream = require('stream');

    const InternalTestUtils = require('internal-test-utils');
    assertLog = InternalTestUtils.assertLog;

    startTransition = React.startTransition;

    textCache = new Map();

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

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** 执行服务器操作并等待一次 setImmediate，重抛 PassThrough 错误；把当前缓冲作为完整 HTML 片段插入，重建顶层 script 仅复制文本，不模拟浏览器逐字节解析。 */
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

  /** 在 act 中对当前容器启动水合，把 caught/uncaught/recoverable 三类回调同时写日志与带类别的 errors，返回后供 Hook 回归检查。 */
  async function hydrateRootAndCollectErrors(reactNode) {
    const errors = [];
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, reactNode, {
        /** 记录错误边界已捕获的客户端错误。 */
        onCaughtError(error) {
          Scheduler.log('onCaughtError: ' + error.message);
          errors.push('caught: ' + error.message);
        },
        /** 记录没有边界接住的根错误。 */
        onUncaughtError(error) {
          Scheduler.log('onUncaughtError: ' + error.message);
          errors.push('uncaught: ' + error.message);
        },
        /** 记录通过改客户端渲染恢复的水合错误。 */
        onRecoverableError(error) {
          Scheduler.log('onRecoverableError: ' + error.message);
          errors.push('recoverable: ' + error.message);
        },
      });
    });
    return errors;
  }

  /** 创建可重复使用的 Bomb 与客户端错误边界，供水合期间 Hook 状态恢复回归。 */
  function createErrorBoundaryAndBomb() {
    /** 保存 Bomb 错误并输出错误文本的类边界；SSR 不执行该捕获协议。 */
    class ErrorBoundary extends React.Component {
      /** 调用父构造器并初始化尚未捕获错误状态。 */
      constructor(props) {
        super(props);
        this.state = {error: null};
      }

      /** 把捕获错误存入 state，供下一轮 render 选择错误输出。 */
      static getDerivedStateFromError(error) {
        return {error};
      }

      /** 提供空 didCatch 以参与边界捕获协议；报告由 hydrateRoot 回调记录。 */
      componentDidCatch() {}

      /** 有错误输出其 message，否则返回 children。 */
      render() {
        if (this.state.error) {
          return 'Something went wrong: ' + this.state.error.message;
        }

        return this.props.children;
      }
    }

    /** 每次 render 抛 boom，制造服务端边界降级与客户端 caught 错误。 */
    function Bomb() {
      throw new Error('boom');
    }

    return {ErrorBoundary, Bomb};
  }

  /** 未读文本可直接设 resolved；已有 pending 先更改记录状态和值，再同步调用所有 pings，保证重试读到完成值。 */
  function resolveText(text) {
    const record = textCache.get(text);
    if (record === undefined) {
      const newRecord = {
        status: 'resolved',
        value: text,
      };
      textCache.set(text, newRecord);
    } else if (record.status === 'pending') {
      const thenable = record.value;
      record.status = 'resolved';
      record.value = text;
      thenable.pings.forEach(t => t());
    }
  }

  /** 按文本 Map 读取 resolved 值或抛 pending/rejected；首次缺失创建可手动 ping 的 thenable 并抛出，日志只在首次建 pending 时记录。 */
  function readText(text) {
    const record = textCache.get(text);
    if (record !== undefined) {
      switch (record.status) {
        case 'pending':
          throw record.value;
        case 'rejected':
          throw record.value;
        case 'resolved':
          return record.value;
      }
    } else {
      Scheduler.log(`Suspend! [${text}]`);

      const thenable = {
        pings: [],
        /** pending 时登记唤醒回调，若已解决则微任务回调完成值；不是负责取值的原生 Promise。 */
        then(resolve) {
          if (newRecord.status === 'pending') {
            thenable.pings.push(resolve);
          } else {
            Promise.resolve().then(() => resolve(newRecord.value));
          }
        },
      };

      const newRecord = {
        status: 'pending',
        value: thenable,
      };
      textCache.set(text, newRecord);

      throw thenable;
    }
  }

  /** 记录并返回同步文本，观察根更新执行顺序。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /** 先读可挂起缓存再记录文本；pending 时不会产生成功文本日志。 */
  function AsyncText({text}) {
    readText(text);
    Scheduler.log(text);
    return text;
  }

  /** 替换整张 Map，使客户端不共享服务端已解决缓存。 */
  function resetTextCache() {
    textCache = new Map();
  }

  /** SSR 已解决 Shell 后清空客户端缓存，hydrateRoot 无 Suspense 的 shell 挂起；DOM 仍为 Shell、ref 为空，解决后 ref 指向原 div，验证根挂起保留服务端节点。 */
  it('suspending in the shell during hydration', async () => {
    const div = React.createRef(null);

    /** 带 div ref 的无边界 shell，观察 pending 水合何时赋主机 ref。 */
    function App() {
      return (
        <div ref={div}>
          <AsyncText text="Shell" />
        </div>
      );
    }

    // 服务器端渲染
    await resolveText('Shell');
    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    assertLog(['Shell']);
    const dehydratedDiv = container.getElementsByTagName('div')[0];

    // 清除缓存并开始在客户端渲染
    resetTextCache();

    // shell 的数据尚未加载，因此 hydration 会挂起
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />);
    });
    assertLog(['Suspend! [Shell]']);
    expect(div.current).toBe(null);
    expect(container.textContent).toBe('Shell');

    // shell 加载完成，hydration 随之结束
    await clientAct(async () => {
      await resolveText('Shell');
    });
    assertLog(['Shell']);
    expect(div.current).toBe(dehydratedDiv);
    expect(container.textContent).toBe('Shell');
  });

  /** 空 createRoot 渲染未解决 Shell，无边界时先挂起；解决缓存后显示 Shell，覆盖普通客户端根重试。 */
  it('suspending in the shell during a normal client render', async () => {
    // 与前一个测试相同，但发生在不含 hydration 的常规客户端渲染期间。
    /** 无边界异步文本作为普通客户端根输出，覆盖根挂起重试。 */
    function App() {
      return <AsyncText text="Shell" />;
    }

    const root = ReactDOMClient.createRoot(container);
    await clientAct(async () => {
      root.render(<App />);
    });
    assertLog(['Suspend! [Shell]']);

    await clientAct(async () => {
      await resolveText('Shell');
    });
    assertLog(['Shell']);
    expect(container.textContent).toBe('Shell');
  });

  /** 先 SSR Initial，再启动水合并在 transition 更新为 Updated；日志先 Initial 后 Updated，验证低优先级更新允许初始水合先完成。 */
  it(
    'updating the root at lower priority than initial hydration does not ' +
      'force a client render',
    async () => {
      /** 返回 Initial 日志文本，用于与低优先级根更新排序。 */
      function App() {
        return <Text text="Initial" />;
      }

      // 服务器端渲染
      await resolveText('Initial');
      await serverAct(async () => {
        const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
        pipe(writable);
      });
      assertLog(['Initial']);

      await clientAct(async () => {
        const root = ReactDOMClient.hydrateRoot(container, <App />);
        // transition 更新排在初始水合后处理，下面日志验证 Initial 先于 Updated。
        startTransition(() => {
          root.render(<Text text="Updated" />);
        });
      });
      assertLog(['Initial', 'Updated']);
      expect(container.textContent).toBe('Updated');
    },
  );

  /** 分别在 transition 中启动 hydrateRoot 与 root.render Updated；日志仍先 Initial 后 Updated，覆盖该调度上下文下的初始水合优先顺序。 */
  it(
    'updating the root at same priority as initial hydration does not ' +
      'force a client render',
    async () => {
      /** 返回 Initial 文本，用于 transition 内启动水合的优先顺序。 */
      function App() {
        return <Text text="Initial" />;
      }

      // 服务器端渲染
      await resolveText('Initial');
      await serverAct(async () => {
        const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
        pipe(writable);
      });
      assertLog(['Initial']);

      await clientAct(async () => {
        let root;
        startTransition(() => {
          root = ReactDOMClient.hydrateRoot(container, <App />);
        });
        // transition 更新排在初始水合后处理，下面日志验证 Initial 先于 Updated。
        startTransition(() => {
          root.render(<Text text="Updated" />);
        });
      });
      assertLog(['Initial', 'Updated']);
      expect(container.textContent).toBe('Updated');
    },
  );

  /** SSR Shell 后客户端缓存 pending，使 shell 水合挂起；普通 root.render New screen 触发 early update recoverable 错误并整根客户端渲染，验证早更新放弃水合。 */
  it('updating the root while the shell is suspended forces a client render', async () => {
    /** 返回 Shell 异步文本，使初始水合根 pending，再被早更新替换。 */
    function App() {
      return <AsyncText text="Shell" />;
    }

    // 服务器端渲染
    await resolveText('Shell');
    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
      pipe(writable);
    });
    assertLog(['Shell']);

    // 清除缓存并开始在客户端渲染
    resetTextCache();

    // shell 的数据尚未加载，因此 hydration 会挂起
    const root = await clientAct(async () => {
      return ReactDOMClient.hydrateRoot(container, <App />, {
        /** 记录整根早更新放弃水合的 recoverable message。 */
        onRecoverableError(error) {
          Scheduler.log(error.message);
        },
      });
    });
    assertLog(['Suspend! [Shell]']);
    expect(container.textContent).toBe('Shell');

    await clientAct(async () => {
      root.render(<Text text="New screen" />);
    });
    assertLog([
      'New screen',
      'This root received an early update, before anything was able ' +
        'hydrate. Switched the entire root to client rendering.',
    ]);
    expect(container.textContent).toBe('New screen');
  });

  /** 递归 3000 层 NestedComponent，底端 Shell 已解决；SSR 无 console.error 且输出 Shell，回归检查深组件栈可以完成渲染。 */
  it('recovers from a large component stack during SSR', async () => {
    spyOnDevAndProd(console, 'error').mockImplementation(() => {});

    /** 递归构造深组件调用栈，验证本例正常 SSR 可以完成且没有错误日志。 */
    function NestedComponent({depth}: {/** 剩余递归层数。 */ depth: number}) {
      if (depth <= 0) {
        return <AsyncText text="Shell" />;
      }
      return <NestedComponent depth={depth - 1} />;
    }

    await resolveText('Shell');
    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(
        <NestedComponent depth={3000} />,
      );
      pipe(writable);
    });
    expect(console.error).not.toHaveBeenCalled();
    assertLog(['Shell']);
    expect(container.textContent).toBe('Shell');
  });

  /** Throws 服务端始终抛 plain error，类边界不能捕获 SSR shell；换流先渲染 loading，客户端再水合 App，由边界捕获并显示错误，日志仅 caught。 */
  it('client renders when an error is thrown in an error boundary', async () => {
    /** 始终抛 plain error，使 SSR shell 失败且客户端由边界捕获。 */
    function Throws() {
      throw new Error('plain error');
    }

    /** 客户端捕获持续错误的类边界，服务端 shell 无法靠它恢复。 */
    class ErrorBoundary extends React.Component {
      /** 初始无错误，后续捕获后保存 Error。 */
      state = {error: null};
      /** 将捕获错误映射到边界状态。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 错误时输出 Caught 消息，否则返回原子树。 */
      render() {
        if (this.state.error) {
          return <div>Caught an error: {this.state.error.message}</div>;
        }
        return this.props.children;
      }
    }

    /** 把 Throws 放入类边界，比较服务端失败与客户端捕获。 */
    function App() {
      return (
        <ErrorBoundary>
          <Throws />
        </ErrorBoundary>
      );
    }

    // 服务器端渲染
    let shellError;
    try {
      await serverAct(async () => {
        const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />, {
          /** 记录服务器 shell render 错误；真正流错误由 serverAct 检查。 */
          onError(error) {
            Scheduler.log('onError: ' + error.message);
          },
        });
        pipe(writable);
      });
    } catch (x) {
      shellError = x;
    }
    expect(shellError).toEqual(
      expect.objectContaining({message: 'plain error'}),
    );
    assertLog(['onError: plain error']);

    /** 提供 loading shell，在前一请求失败后用新的 stream 模拟替代服务端内容。 */
    function ErroredApp() {
      return <span>loading</span>;
    }

    // 重置测试环境
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

    // 服务器在 shell 处出错。建议渲染 fallback 加载状态，随后可通过 mismatch 对其进行 hydration。
    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<ErroredApp />);
      pipe(writable);
    });

    expect(container.innerHTML).toBe('<span>loading</span>');

    // 开始水合；下面的 Throws 用错误触发客户端恢复，并非等待 shell 数据。
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />, {
        /** 记录水合期间由类边界捕获的 plain error。 */
        onCaughtError(error) {
          Scheduler.log('onCaughtError: ' + error.message);
        },
        /** 记录未捕获错误；此场景应不走该回调。 */
        onUncaughtError(error) {
          Scheduler.log('onUncaughtError: ' + error.message);
        },
        /** 记录可恢复水合错误及 cause；此例持续错误最终由边界捕获。 */
        onRecoverableError(error) {
          Scheduler.log('onRecoverableError: ' + error.message);
          if (error.cause) {
            Scheduler.log('Cause: ' + error.cause.message);
          }
        },
      });
    });

    assertLog(['onCaughtError: plain error']);
    expect(container.textContent).toBe('Caught an error: plain error');
  });

  /** Throws 服务端成功输出 Hello world，仅客户端抛 plain error；水合阶段转边界错误 UI并报告 caught，验证客户端持续错误的恢复路径。 */
  it('client renders when a client error is thrown in an error boundary', async () => {
    let isClient = false;

    /** 服务端返回 Hello world，isClient 后持续抛错，区分客户端专有错误。 */
    function Throws() {
      if (isClient) {
        throw new Error('plain error');
      }
      return <div>Hello world</div>;
    }

    /** 捕获客户端持续错误并展示消息的边界。 */
    class ErrorBoundary extends React.Component {
      /** 初始化未捕获错误状态。 */
      state = {error: null};
      /** 把客户端错误写入 state。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 错误后选择 Caught UI，否则透传 children。 */
      render() {
        if (this.state.error) {
          return <div>Caught an error: {this.state.error.message}</div>;
        }
        return this.props.children;
      }
    }

    /** 用边界包住仅客户端失败的 Throws。 */
    function App() {
      return (
        <ErrorBoundary>
          <Throws />
        </ErrorBoundary>
      );
    }

    // 服务器端渲染
    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />, {
        /** 记录服务器错误，正常 SSR 时应无记录。 */
        onError(error) {
          Scheduler.log('onError: ' + error.message);
        },
      });
      pipe(writable);
    });
    assertLog([]);

    expect(container.innerHTML).toBe('<div>Hello world</div>');

    isClient = true;

    // 开始水合；下面的 Throws 用错误触发客户端恢复，并非等待 shell 数据。
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />, {
        /** 记录客户端持续错误进入边界的 caught message。 */
        onCaughtError(error) {
          Scheduler.log('onCaughtError: ' + error.message);
        },
        /** 记录未捕获根错误，确认边界场景不会到达。 */
        onUncaughtError(error) {
          Scheduler.log('onUncaughtError: ' + error.message);
        },
        /** 记录 recoverable message 与 cause，供与 caught 分支区分。 */
        onRecoverableError(error) {
          Scheduler.log('onRecoverableError: ' + error.message);
          if (error.cause) {
            Scheduler.log('Cause: ' + error.cause.message);
          }
        },
      });
    });

    assertLog(['onCaughtError: plain error']);
    expect(container.textContent).toBe('Caught an error: plain error');
  });

  /** Throws 仅客户端第一次水合执行抛 plain error，重试成功；最终 Hello world且只 recoverable 附 cause，验证瞬时水合错误不提交边界错误 UI。 */
  it('client renders when a hydration pass error is thrown in an error boundary', async () => {
    let isClient = false;
    let isFirst = true;

    /** 只在客户端首次执行时抛错并清 isFirst；后续客户端重试返回正常内容。 */
    function Throws() {
      if (isClient && isFirst) {
        isFirst = false; // 模拟 hydration 或并发错误
        throw new Error('plain error');
      }
      return <div>Hello world</div>;
    }

    /** 提供可捕获错误的边界，但本例重试成功不应最终展示错误 UI。 */
    class ErrorBoundary extends React.Component {
      /** 初始 error 为 null，便于成功重试保留正常 children。 */
      state = {error: null};
      /** 将边界错误映射到 state，作为成功重试未提交的替代路径。 */
      static getDerivedStateFromError(error) {
        return {error};
      }
      /** 仅在实际提交错误状态时显示错误消息。 */
      render() {
        if (this.state.error) {
          return <div>Caught an error: {this.state.error.message}</div>;
        }
        return this.props.children;
      }
    }

    /** 把一次性 Throws 置于边界，观察水合失败改客户端后能成功重试。 */
    function App() {
      return (
        <ErrorBoundary>
          <Throws />
        </ErrorBoundary>
      );
    }

    // 服务器端渲染
    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />, {
        /** 记录服务端错误，isClient=false 时应无输出。 */
        onError(error) {
          Scheduler.log('onError: ' + error.message);
        },
      });
      pipe(writable);
    });
    assertLog([]);

    expect(container.innerHTML).toBe('<div>Hello world</div>');

    isClient = true;

    // 开始水合；下面的 Throws 用错误触发客户端恢复，并非等待 shell 数据。
    await clientAct(async () => {
      ReactDOMClient.hydrateRoot(container, <App />, {
        /** 记录 caught 分支，本例一次性错误重试成功应不触发。 */
        onCaughtError(error) {
          Scheduler.log('onCaughtError: ' + error.message);
        },
        /** 记录 uncaught 分支，本例应不触发。 */
        onUncaughtError(error) {
          Scheduler.log('onUncaughtError: ' + error.message);
        },
        /** 记录最终成功恢复的 recoverable message 及原 plain error cause。 */
        onRecoverableError(error) {
          Scheduler.log('onRecoverableError: ' + error.message);
          if (error.cause) {
            Scheduler.log('Cause: ' + error.cause.message);
          }
        },
      });
    });

    assertLog([
      'onRecoverableError: There was an error while hydrating but React was able to recover by instead client rendering the entire root.',
      'Cause: plain error',
    ]);
    expect(container.textContent).toBe('Hello world');
  });

  /** useSyncExternalStore 的 server snapshot 水合时抛 Oops，切客户端后的 use(clientPromise) 又挂起；旧 Server DOM 保留且暂不报错，promise 解决提交 Client 后再报告 recoverable 与 cause。 */
  it(
    'handles suspending while recovering from a hydration error (in the ' +
      'shell, no Suspense boundary)',
    async () => {
      const useSyncExternalStore = React.useSyncExternalStore;

      let isClient = false;

      let resolve;
      const clientPromise = new Promise(res => {
        resolve = res;
      });

      /** 水合读 server snapshot 时抛错，改客户端读到 Client 后 use 挂起；只有 promise 完成才返回客户端结果。 */
      function App() {
        const state = useSyncExternalStore(
          /** 提供不推送更新的 external store 订阅，并返回空清理函数。 */ function subscribe() {
            return () => {};
          },
          /** 客户端 snapshot 固定为 Client，触发读取 clientPromise。 */ function getSnapshot() {
            return 'Client';
          },
          /** 服务端返回 Server；模拟客户端水合时抛 Oops，制造 snapshot 恢复路径。 */ function getServerSnapshot() {
            const isHydrating = isClient;
            if (isHydrating) {
              // 这会在 hydration 期间触发错误。
              throw new Error('Oops!');
            }
            return 'Server';
          },
        );

        if (state === 'Client') {
          return React.use(clientPromise);
        }

        return state;
      }

      // 服务器端渲染
      await serverAct(async () => {
        const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />);
        pipe(writable);
      });
      assertLog([]);

      expect(container.innerHTML).toBe('Server');

      // hydration 期间会抛出错误；React 会尝试切换到客户端渲染以恢复。
      isClient = true;
      await clientAct(async () => {
        ReactDOMClient.hydrateRoot(container, <App />, {
          /** 记录提交恢复时的水合错误与 cause，在客户端仍 pending 时不会先报告。 */
          onRecoverableError(error) {
            Scheduler.log('onRecoverableError: ' + error.message);
            if (error.cause) {
              Scheduler.log('Cause: ' + error.cause.message);
            }
          },
        });
      });
      expect(container.innerHTML).toBe('Server'); // 仍然挂起
      assertLog([]);

      await clientAct(async () => {
        resolve('Client');
      });
      assertLog([
        'onRecoverableError: There was an error while hydrating but React was ' +
          'able to recover by instead client rendering the entire root.',
        'Cause: Oops!',
      ]);
      expect(container.innerHTML).toBe('Client');
    },
  );

  /** Updater effect 触发本地级联更新并 transition 设置已解决 promise，Page 在 memo 前条件 use；服务器 Bomb 边界失败、客户端 caught 恢复，最终 boomresolved且无 Rendered more hooks。 */
  it(
    'does not corrupt hooks during hydration when conditional use suspends ' +
      'after a cascading update (#33580)',
    async () => {
      const {ErrorBoundary, Bomb} = createErrorBoundaryAndBomb();

      /** effect 更新本地 state，并 transition 将已解决 promise 交给 Page；依赖 state 变化允许产生级联 effect 轮次。 */
      function Updater({setPromise}) {
        const [state, setState] = React.useState(false);

        React.useEffect(() => {
          setState(true);
          startTransition(() => {
            setPromise(Promise.resolve('resolved'));
          });
        }, [state]);

        return null;
      }

      /** 持有 promise 状态，条件 use 位于 memo 前；输出 Updater、错误边界与 promise 结果，用于检验重跑 Hook 链不被暂停破坏。 */
      function Page() {
        const [promise, setPromise] = React.useState(null);
        const value = promise ? React.use(promise) : promise;

        React.useMemo(() => {}, []);

        return (
          <>
            <Updater setPromise={setPromise} />
            <React.Suspense fallback="Loading...">
              <ErrorBoundary>
                <Bomb />
              </ErrorBoundary>
            </React.Suspense>
            {value !== null ? value : 'hello world'}
          </>
        );
      }

      /** 返回 Page，保留水合入口层级。 */
      function App() {
        return <Page />;
      }

      await serverAct(async () => {
        const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />, {
          /** 记录服务器 Bomb 错误，验证边界已进入客户端恢复路径。 */
          onError(error) {
            Scheduler.log('onError: ' + error.message);
          },
        });
        pipe(writable);
      });
      assertLog(['onError: boom']);

      const errors = await hydrateRootAndCollectErrors(<App />);
      assertLog(['onCaughtError: boom']);

      expect(
        errors.find(error => error.includes('Rendered more hooks')),
      ).toBeUndefined();
      expect(container.textContent).toBe('Something went wrong: boomresolved');
    },
  );

  /** Updater 同时设置 Page.ready 并 transition 传 promise，Page 在首个 useState 前条件 use 暂停；水合恢复后 ready/resolved都保留且无 Hook 数量错误，验证首个跟踪 Hook 前暂停的链表恢复。 */
  it('preserves hooks when suspension happens before the first tracked hook', async () => {
    const {ErrorBoundary, Bomb} = createErrorBoundaryAndBomb();
    let setReady;

    /** 挂载 effect 设置 Page.ready，同时 transition 更新 promise，制造紧邻首 Hook 前暂停的更新交叠。 */
    function Updater({setPromise}) {
      React.useEffect(() => {
        setReady(true);
        startTransition(() => {
          setPromise(Promise.resolve('resolved'));
        });
      }, []);

      return null;
    }

    /** 条件 use 在首 useState 前；暴露 ready setter 并保留后续 memo，检查暂停恢复后状态链与 promise 值同时正确。 */
    function Page({promise}) {
      const value = promise ? React.use(promise) : promise;

      const [ready, _setReady] = React.useState(false);
      setReady = _setReady;

      React.useMemo(() => {}, []);

      return (
        <>
          <React.Suspense fallback="Loading...">
            <ErrorBoundary>
              <Bomb />
            </ErrorBoundary>
          </React.Suspense>
          <span>{ready ? 'ready' : 'not-ready'}</span>
          <span>{value !== null ? value : 'hello world'}</span>
        </>
      );
    }

    /** 持有传给 Page 的 promise，在兄弟 Updater 的 effect 中更新，区分 Page 内外状态归属。 */
    function App() {
      const [promise, setPromise] = React.useState(null);

      return (
        <>
          <Updater setPromise={setPromise} />
          <Page promise={promise} />
        </>
      );
    }

    await serverAct(async () => {
      const {pipe} = ReactDOMFizzServer.renderToPipeableStream(<App />, {
        /** 记录 SSR Bomb 失败，提供水合错误恢复背景。 */
        onError(error) {
          Scheduler.log('onError: ' + error.message);
        },
      });
      pipe(writable);
    });
    assertLog(['onError: boom']);

    const errors = await hydrateRootAndCollectErrors(<App />);
    assertLog(['onCaughtError: boom']);

    expect(
      errors.find(error => error.includes('Rendered more hooks')),
    ).toBeUndefined();
    expect(container.textContent).toBe(
      'Something went wrong: boomreadyresolved',
    );
  });
});
