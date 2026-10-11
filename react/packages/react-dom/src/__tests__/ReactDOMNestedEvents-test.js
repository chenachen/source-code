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

  /** 按钮初始两个状态都为 false；click handler 同步调用 focus 并分别安排点击/聚焦更新。focus 返回后的日志仍应看到两项 false，最外层 act 完成后两项均为 true，验证嵌套原生派发不会提前冲刷事件批次。 */
  it('nested event dispatches should not cause updates to flush', async () => {
    const buttonRef = React.createRef(null);

    /** 用两项状态把外层 click 和内层 focus 的提交时机显示在同一个按钮上。 */
    function App() {
      const [isClicked, setIsClicked] = useState(false);
      const [isFocused, setIsFocused] = useState(false);

      /** 安排点击状态、同步触发 focus，然后读取旧 DOM 日志；该读取位置验证嵌套事件没有结束外层批次。 */
      const onClick = () => {
        setIsClicked(true);
        const el = buttonRef.current;
        el.focus();
        // focus 事件触发的更新此时尚未冲刷，click 更新也一样；若用 `flushSync`
        // 包裹 focus 调用，两项更新才会在这里同步提交。
        Scheduler.log('Value right after focus call: ' + el.innerHTML);
      };

      /** 仅安排聚焦状态，让其与外层点击更新一起在事件批次结束后提交。 */
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
