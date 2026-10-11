let React;
let ReactDOM;
let ReactDOMClient;
let Scheduler;
let act;
let assertLog;

let overrideQueueMicrotask;
let flushFakeMicrotasks;

// TODO：把相关测试统一迁移到 React DOM，不再依赖 React Noop。

/** 验证缺少 AggregateError 时三个同步根仍完成各自提交，内部 act 最终返回收集到的首个错误。 */
describe('ReactFlushSync (AggregateError not available)', () => {
  /**
   * 每例移除 AggregateError、安装可控 queueMicrotask，并重建 DOM roots 依赖。
   * fake queue 仅在 overrideQueueMicrotask 为 true 时接管任务，供场景结束后耗尽剩余调度微任务。
   */
  beforeEach(() => {
    jest.resetModules();

    global.AggregateError = undefined;

    // 保留旧场景的可控微任务夹具；当前 internalAct.aggregateErrors 在没有 AggregateError 时返回 errors[0]。
    const originalQueueMicrotask = queueMicrotask;
    overrideQueueMicrotask = false;
    const fakeMicrotaskQueue = [];
    /** 接管开关开启时暂存 cb，关闭时委托原始微任务入口，以保持挂载阶段的正常调度。 */
    global.queueMicrotask = cb => {
      if (overrideQueueMicrotask) {
        fakeMicrotaskQueue.push(cb);
      } else {
        originalQueueMicrotask(cb);
      }
    };
    /** 按 FIFO 耗尽 fake queue；回调中新排入的微任务也在本轮执行，抛错则直接中断。 */
    flushFakeMicrotasks = () => {
      while (fakeMicrotaskQueue.length > 0) {
        const cb = fakeMicrotaskQueue.shift();
        cb();
      }
    };

    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;

    const InternalTestUtils = require('internal-test-utils');
    assertLog = InternalTestUtils.assertLog;
  });

  /** 记录 DOM root 的同步提交顺序，并输出相同文本供可见树检查。 */
  function Text({text}) {
    Scheduler.log(text);
    return text;
  }

  /**
   * 把真实 DOM 递归投影为只含可见节点的 ReactNode；忽略脚本、模板、hidden 与 aria-hidden。
   * React 自动生成的带冒号 id 也被剔除，避免实现细节干扰结构断言。
   */
  function getVisibleChildren(element: Element): React$Node {
    const children = [];
    let node: any = element.firstChild;
    while (node) {
      if (node.nodeType === 1) {
        if (
          ((node.tagName !== 'SCRIPT' && node.tagName !== 'script') ||
            node.hasAttribute('data-meaningful')) &&
          node.tagName !== 'TEMPLATE' &&
          node.tagName !== 'template' &&
          !node.hasAttribute('hidden') &&
          !node.hasAttribute('aria-hidden')
        ) {
          const props: any = {};
          const attributes = node.attributes;
          for (let i = 0; i < attributes.length; i++) {
            if (
              attributes[i].name === 'id' &&
              attributes[i].value.includes(':')
            ) {
              // 带冒号的 id 视为 React 自动添加且不可见的实现细节，不纳入预期树。
              continue;
            }
            props[attributes[i].name] = attributes[i].value;
          }
          props.children = getVisibleChildren(node);
          children.push(
            require('react').createElement(node.tagName.toLowerCase(), props),
          );
        }
      } else if (node.nodeType === 3) {
        children.push(node.data);
      }
      node = node.nextSibling;
    }
    return children.length === 0
      ? undefined
      : children.length === 1
        ? children[0]
        : children;
  }

  /**
   * Given 三个已提交 DOM roots 且环境没有 AggregateError；When 同一次 flushSync 中前两根抛错、第三根更新成功；
   * Then 第三根输出 aww，前两根输出为空，内部 act 抛出的值为 aahh。
   * 验证机制：Scheduler 日志、可见 DOM 投影与错误身份；RootScheduler 跨根冲刷继续工作，
   * ErrorLogger 把未捕获错误交给全局通道，internalAct 收集错误并在无 AggregateError 时返回首项。
   */
  it('completely exhausts synchronous work queue even if something throws', async () => {
    /** 在 render 阶段抛出调用方提供的错误，用不同实例标记多根失败顺序。 */
    function Throws({error}) {
      throw error;
    }

    const container1 = document.createElement('div');
    const root1 = ReactDOMClient.createRoot(container1);
    const container2 = document.createElement('div');
    const root2 = ReactDOMClient.createRoot(container2);
    const container3 = document.createElement('div');
    const root3 = ReactDOMClient.createRoot(container3);

    await act(async () => {
      root1.render(<Text text="Hi" />);
      root2.render(<Text text="Andrew" />);
      root3.render(<Text text="!" />);
    });
    assertLog(['Hi', 'Andrew', '!']);

    const aahh = new Error('AAHH!');
    const nooo = new Error('Noooooooooo!');

    // 开始接管全局 queueMicrotask，保留同步错误处理后的剩余调度任务供末尾冲刷。
    overrideQueueMicrotask = true;
    let error;
    try {
      await act(() => {
        ReactDOM.flushSync(() => {
          root1.render(<Throws error={aahh} />);
          root2.render(<Throws error={nooo} />);
          root3.render(<Text text="aww" />);
        });
      });
    } catch (e) {
      error = e;
    }

    // 即使前两根出错，第三根更新仍应在同一同步队列中完成。
    assertLog(['aww']);
    // 失败的 root1 与 root2 应被卸载。
    expect(getVisibleChildren(container1)).toEqual(undefined);
    expect(getVisibleChildren(container2)).toEqual(undefined);
    expect(getVisibleChildren(container3)).toEqual('aww');

    // 当前内部 act 的无 AggregateError 分支直接返回第一个收集值，断言其身份仍为 aahh。
    expect(error).toBe(aahh);
    await flushFakeMicrotasks();
  });
});
