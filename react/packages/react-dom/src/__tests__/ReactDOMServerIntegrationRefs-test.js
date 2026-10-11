/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

/** 生成 SSR 字符串、客户端 hydration 和 markup 对比 helper；各 case 用不同树区分服务端 ref 与客户端 ref。 */
const ReactDOMServerIntegrationUtils = require('./utils/ReactDOMServerIntegrationTestUtils');

let React;
let ReactDOMClient;
let ReactDOMServer;

/** 清理模块与警告缓存，再装入 React、client 和 server 入口，把 renderer 交给集成 helper 使用。 */
function initModules() {
  // 重置警告缓存。
  jest.resetModules();
  React = require('react');
  ReactDOMClient = require('react-dom/client');
  ReactDOMServer = require('react-dom/server');

  // 让他们可以帮助.
  return {
    ReactDOMClient,
    ReactDOMServer,
  };
}

/** 绑定本套测试的模块重置、SSR后hydration 与两棵树 markup 比较入口。 */
const {resetModules, clientRenderOnServerString, expectMarkupMatch} =
  ReactDOMServerIntegrationUtils(initModules);

describe('ReactDOMServerIntegration', () => {
  beforeEach(() => {
    resetModules();
  });

  describe('refs', function () {
    /** 服务端树带计数 ref，客户端匹配树改用普通 div；集成 helper 完成 SSR/hydration 后计数应为 0，验证服务端输出不会执行 ref 回调。 */
    it('should not run ref code on server', async () => {
      let refCount = 0;
      /** 服务端一侧带计数 ref 的 fixture，客户端匹配树不用它，以隔离 SSR 是否调用 ref。 */
      class RefsComponent extends React.Component {
        /** 输出带计数回调 ref 的 div；若服务端误调用 ref，refCount 会立即暴露。 */
        render() {
          return <div ref={e => refCount++} />;
        }
      }
      await expectMarkupMatch(<RefsComponent />, <div />);
      expect(refCount).toBe(0);
    });

    /** 服务端是普通 div，客户端匹配树使用计数 ref；hydration 后计数应为 1，验证 ref 在客户端提交时挂载。 */
    it('should run ref code on client', async () => {
      let refCount = 0;
      /** 客户端一侧带计数 ref 的 fixture，用与服务端相同 div 标签完成 hydration。 */
      class RefsComponent extends React.Component {
        /** 输出带计数回调 ref 的 div，记录客户端 commit 挂载回调的次数。 */
        render() {
          return <div ref={e => refCount++} />;
        }
      }
      await expectMarkupMatch(<div />, <RefsComponent />);
      expect(refCount).toBe(1);
    });

    /** 带赋值 ref 的组件先 SSR 再 hydration；helper 返回节点与 ref 收到节点应为同一对象且非 null，验证 ref 取得复用的真实宿主节点。 */
    it('should send the correct element to ref functions on client', async () => {
      let refElement = null;
      /** 通过回调保存宿主节点，供 hydration helper 返回值进行身份比较。 */
      class RefsComponent extends React.Component {
        /** 输出 div 并把提交的宿主节点赋给 refElement，不添加改变 markup 的属性。 */
        render() {
          return <div ref={e => (refElement = e)} />;
        }
      }
      const e = await clientRenderOnServerString(<RefsComponent />);
      expect(refElement).not.toBe(null);
      expect(refElement).toBe(e);
    });
  });

  /** 通过 forwardRef 把外层 ref 显式传到类组件的宿主 div，SSR 后 hydration；ref.current 应非空且文本为 hello，验证跨组件转发仍落到宿主实例。 */
  it('should forward refs', async () => {
    const divRef = React.createRef();

    /** 承接 forwardedRef 与 value，把转发目标固定为真实宿主 div。 */
    class InnerComponent extends React.Component {
      /** 把 forwardedRef 挂到 div 并输出 value，使最终 ref 身份与 hello 文本都可检查。 */
      render() {
        return <div ref={this.props.forwardedRef}>{this.props.value}</div>;
      }
    }

    /** 转交 props 并把外层 ref 显式改名为 forwardedRef，供 InnerComponent 绑定宿主 div。 */
    const OuterComponent = React.forwardRef((props, ref) => (
      <InnerComponent {...props} forwardedRef={ref} />
    ));

    await clientRenderOnServerString(
      <OuterComponent ref={divRef} value="hello" />,
    );

    expect(divRef.current).not.toBe(null);
    expect(divRef.current.textContent).toBe('hello');
  });
});
