/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */
import type {
  PreconnectOptions,
  PreloadOptions,
  PreloadModuleOptions,
  PreinitOptions,
  PreinitModuleOptions,
} from './ReactDOMTypes';

import ReactDOMSharedInternals from 'shared/ReactDOMSharedInternals';

import {
  getCrossOriginString,
  getCrossOriginStringAs,
} from 'react-dom-bindings/src/shared/crossOriginStrings';

/**
 * 请求当前 DOM dispatcher 为主机名发出 DNS 预取提示。
 * 无效输入仅在开发态诊断；生产态乐观跳过，因为资源提示属于可选性能优化。
 */
export function prefetchDNS(href: string) {
  if (__DEV__) {
    if (typeof href !== 'string' || !href) {
      console.error(
        'ReactDOM.prefetchDNS(): Expected the `href` argument (first) to be a non-empty string but encountered %s instead.',
        getValueDescriptorExpectingObjectForWarning(href),
      );
    } else if (arguments.length > 1) {
      const options = arguments[1];
      if (
        typeof options === 'object' &&
        options.hasOwnProperty('crossOrigin')
      ) {
        console.error(
          'ReactDOM.prefetchDNS(): Expected only one argument, `href`, but encountered %s as a second argument instead. This argument is reserved for future options and is currently disallowed. It looks like the you are attempting to set a crossOrigin property for this DNS lookup hint. Browsers do not perform DNS queries using CORS and setting this attribute on the resource hint has no effect. Try calling ReactDOM.prefetchDNS() with just a single string argument, `href`.',
          getValueDescriptorExpectingEnumForWarning(options),
        );
      } else {
        console.error(
          'ReactDOM.prefetchDNS(): Expected only one argument, `href`, but encountered %s as a second argument instead. This argument is reserved for future options and is currently disallowed. Try calling ReactDOM.prefetchDNS() with just a single string argument, `href`.',
          getValueDescriptorExpectingEnumForWarning(options),
        );
      }
    }
  }
  if (typeof href === 'string') {
    ReactDOMSharedInternals.d /* ReactDOMCurrentDispatcher */
      .D(/* prefetchDNS */ href);
  }
  // 资源提示可能从多种作用域调用，运行时也可能无法响应；它不影响正确性，故无效时静默退出。
}

/**
 * 请求当前 DOM dispatcher 提前建立到资源源站的连接，并归一化 CORS 选项。
 * 调用只提供优化提示，不保证底层宿主一定执行。
 */
export function preconnect(href: string, options?: ?PreconnectOptions) {
  if (__DEV__) {
    if (typeof href !== 'string' || !href) {
      console.error(
        'ReactDOM.preconnect(): Expected the `href` argument (first) to be a non-empty string but encountered %s instead.',
        getValueDescriptorExpectingObjectForWarning(href),
      );
    } else if (options != null && typeof options !== 'object') {
      console.error(
        'ReactDOM.preconnect(): Expected the `options` argument (second) to be an object but encountered %s instead. The only supported option at this time is `crossOrigin` which accepts a string.',
        getValueDescriptorExpectingEnumForWarning(options),
      );
    } else if (options != null && typeof options.crossOrigin !== 'string') {
      console.error(
        'ReactDOM.preconnect(): Expected the `crossOrigin` option (second argument) to be a string but encountered %s instead. Try removing this option or passing a string value instead.',
        getValueDescriptorExpectingObjectForWarning(options.crossOrigin),
      );
    }
  }
  if (typeof href === 'string') {
    const crossOrigin = options
      ? getCrossOriginString(options.crossOrigin)
      : null;
    ReactDOMSharedInternals.d /* ReactDOMCurrentDispatcher */
      .C(/* preconnect */ href, crossOrigin);
  }
  // 资源提示不影响渲染正确性；宿主不支持或输入无效时静默跳过。
}

/**
 * 校验并归一化 `<link rel="preload">` 选项，再交给当前 dispatcher 去重和写入宿主提示。
 */
export function preload(href: string, options: PreloadOptions) {
  if (__DEV__) {
    let encountered = '';
    if (typeof href !== 'string' || !href) {
      encountered += ` The \`href\` argument encountered was ${getValueDescriptorExpectingObjectForWarning(
        href,
      )}.`;
    }
    if (options == null || typeof options !== 'object') {
      encountered += ` The \`options\` argument encountered was ${getValueDescriptorExpectingObjectForWarning(
        options,
      )}.`;
    } else if (typeof options.as !== 'string' || !options.as) {
      encountered += ` The \`as\` option encountered was ${getValueDescriptorExpectingObjectForWarning(
        options.as,
      )}.`;
    }
    if (encountered) {
      console.error(
        'ReactDOM.preload(): Expected two arguments, a non-empty `href` string and an `options` object with an `as` property valid for a `<link rel="preload" as="..." />` tag.%s',
        encountered,
      );
    }
  }
  if (
    typeof href === 'string' &&
    // 公共 JS 调用无法由 Flow 强制类型，必须运行时确认 options 确实存在且为对象。
    typeof options === 'object' &&
    // $FlowFixMe[invalid-compare]
    options !== null &&
    typeof options.as === 'string'
  ) {
    const as = options.as;
    const crossOrigin = getCrossOriginStringAs(as, options.crossOrigin);
    ReactDOMSharedInternals.d /* ReactDOMCurrentDispatcher */
      .L(/* preload */ href, as, {
        crossOrigin,
        integrity:
          typeof options.integrity === 'string' ? options.integrity : undefined,
        nonce: typeof options.nonce === 'string' ? options.nonce : undefined,
        type: typeof options.type === 'string' ? options.type : undefined,
        fetchPriority:
          typeof options.fetchPriority === 'string'
            ? options.fetchPriority
            : undefined,
        referrerPolicy:
          typeof options.referrerPolicy === 'string'
            ? options.referrerPolicy
            : undefined,
        imageSrcSet:
          typeof options.imageSrcSet === 'string'
            ? options.imageSrcSet
            : undefined,
        imageSizes:
          typeof options.imageSizes === 'string'
            ? options.imageSizes
            : undefined,
        media: typeof options.media === 'string' ? options.media : undefined,
      });
  }
  // preload 是可选性能提示；宿主不支持或输入无效时静默跳过，不破坏应用正确性。
}

/** 校验模块预加载选项，并请求 dispatcher 发出 `modulepreload` 提示。 */
export function preloadModule(href: string, options?: ?PreloadModuleOptions) {
  if (__DEV__) {
    let encountered = '';
    if (typeof href !== 'string' || !href) {
      encountered += ` The \`href\` argument encountered was ${getValueDescriptorExpectingObjectForWarning(
        href,
      )}.`;
    }
    if (options !== undefined && typeof options !== 'object') {
      encountered += ` The \`options\` argument encountered was ${getValueDescriptorExpectingObjectForWarning(
        options,
      )}.`;
    } else if (options && 'as' in options && typeof options.as !== 'string') {
      encountered += ` The \`as\` option encountered was ${getValueDescriptorExpectingObjectForWarning(
        options.as,
      )}.`;
    }
    if (encountered) {
      console.error(
        'ReactDOM.preloadModule(): Expected two arguments, a non-empty `href` string and, optionally, an `options` object with an `as` property valid for a `<link rel="modulepreload" as="..." />` tag.%s',
        encountered,
      );
    }
  }
  if (typeof href === 'string') {
    if (options) {
      const crossOrigin = getCrossOriginStringAs(
        options.as,
        options.crossOrigin,
      );
      ReactDOMSharedInternals.d /* ReactDOMCurrentDispatcher */
        .m(/* preloadModule */ href, {
          as:
            typeof options.as === 'string' && options.as !== 'script'
              ? options.as
              : undefined,
          crossOrigin,
          integrity:
            typeof options.integrity === 'string'
              ? options.integrity
              : undefined,
          nonce: typeof options.nonce === 'string' ? options.nonce : undefined,
          fetchPriority:
            typeof options.fetchPriority === 'string'
              ? options.fetchPriority
              : undefined,
        });
    } else {
      ReactDOMSharedInternals.d /* ReactDOMCurrentDispatcher */
        .m(/* preloadModule */ href);
    }
  }
  // 模块预加载只优化时序；宿主不支持或输入无效时静默跳过。
}

/**
 * 根据 `as` 把资源预初始化请求路由到样式或脚本 dispatcher 槽，并过滤无效属性类型。
 */
export function preinit(href: string, options: PreinitOptions) {
  if (__DEV__) {
    if (typeof href !== 'string' || !href) {
      console.error(
        'ReactDOM.preinit(): Expected the `href` argument (first) to be a non-empty string but encountered %s instead.',
        getValueDescriptorExpectingObjectForWarning(href),
      );
    } else if (options == null || typeof options !== 'object') {
      console.error(
        'ReactDOM.preinit(): Expected the `options` argument (second) to be an object with an `as` property describing the type of resource to be preinitialized but encountered %s instead.',
        getValueDescriptorExpectingEnumForWarning(options),
      );
    } else if (options.as !== 'style' && options.as !== 'script') {
      console.error(
        'ReactDOM.preinit(): Expected the `as` property in the `options` argument (second) to contain a valid value describing the type of resource to be preinitialized but encountered %s instead. Valid values for `as` are "style" and "script".',
        getValueDescriptorExpectingEnumForWarning(options.as),
      );
    }
  }
  if (typeof href === 'string' && options && typeof options.as === 'string') {
    const as = options.as;
    const crossOrigin = getCrossOriginStringAs(as, options.crossOrigin);
    const integrity =
      typeof options.integrity === 'string' ? options.integrity : undefined;
    const fetchPriority =
      typeof options.fetchPriority === 'string'
        ? options.fetchPriority
        : undefined;
    if (as === 'style') {
      ReactDOMSharedInternals.d /* ReactDOMCurrentDispatcher */
        .S(
          /* preinitStyle */
          href,
          typeof options.precedence === 'string'
            ? options.precedence
            : undefined,
          {
            crossOrigin,
            integrity,
            fetchPriority,
          },
        );
    } else if (as === 'script') {
      ReactDOMSharedInternals.d /* ReactDOMCurrentDispatcher */
        .X(/* preinitScript */ href, {
          crossOrigin,
          integrity,
          fetchPriority,
          nonce: typeof options.nonce === 'string' ? options.nonce : undefined,
        });
    }
  }
  // preinit 不影响正确性；调用环境无法处理时静默跳过。
}

/** 校验模块预初始化请求；当前只支持 script，并转发到模块脚本 dispatcher 槽。 */
export function preinitModule(href: string, options?: ?PreinitModuleOptions) {
  if (__DEV__) {
    let encountered = '';
    if (typeof href !== 'string' || !href) {
      encountered += ` The \`href\` argument encountered was ${getValueDescriptorExpectingObjectForWarning(
        href,
      )}.`;
    }
    if (options !== undefined && typeof options !== 'object') {
      encountered += ` The \`options\` argument encountered was ${getValueDescriptorExpectingObjectForWarning(
        options,
      )}.`;
    } else if (options && 'as' in options && options.as !== 'script') {
      encountered += ` The \`as\` option encountered was ${getValueDescriptorExpectingEnumForWarning(
        options.as,
      )}.`;
    }
    if (encountered) {
      console.error(
        'ReactDOM.preinitModule(): Expected up to two arguments, a non-empty `href` string and, optionally, an `options` object with a valid `as` property.%s',
        encountered,
      );
    } else {
      const as =
        options && typeof options.as === 'string' ? options.as : 'script';
      switch (as) {
        case 'script': {
          break;
        }

  // `as` 不是当前支持的 script 类型，开发态需要发出警告以说明扩展边界。
        default: {
          const typeOfAs = getValueDescriptorExpectingEnumForWarning(as);
          console.error(
            'ReactDOM.preinitModule(): Currently the only supported "as" type for this function is "script"' +
              ' but received "%s" instead. This warning was generated for `href` "%s". In the future other' +
              ' module types will be supported, aligning with the import-attributes proposal. Learn more here:' +
              ' (https://github.com/tc39/proposal-import-attributes)',
            typeOfAs,
            href,
          );
        }
      }
    }
  }
  if (typeof href === 'string') {
    if (typeof options === 'object' && options !== null) {
      if (options.as == null || options.as === 'script') {
        const crossOrigin = getCrossOriginStringAs(
          options.as,
          options.crossOrigin,
        );
        ReactDOMSharedInternals.d /* ReactDOMCurrentDispatcher */
          .M(/* preinitModuleScript */ href, {
            crossOrigin,
            integrity:
              typeof options.integrity === 'string'
                ? options.integrity
                : undefined,
            nonce:
              typeof options.nonce === 'string' ? options.nonce : undefined,
            fetchPriority:
              typeof options.fetchPriority === 'string'
                ? options.fetchPriority
                : undefined,
          });
      }
    } else if (options == null) {
      ReactDOMSharedInternals.d /* ReactDOMCurrentDispatcher */
        .M(/* preinitModuleScript */ href);
    }
  }
  // 模块预初始化是可选优化；运行时无法处理时静默退出。
}

/** 为“期望对象/非空字符串”的开发态诊断生成稳定值描述，避免直接强制转换用户对象。 */
function getValueDescriptorExpectingObjectForWarning(thing: any): string {
  return thing === null
    ? '`null`'
    : thing === undefined
      ? '`undefined`'
      : thing === ''
        ? 'an empty string'
        : `something with type "${typeof thing}"`;
}

/** 为枚举型开发态诊断生成稳定值描述，并安全表示字符串与数字。 */
function getValueDescriptorExpectingEnumForWarning(thing: any): string {
  return thing === null
    ? '`null`'
    : thing === undefined
      ? '`undefined`'
      : thing === ''
        ? 'an empty string'
        : typeof thing === 'string'
          ? JSON.stringify(thing)
          : typeof thing === 'number'
            ? '`' + thing + '`'
            : `something with type "${typeof thing}"`;
}
