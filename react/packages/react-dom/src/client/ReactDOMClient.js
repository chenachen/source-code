/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {createRoot, hydrateRoot} from './ReactDOMRoot';

import {
  injectIntoDevTools,
  findHostInstance,
} from 'react-reconciler/src/ReactFiberReconciler';
import {canUseDOM} from 'shared/ExecutionEnvironment';
import ReactVersion from 'shared/ReactVersion';

import Internals from 'shared/ReactDOMSharedInternals';

import {ensureCorrectIsomorphicReactVersion} from '../shared/ensureCorrectIsomorphicReactVersion';
ensureCorrectIsomorphicReactVersion();

if (__DEV__) {
  if (
    typeof Map !== 'function' ||
    // $FlowFixMe[prop-missing] Flow incorrectly thinks Map has no prototype
    Map.prototype == null ||
    typeof Map.prototype.forEach !== 'function' ||
    typeof Set !== 'function' ||
    // $FlowFixMe[prop-missing] Flow incorrectly thinks Set has no prototype
    Set.prototype == null ||
    typeof Set.prototype.clear !== 'function' ||
    typeof Set.prototype.forEach !== 'function'
  ) {
    console.error(
      'React depends on Map and Set built-in types. Make sure that you load a ' +
        'polyfill in older browsers. https://react.dev/link/react-polyfills',
    );
  }
}

/**
 * 把类组件实例或宿主元素解析成当前提交树中的 DOM 节点。
 *
 * 这里仅负责把公开兼容 API 接到 reconciler 的宿主实例查询；函数随后还会被
 * 写入共享 internals，供其他 ReactDOM 入口复用同一实现。
 */
function findDOMNode(
  componentOrElement: component(...props: any),
): null | Element | Text {
  return findHostInstance(componentOrElement);
}

// 将兼容查询能力发布到共享槽位，避免其他入口反向依赖本文件。
Internals.findDOMNode = findDOMNode;

export {ReactVersion as version, createRoot, hydrateRoot};

/** DevTools 注入是否成功；仅用于决定开发环境是否提示安装扩展。 */
const foundDevTools = injectIntoDevTools();

if (__DEV__) {
  if (!foundDevTools && canUseDOM && window.top === window.self) {
    // 只在常见且支持扩展的 Chrome/Firefox 顶层页面提示下载，避免 iframe 重复提示。
    if (
      (navigator.userAgent.indexOf('Chrome') > -1 &&
        navigator.userAgent.indexOf('Edge') === -1) ||
      navigator.userAgent.indexOf('Firefox') > -1
    ) {
      const protocol = window.location.protocol;
      // chrome-extension:// 等特殊协议不适用普通下载提示，因此保持静默。
      if (/^(https?|file):$/.test(protocol)) {
        // eslint-disable-next-line react-internal/no-production-logging
        console.info(
          '%cDownload the React DevTools ' +
            'for a better development experience: ' +
            'https://react.dev/link/react-devtools' +
            (protocol === 'file:'
              ? '\nYou might need to use a local HTTP server (instead of file://): ' +
                'https://react.dev/link/react-devtools-faq'
              : ''),
          'font-weight:bold',
        );
      }
    }
  }
}
