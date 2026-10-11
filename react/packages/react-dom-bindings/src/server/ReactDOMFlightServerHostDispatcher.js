/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  CrossOriginEnum,
  PreloadImplOptions,
  PreloadModuleImplOptions,
  PreinitStyleOptions,
  PreinitScriptOptions,
  PreinitModuleScriptOptions,
} from 'react-dom/src/shared/ReactDOMTypes';

import {
  emitHint,
  getHints,
  resolveRequest,
} from 'react-server/src/ReactFlightServer';

import ReactDOMSharedInternals from 'shared/ReactDOMSharedInternals';

/** 安装 Flight 服务端提示派发器前的 DOM dispatcher，用于无活动请求时回退。 */
const previousDispatcher =
  ReactDOMSharedInternals.d; /* ReactDOMCurrentDispatcher */
ReactDOMSharedInternals.d /* ReactDOMCurrentDispatcher */ = {
  f /* flushSyncWork */: previousDispatcher.f /* flushSyncWork */,
  r /* requestFormReset */: previousDispatcher.r /* requestFormReset */,
  D /* prefetchDNS */: prefetchDNS,
  C /* preconnect */: preconnect,
  L /* preload */: preload,
  m /* preloadModule */: preloadModule,
  X /* preinitScript */: preinitScript,
  S /* preinitStyle */: preinitStyle,
  M /* preinitModuleScript */: preinitModuleScript,
};

/**
 * 为当前 Flight 请求发出 DNS 预取提示，并按 href 去重。
 * 无活动请求时委托给安装前 dispatcher，保持调用环境语义。
 */
function prefetchDNS(href: string) {
  if (typeof href === 'string' && href) {
    const request = resolveRequest();
    if (request) {
      const hints = getHints(request);
      const key = 'D|' + href;
      if (hints.has(key)) {
        // 同一请求已经发出等价提示。
        return;
      }
      hints.add(key);
      emitHint(request, 'D', href);
    } else {
      previousDispatcher.D(/* prefetchDNS */ href);
    }
  }
}

/** 只要求href为字符串（此层允许空字符串），按crossOrigin/href去重当前请求preconnect；null/undefined跨域统一键，字符串跨域值编码tuple，无请求委托旧dispatcher。 */
function preconnect(href: string, crossOrigin?: ?CrossOriginEnum) {
  if (typeof href === 'string') {
    const request = resolveRequest();
    if (request) {
      const hints = getHints(request);

      const key = `C|${crossOrigin == null ? 'null' : crossOrigin}|${href}`;
      if (hints.has(key)) {
        // 同一请求已经发出等价提示。
        return;
      }
      hints.add(key);
      if (typeof crossOrigin === 'string') {
        emitHint(request, 'C', [href, crossOrigin]);
      } else {
        emitHint(request, 'C', href);
      }
    } else {
      previousDispatcher.C(/* preconnect */ href, crossOrigin);
    }
  }
}

/**
 * 发出当前请求preload提示；href必须是字符串。图片srcSet/sizes优先于href作为身份，
 * 其它资源按as/href构造键；先入hints再发出，后续相同键的其它options不替换首个提示。
 * 无活动请求时委托旧dispatcher，当前模块不创建DOM元素或等待资源加载。
 */
export function preload(
  href: string,
  as: string,
  options?: ?PreloadImplOptions,
) {
  if (typeof href === 'string') {
    const request = resolveRequest();
    if (request) {
      const hints = getHints(request);
      let key = 'L';
      if (as === 'image' && options) {
        key += getImagePreloadKey(
          href,
          options.imageSrcSet,
          options.imageSizes,
        );
      } else {
        key += `[${as}]${href}`;
      }
      if (hints.has(key)) {
        // 同一请求已经发出等价提示。
        return;
      }
      hints.add(key);

      const trimmed = trimOptions(options);
      if (trimmed) {
        emitHint(request, 'L', [href, as, trimmed]);
      } else {
        emitHint(request, 'L', [href, as]);
      }
    } else {
      previousDispatcher.L(/* preload */ href, as, options);
    }
  }
}

/** 为当前请求发出模块 preload 提示，并移除空选项以压缩 Flight 负载。 */
export function preloadModule(
  href: string,
  options?: ?PreloadModuleImplOptions,
): void {
  if (typeof href === 'string') {
    const request = resolveRequest();
    if (request) {
      const hints = getHints(request);
      const key = 'm|' + href;
      if (hints.has(key)) {
        // 同一请求已经发出等价提示。
        return;
      }
      hints.add(key);

      const trimmed = trimOptions(options);
      if (trimmed) {
        return emitHint(request, 'm', [href, trimmed]);
      } else {
        return emitHint(request, 'm', href);
      }
    } else {
      previousDispatcher.m(/* preloadModule */ href, options);
    }
  }
}

/** 发出样式 preinit 提示；缺省 precedence 用紧凑的短模型编码。 */
function preinitStyle(
  href: string,
  precedence: ?string,
  options?: ?PreinitStyleOptions,
) {
  if (typeof href === 'string') {
    const request = resolveRequest();
    if (request) {
      const hints = getHints(request);
      const key = 'S|' + href;
      if (hints.has(key)) {
        // 同一请求已经发出等价提示。
        return;
      }
      hints.add(key);

      const trimmed = trimOptions(options);
      if (trimmed) {
        return emitHint(request, 'S', [
          href,
          typeof precedence === 'string' ? precedence : 0,
          trimmed,
        ]);
      } else if (typeof precedence === 'string') {
        return emitHint(request, 'S', [href, precedence]);
      } else {
        return emitHint(request, 'S', href);
      }
    } else {
      previousDispatcher.S(/* preinitStyle */ href, precedence, options);
    }
  }
}

/** 为普通脚本发出并去重 preinit 提示。 */
function preinitScript(src: string, options?: ?PreinitScriptOptions) {
  if (typeof src === 'string') {
    const request = resolveRequest();
    if (request) {
      const hints = getHints(request);
      const key = 'X|' + src;
      if (hints.has(key)) {
        // 同一请求已经发出等价提示。
        return;
      }
      hints.add(key);

      const trimmed = trimOptions(options);
      if (trimmed) {
        return emitHint(request, 'X', [src, trimmed]);
      } else {
        return emitHint(request, 'X', src);
      }
    } else {
      previousDispatcher.X(/* preinitScript */ src, options);
    }
  }
}

/** 为模块脚本发出并去重 preinit 提示。 */
function preinitModuleScript(
  src: string,
  options?: ?PreinitModuleScriptOptions,
) {
  if (typeof src === 'string') {
    const request = resolveRequest();
    if (request) {
      const hints = getHints(request);
      const key = 'M|' + src;
      if (hints.has(key)) {
        // 同一请求已经发出等价提示。
        return;
      }
      hints.add(key);

      const trimmed = trimOptions(options);
      if (trimmed) {
        return emitHint(request, 'M', [src, trimmed]);
      } else {
        return emitHint(request, 'M', src);
      }
    } else {
      previousDispatcher.M(/* preinitModuleScript */ src, options);
    }
  }
}

/**
 * 移除提示选项中的 null/undefined 字段，避免 Flight 用特殊字符编码无效键而膨胀负载。
 * 用for-in复制所有非空字段（含可枚举继承字段），保留false/0/空字符串，不修改输入；
 * options缺失或没有保留字段时返回null，使调用者选更短的wire tuple。
 * 类型安全前提：这些选项字段全为可选，null/undefined与缺失在提示协议中具有相同语义。
 */
function trimOptions<
  T:
    | PreloadImplOptions
    | PreloadModuleImplOptions
    | PreinitStyleOptions
    | PreinitScriptOptions
    | PreinitModuleScriptOptions,
>(options: ?T): ?T {
  if (options == null) return null;
  let hasProperties = false;
  const trimmed: T = {} as any;
  for (const key in options) {
    // $FlowFixMe[invalid-computed-prop]
    if (options[key] != null) {
      hasProperties = true;
      (trimmed as any)[key] = options[key];
    }
  }
  return hasProperties ? trimmed : null;
}

/**
 * 构造图片preload键；imageSrcSet为非空字符串时忽略href，sizes为字符串则追加对应段；
 * 其它情况使用空占位段加href。分隔符保持图片键与其它as键区分，不解析srcSet候选。
 */
function getImagePreloadKey(
  href: string,
  imageSrcSet: ?string,
  imageSizes: ?string,
) {
  let uniquePart = '';
  if (typeof imageSrcSet === 'string' && imageSrcSet !== '') {
    uniquePart += '[' + imageSrcSet + ']';
    if (typeof imageSizes === 'string') {
      uniquePart += '[' + imageSizes + ']';
    }
  } else {
    uniquePart += '[][]' + href;
  }
  return `[image]${uniquePart}`;
}
