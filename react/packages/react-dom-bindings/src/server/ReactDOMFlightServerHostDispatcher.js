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

/** 按 crossOrigin 与 href 为当前请求发出并去重 preconnect 提示。 */
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
 * 发出资源 preload 提示；图片使用 srcSet/sizes 构造与浏览器选择逻辑一致的去重键。
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
 * 类型安全前提：这些选项字段全为可选，null/undefined 与属性缺失具有相同语义。
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
 * 构造图片 preload 的去重键；有 srcSet 时它优先于 href，并把 sizes 纳入身份。
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
