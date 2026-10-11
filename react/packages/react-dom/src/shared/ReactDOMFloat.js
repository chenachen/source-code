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
 * DEV检查非空href及多余第二参数，实际派发只检查href为字符串，因此空字符串仍交dispatcher。
 * 本层不做资源去重或DOM写入；默认/客户端/Fizz/Flight dispatcher各自解释D槽。
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
  // 非字符串href不派发；空字符串仍由dispatcher决定是否处理。
}

/**
 * 请求当前 DOM dispatcher 提前建立到资源源站的连接，并归一化 CORS 选项。
 * 运行时只要求href为字符串，options有值时取crossOrigin并归一化，无值时传null；
 * DEV对options类型的诊断不会自行终止后续派发，宿主负责提示去重与输出。
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
  // C槽接收归一化跨域值；是否创建连接提示由当前dispatcher实现决定。
}

/**
 * href须为字符串、options须是非null对象且as须为字符串才进入L槽；DEV非空诊断
 * 与此运行时类型门分开，空href/as仍会派发。font跨域由getCrossOriginStringAs强制归一化，
 * 其它可选字段只保留字符串；本层不缓存身份，也不等待下载完成。
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
  // 不满足上述类型门就不派发；通过后资源的创建/请求与去重归当前renderer。
}

/** href为字符串就进入m槽；options有值时按字段类型投影，as=script省略以采用默认值，其它字符串as保留，无options时传短参数形状。DEV诊断不替代运行期派发门，空href也会转交。 */
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
  // 模块资源身份与重复提示处理由m槽实现维护。
}

/**
 * href为字符串、options有值且as为字符串时继续，只把as=style/script路由到S/X槽。
 * style把precedence单独传递，script另保留nonce；其它字符串选项按类型过滤。
 * 这是加载并应用资源的preinit协议，实际宿主效果由当前dispatcher执行，本层没有等待/回调。
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
  // as既不是style也不是script时，即使其为字符串也没有匹配派发分支。
}

/** href为字符串且options为非null对象时只接受as缺省/null/script，再把归一化选项交M槽；options缺失/null走无选项形状，其它类型不派发。模块脚本创建与去重由renderer处理，DEV非空诊断本身不取消调用。 */
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
  // M槽只承接这里筛选出的模块脚本请求，不处理其它模块as类型。
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
