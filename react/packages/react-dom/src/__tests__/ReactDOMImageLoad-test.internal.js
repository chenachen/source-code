/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let React;
let Scheduler;
// let ReactCache;
let ReactDOM;
let ReactDOMClient;
// let Suspense;
let originalCreateElement;
// let TextResource;
// let textResourceShouldFail;
let originalHTMLImageElementSrcDescriptor;

let images = [];
let onLoadSpy = null;
let actualLoadSpy = null;

let waitForAll;
let waitFor;
let assertLog;

/** `PhaseMarkers`：封装当前用例复用的操作、回调或断言步骤。 */
function PhaseMarkers({children}) {
  Scheduler.log('render start');
  React.useLayoutEffect(() => {
    Scheduler.log('last layout');
  });
  React.useEffect(() => {
    Scheduler.log('last passive');
  });
  return children;
}

/** `last`：封装当前用例复用的操作、回调或断言步骤。 */
function last(arr) {
  if (Array.isArray(arr)) {
    if (arr.length) {
      return arr[arr.length - 1];
    }
    return undefined;
  }
  throw new Error('last was passed something that was not an array');
}

/** `Text`：封装当前用例复用的操作、回调或断言步骤。 */
function Text(props) {
  Scheduler.log(props.text);
  return props.text;
}

// function AsyncText(props) {
//   const text = props.text;
//   try {
//     TextResource.read([props.text, props.ms]);
//     Scheduler.log(text);
//     return text;
//   } catch (promise) {
//     if (typeof promise.then === 'function') {
//       Scheduler.log(`Suspend! [${text}]`);
//     } else {
//       Scheduler.log(`Error! [${text}]`);
//     }
//     throw promise;
//   }
// }

/** `Img`：封装当前用例复用的操作、回调或断言步骤。 */
function Img({src: maybeSrc, onLoad, useImageLoader, ref}) {
  const src = maybeSrc || 'default';
  Scheduler.log('Img ' + src);
  return <img src={src} onLoad={onLoad} />;
}

/** `Yield`：封装当前用例复用的操作、回调或断言步骤。 */
function Yield() {
  Scheduler.log('Yield');
  Scheduler.unstable_requestPaint();
  return null;
}

/** `loadImage`：封装当前用例复用的操作、回调或断言步骤。 */
function loadImage(element) {
  const event = new Event('load');
  element.__needsDispatch = false;
  element.dispatchEvent(event);
}

describe('ReactDOMImageLoad', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    Scheduler = require('scheduler');
    // ReactCache = require('react-cache');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    // Suspense = React.Suspense;

    const InternalTestUtils = require('internal-test-utils');
    waitForAll = InternalTestUtils.waitForAll;
    waitFor = InternalTestUtils.waitFor;
    assertLog = InternalTestUtils.assertLog;

    onLoadSpy = jest.fn(reactEvent => {
      const src = reactEvent.target.getAttribute('src');
      Scheduler.log('onLoadSpy [' + src + ']');
    });

    actualLoadSpy = jest.fn(nativeEvent => {
      const src = nativeEvent.target.getAttribute('src');
      Scheduler.log('actualLoadSpy [' + src + ']');
      nativeEvent.__originalDispatch = false;
    });

    // TextResource = ReactCache.unstable_createResource(
    //   ([text, ms = 0]) => {
    //     let listeners = null;
    //     let status = 'pending';
    //     let value = null;
    //     return {
    //       then(resolve, reject) {
    //         switch (status) {
    //           case 'pending': {
    //             if (listeners === null) {
    //               listeners = [{resolve, reject}];
    //               setTimeout(() => {
    //                 if (textResourceShouldFail) {
    //                   Scheduler.log(
    //                     `Promise rejected [${text}]`,
    //                   );
    //                   status = 'rejected';
    //                   value = new Error('Failed to load: ' + text);
    //                   listeners.forEach(listener => listener.reject(value));
    //                 } else {
    //                   Scheduler.log(
    //                     `Promise resolved [${text}]`,
    //                   );
    //                   status = 'resolved';
    //                   value = text;
    //                   listeners.forEach(listener => listener.resolve(value));
    //                 }
    //               }, ms);
    //             } else {
    //               listeners.push({resolve, reject});
    //             }
    //             break;
    //           }
    //           case 'resolved': {
    //             resolve(value);
    //             break;
    //           }
    //           case 'rejected': {
    //             reject(value);
    //             break;
    //           }
    //         }
    //       },
    //     };
    //   },
    //   ([text, ms]) => text,
    // );
    // textResourceShouldFail = false;

    images = [];

    originalCreateElement = document.createElement;
    document.createElement = function createElement(tagName, options) {
      const element = originalCreateElement.call(document, tagName, options);
      if (tagName === 'img') {
        element.addEventListener('load', actualLoadSpy);
        images.push(element);
      }
      return element;
    };

    originalHTMLImageElementSrcDescriptor = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      'src',
    );

    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      /** `get`：实现测试夹具的生命周期、渲染或交互步骤。 */
      get() {
        return this.getAttribute('src');
      },
      /** `set`：实现测试夹具的生命周期、渲染或交互步骤。 */
      set(value) {
        Scheduler.log('load triggered');
        this.__needsDispatch = true;
        this.setAttribute('src', value);
      },
    });
  });

  afterEach(() => {
    document.createElement = originalCreateElement;
    Object.defineProperty(
      HTMLImageElement.prototype,
      'src',
      originalHTMLImageElementSrcDescriptor,
    );
  });

  /**
   * 代表场景（Given–When–Then）：
   * Given 当前文件已建立所需 DOM、React 根与测试夹具；
   * When 执行「captures the load event if it happens before commit phase and replays it between layout and passive effects」描述的渲染或交互；
   * Then 通过本用例的 DOM、日志或调度断言确认行为。
   *
   * 验证机制：断言连接 ReactDOM 公开入口、ReactDOMRoot 根生命周期及 DOM 提交结果。
   */
  it('captures the load event if it happens before commit phase and replays it between layout and passive effects', async function () {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    React.startTransition(() =>
      root.render(
        <PhaseMarkers>
          <Img onLoad={onLoadSpy} />
          <Yield />
          <Text text={'a'} />
        </PhaseMarkers>,
      ),
    );

    await waitFor(['render start', 'Img default', 'Yield']);
    const img = last(images);
    loadImage(img);
    assertLog([
      'actualLoadSpy [default]',
      // 由于尚未完成渲染，onLoadSpy 尚未被调用。
    ]);
    await waitForAll(['a', 'load triggered', 'last layout', 'last passive']);
    expect(img.__needsDispatch).toBe(true);
    loadImage(img);
    assertLog([
      'actualLoadSpy [default]', // 浏览器重新加载图像会使这里再次 yield。
      'onLoadSpy [default]',
    ]);
    expect(onLoadSpy).toHaveBeenCalled();
  });

  /** 测试场景：验证「captures the load event if it happens after commit phase and replays it」描述的渲染、交互或错误处理结果。 */
  it('captures the load event if it happens after commit phase and replays it', async function () {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    React.startTransition(() =>
      root.render(
        <PhaseMarkers>
          <Img onLoad={onLoadSpy} />
        </PhaseMarkers>,
      ),
    );

    await waitFor([
      'render start',
      'Img default',
      'load triggered',
      'last layout',
    ]);
    Scheduler.unstable_requestPaint();
    const img = last(images);
    loadImage(img);
    assertLog(['actualLoadSpy [default]', 'onLoadSpy [default]']);
    await waitForAll(['last passive']);
    expect(img.__needsDispatch).toBe(false);
    expect(onLoadSpy).toHaveBeenCalledTimes(1);
  });

  /** 测试场景：验证「replays the last load event when more than one fire before the end of the layout phase completes」描述的渲染、交互或错误处理结果。 */
  it('replays the last load event when more than one fire before the end of the layout phase completes', async function () {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    /** `Base`：封装当前用例复用的操作、回调或断言步骤。 */
    function Base() {
      const [src, setSrc] = React.useState('a');
      return (
        <PhaseMarkers>
          <Img src={src} onLoad={onLoadSpy} />
          <Yield />
          <UpdateSrc setSrc={setSrc} />
        </PhaseMarkers>
      );
    }

    /** `UpdateSrc`：封装当前用例复用的操作、回调或断言步骤。 */
    function UpdateSrc({setSrc}) {
      React.useLayoutEffect(() => {
        setSrc('b');
      }, [setSrc]);
      return null;
    }

    React.startTransition(() => root.render(<Base />));

    await waitFor(['render start', 'Img a', 'Yield']);
    const img = last(images);
    loadImage(img);
    assertLog(['actualLoadSpy [a]']);

    await waitFor([
      'load triggered',
      'last layout',
      // layout 阶段的更新会在同步渲染前触发 passive effect 冲刷。
      'last passive',
      'render start',
      'Img b',
      'Yield',
      // 当前是同步渲染，因此忽略该 yield。
      'last layout',
      'last passive',
    ]);
    expect(images.length).toBe(1);
    loadImage(img);
    assertLog(['actualLoadSpy [b]', 'onLoadSpy [b]']);
    expect(onLoadSpy).toHaveBeenCalledTimes(1);
  });

  /** 测试场景：验证「replays load events that happen in passive phase after the passive phase.」描述的渲染、交互或错误处理结果。 */
  it('replays load events that happen in passive phase after the passive phase.', async function () {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    root.render(
      <PhaseMarkers>
        <Img onLoad={onLoadSpy} />
      </PhaseMarkers>,
    );

    await waitForAll([
      'render start',
      'Img default',
      'load triggered',
      'last layout',
      'last passive',
    ]);
    const img = last(images);
    loadImage(img);
    assertLog(['actualLoadSpy [default]', 'onLoadSpy [default]']);
    expect(onLoadSpy).toHaveBeenCalledTimes(1);
  });

  /** 测试场景：验证「captures and suppresses the load event if it happens before passive effects and a cascading update causes the img to be removed」描述的渲染、交互或错误处理结果。 */
  it('captures and suppresses the load event if it happens before passive effects and a cascading update causes the img to be removed', async function () {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    /** `ChildSuppressing`：封装当前用例复用的操作、回调或断言步骤。 */
    function ChildSuppressing({children}) {
      const [showChildren, update] = React.useState(true);
      React.useLayoutEffect(() => {
        if (showChildren) {
          update(false);
        }
      }, [showChildren]);
      return showChildren ? children : null;
    }

    React.startTransition(() =>
      root.render(
        <PhaseMarkers>
          <ChildSuppressing>
            <Img onLoad={onLoadSpy} />
            <Yield />
            <Text text={'a'} />
          </ChildSuppressing>
        </PhaseMarkers>,
      ),
    );

    await waitFor(['render start', 'Img default', 'Yield']);
    const img = last(images);
    loadImage(img);
    assertLog(['actualLoadSpy [default]']);
    await waitForAll(['a', 'load triggered', 'last layout', 'last passive']);
    expect(img.__needsDispatch).toBe(true);
    loadImage(img);
    // 我们期望浏览器再次加载图像，但由于我们不再渲染 img 元素，因此 onLoad 事件将不会被调用。
    assertLog(['actualLoadSpy [default]']);
    await waitForAll([]);
    expect(onLoadSpy).not.toHaveBeenCalled();
  });

  /** 测试场景：验证「captures and suppresses the load event if it happens before passive effects and a cascading update causes the img to be removed, alternate」描述的渲染、交互或错误处理结果。 */
  it('captures and suppresses the load event if it happens before passive effects and a cascading update causes the img to be removed, alternate', async function () {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    /** `Switch`：封装当前用例复用的操作、回调或断言步骤。 */
    function Switch({children}) {
      const [shouldShow, updateShow] = React.useState(true);
      return children(shouldShow, updateShow);
    }

    /** `UpdateSwitchInLayout`：封装当前用例复用的操作、回调或断言步骤。 */
    function UpdateSwitchInLayout({updateShow}) {
      React.useLayoutEffect(() => {
        updateShow(false);
      }, []);
      return null;
    }

    React.startTransition(() =>
      root.render(
        <Switch>
          {(shouldShow, updateShow) => (
            <PhaseMarkers>
              <>
                {shouldShow === true ? (
                  <>
                    <Img onLoad={onLoadSpy} />
                    <Yield />
                    <Text text={'a'} />
                  </>
                ) : null}
                ,
                <UpdateSwitchInLayout updateShow={updateShow} />
              </>
            </PhaseMarkers>
          )}
        </Switch>,
      ),
    );

    await waitFor([
      // 初始渲染
      'render start',
      'Img default',
      'Yield',
    ]);
    const img = last(images);
    loadImage(img);
    assertLog(['actualLoadSpy [default]']);
    await waitForAll([
      'a',
      'load triggered',
      // img 元素在挂载时存在。
      'last layout',
      'last passive',
      // 同步重渲染，其中图片被抑制
      'render start',
      'last layout',
      'last passive',
    ]);
    expect(img.__needsDispatch).toBe(true);
    loadImage(img);
    // 我们期望浏览器再次加载图像，但由于我们不再渲染 img 元素，因此 onLoad 事件将不会被调用。
    assertLog(['actualLoadSpy [default]']);
    await waitForAll([]);
    expect(onLoadSpy).not.toHaveBeenCalled();
  });

  // eslint-disable-next-line jest/no-commented-out-tests
  // it('captures the load event if it happens in a suspended subtree and replays it between layout and passive effects on resumption', async function() {
  //   function SuspendingWithImage() {
  //     Scheduler.log('SuspendingWithImage');
  //     return (
  //       <Suspense fallback={<Text text="Loading..." />}>
  //         <AsyncText text="A" ms={100} />
  //         <PhaseMarkers>
  //           <Img onLoad={onLoadSpy} />
  //         </PhaseMarkers>
  //       </Suspense>
  //     );
  //   }

  //   const container = document.createElement('div');
  //   const root = ReactDOMClient.createRoot(container);

  //   React.startTransition(() => root.render(<SuspendingWithImage />));

  //   expect(Scheduler).toFlushAndYield([
  //     'SuspendingWithImage',
  //     'Suspend! [A]',
  //     'render start',
  //     'Img default',
  //     'Loading...',
  //   ]);
  //   let img = last(images);
  //   loadImage(img);
  //   expect(Scheduler).toHaveYielded(['actualLoadSpy [default]']);
  //   expect(onLoadSpy).not.toHaveBeenCalled();

  //   // Flush some of the time
  //   jest.advanceTimersByTime(50);
  //   // Still nothing...
  //   expect(Scheduler).toFlushWithoutYielding();

  //   // Flush the promise completely
  //   jest.advanceTimersByTime(50);
  //   // Renders successfully
  //   expect(Scheduler).toHaveYielded(['Promise resolved [A]']);

  //   expect(Scheduler).toFlushAndYieldThrough([
  //     'A',
  //     // img was recreated on unsuspended tree causing new load event
  //     'render start',
  //     'Img default',
  //     'last layout',
  //   ]);

  //   expect(images.length).toBe(2);
  //   img = last(images);
  //   expect(img.__needsDispatch).toBe(true);
  //   loadImage(img);
  //   expect(Scheduler).toHaveYielded([
  //     'actualLoadSpy [default]',
  //     'onLoadSpy [default]',
  //   ]);

  //   expect(Scheduler).toFlushAndYield(['last passive']);

  //   expect(onLoadSpy).toHaveBeenCalledTimes(1);
  // });

  /** 测试场景：验证「correctly replays the last img load even when a yield + update causes the host element to change」描述的渲染、交互或错误处理结果。 */
  it('correctly replays the last img load even when a yield + update causes the host element to change', async function () {
    let externalSetSrc = null;
    let externalSetSrcAlt = null;

    /** `Base`：封装当前用例复用的操作、回调或断言步骤。 */
    function Base() {
      const [src, setSrc] = React.useState(null);
      const [srcAlt, setSrcAlt] = React.useState(null);
      externalSetSrc = setSrc;
      externalSetSrcAlt = setSrcAlt;
      return srcAlt || src ? <YieldingWithImage src={srcAlt || src} /> : null;
    }

    /** `YieldingWithImage`：封装当前用例复用的操作、回调或断言步骤。 */
    function YieldingWithImage({src}) {
      Scheduler.log('YieldingWithImage');
      React.useEffect(() => {
        Scheduler.log('Committed');
      });
      return (
        <>
          <Img src={src} onLoad={onLoadSpy} />
          <Yield />
          <Text text={src} />
        </>
      );
    }

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    root.render(<Base />);

    await waitForAll([]);

    React.startTransition(() => externalSetSrc('a'));

    await waitFor(['YieldingWithImage', 'Img a', 'Yield']);
    let img = last(images);
    loadImage(img);
    assertLog(['actualLoadSpy [a]']);

    ReactDOM.flushSync(() => externalSetSrcAlt('b'));

    assertLog([
      'YieldingWithImage',
      'Img b',
      'Yield',
      'b',
      'load triggered',
      'Committed',
    ]);
    expect(images.length).toBe(2);
    img = last(images);
    expect(img.__needsDispatch).toBe(true);
    loadImage(img);

    assertLog(['actualLoadSpy [b]', 'onLoadSpy [b]']);
    // 为什么这里又有一个更新？
    await waitForAll(['YieldingWithImage', 'Img b', 'Yield', 'b', 'Committed']);
  });

  /** 测试场景：验证「preserves the src property / attribute when triggering a potential new load event」描述的渲染、交互或错误处理结果。 */
  it('preserves the src property / attribute when triggering a potential new load event', async () => {
    // 该测试覆盖 https://github.com/mui/material-ui/pull/31263 发现的回归：重置 src 属性曾导致其值
    // 从相对地址变为完整地址。

    // 确保我们没有使用 patched src setter
    Object.defineProperty(
      HTMLImageElement.prototype,
      'src',
      originalHTMLImageElementSrcDescriptor,
    );

    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    React.startTransition(() =>
      root.render(
        <PhaseMarkers>
          <Img onLoad={onLoadSpy} />
          <Yield />
          <Text text={'a'} />
        </PhaseMarkers>,
      ),
    );

    // 渲染并 yield，以在提交前捕获 img 的 src attribute 与 property 状态。
    await waitFor(['render start', 'Img default', 'Yield']);
    const img = last(images);
    const renderSrcProperty = img.src;
    const renderSrcAttr = img.getAttribute('src');

    // 完成渲染并提交，导致 `src` 属性被重写
    await waitForAll(['a', 'last layout', 'last passive']);
    const commitSrcProperty = img.src;
    const commitSrcAttr = img.getAttribute('src');

    // 确保 attribute 与 property 一致。
    expect(renderSrcProperty).toBe(commitSrcProperty);
    expect(renderSrcAttr).toBe(commitSrcAttr);
  });

  /** 测试场景：验证「captures the load event for Blob sources if it happens before commit phase」描述的渲染、交互或错误处理结果。 */
  it('captures the load event for Blob sources if it happens before commit phase', async function () {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    const blob = new Blob();

    React.startTransition(() =>
      root.render(
        <PhaseMarkers>
          <Img src={blob} onLoad={onLoadSpy} />
          <Yield />
          <Text text={'a'} />
        </PhaseMarkers>,
      ),
    );

    await waitFor(['render start', 'Img [object Blob]', 'Yield']);
    const img = last(images);
    loadImage(img);
    assertLog([
      'actualLoadSpy [[object Blob]]',
      // 由于尚未完成渲染，onLoadSpy 尚未被调用。
    ]);
    await waitForAll(['a', 'load triggered', 'last layout', 'last passive']);
    expect(img.__needsDispatch).toBe(true);
    loadImage(img);
    assertLog([
      'actualLoadSpy [[object Blob]]', // 浏览器重新加载图像会使这里再次 yield。
      'onLoadSpy [[object Blob]]',
    ]);
    expect(onLoadSpy).toHaveBeenCalled();
  });

  /** 测试场景：验证「captures the load event for Blob sources if it happens after commit phase and replays it」描述的渲染、交互或错误处理结果。 */
  it('captures the load event for Blob sources if it happens after commit phase and replays it', async function () {
    const container = document.createElement('div');
    const root = ReactDOMClient.createRoot(container);

    const blob = new Blob();

    React.startTransition(() =>
      root.render(
        <PhaseMarkers>
          <Img src={blob} onLoad={onLoadSpy} />
        </PhaseMarkers>,
      ),
    );

    await waitFor([
      'render start',
      'Img [object Blob]',
      'load triggered',
      'last layout',
    ]);
    Scheduler.unstable_requestPaint();
    const img = last(images);
    loadImage(img);
    assertLog(['actualLoadSpy [[object Blob]]', 'onLoadSpy [[object Blob]]']);
    await waitForAll(['last passive']);
    expect(img.__needsDispatch).toBe(false);
    expect(onLoadSpy).toHaveBeenCalledTimes(1);
  });
});
