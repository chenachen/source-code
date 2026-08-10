/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

describe('ReactDOMNestedEvents', () => {
  let React;
  let ReactDOMClient;
  let Scheduler;
  let act;
  let useState;
  let assertLog;

  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactDOMClient = require('react-dom/client');
    Scheduler = require('scheduler');
    act = require('internal-test-utils').act;
    useState = React.useState;

    const InternalTestUtils = require('internal-test-utils');
    assertLog = InternalTestUtils.assertLog;
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「nested event dispatches should not cause updates to flush」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：事件断言连接 DOMPluginEventSystem 的委托、合成与传播路径。
   */
  it('nested event dispatches should not cause updates to flush', async () => {
    const buttonRef = React.createRef(null);
    /** `App`：封装当前用例复用的操作、回调或断言步骤。 */
    function App() {
      const [isClicked, setIsClicked] = useState(false);
      const [isFocused, setIsFocused] = useState(false);
      /** `App.onClick`：封装当前用例复用的操作、回调或断言步骤。 */
      const onClick = () => {
        setIsClicked(true);
        const el = buttonRef.current;
        el.focus();
        // focus 事件触发的更新此时尚未冲刷，click 更新也一样；若用 `flushSync`
        // 包裹 focus 调用，两项更新才会在这里同步提交。
        Scheduler.log('Value right after focus call: ' + el.innerHTML);
      };
      /** `App.onFocus`：封装当前用例复用的操作、回调或断言步骤。 */
      const onFocus = () => {
        setIsFocused(true);
      };
      return (
        <>
          <button ref={buttonRef} onFocus={onFocus} onClick={onClick}>
            {`Clicked: ${isClicked}, Focused: ${isFocused}`}
          </button>
        </>
      );
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOMClient.createRoot(container);

    await act(() => {
      root.render(<App />);
    });
    expect(buttonRef.current.innerHTML).toEqual(
      'Clicked: false, Focused: false',
    );

    await act(() => {
      buttonRef.current.click();
    });
    assertLog(['Value right after focus call: Clicked: false, Focused: false']);
    expect(buttonRef.current.innerHTML).toEqual('Clicked: true, Focused: true');
  });
});
