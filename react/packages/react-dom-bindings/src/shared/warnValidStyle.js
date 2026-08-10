/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/** 识别首字母未大写的非微软厂商前缀；`msTransform` 本身是正确形式。 */
const badVendoredStyleNamePattern = /^(?:webkit|moz|o)[A-Z]/;
/** 识别连字符形式的微软前缀，用于转为 React 接受的 `msXxx`。 */
const msPattern = /^-ms-/;
/** 捕获连字符后的字符，以便转为 camelCase。 */
const hyphenPattern = /-(.)/g;

/** 识别不应出现在 React style 值末尾的分号。 */
const badStyleValueWithSemicolonPattern = /;\s*$/;

/** 已警告过的样式名，避免同一拼写重复报告。 */
const warnedStyleNames = {};
/** 已警告过的样式值，避免同一错误值重复报告。 */
const warnedStyleValues = {};
/** 是否已经报告 NaN；该类警告全局仅需一次。 */
let warnedForNaNValue = false;
/** 是否已经报告 Infinity；该类警告全局仅需一次。 */
let warnedForInfinityValue = false;

/** 将连字符属性名转换为 camelCase，供修正建议使用。 */
function camelize(string) {
  /** 把每个连字符后的字符转换为大写。 */
  return string.replace(hyphenPattern, function (_, character) {
    return character.toUpperCase();
  });
}

/** 对连字符形式的 React style 属性名发出一次 camelCase 建议。 */
function warnHyphenatedStyleName(name) {
  if (__DEV__) {
    if (warnedStyleNames.hasOwnProperty(name) && warnedStyleNames[name]) {
      return;
    }

    warnedStyleNames[name] = true;
    console.error(
      'Unsupported style property %s. Did you mean %s?',
      name,
      // 按 Andi Smith 的建议
      //（http://www.andismith.com/blog/2012/02/modernizr-prefixed/），`-ms` 前缀转为小写 `ms`。
      camelize(name.replace(msPattern, 'ms-')),
    );
  }
}

/** 对错误小写的 Webkit/Moz/O 前缀发出一次首字母大写建议。 */
function warnBadVendoredStyleName(name) {
  if (__DEV__) {
    if (warnedStyleNames.hasOwnProperty(name) && warnedStyleNames[name]) {
      return;
    }

    warnedStyleNames[name] = true;
    console.error(
      'Unsupported vendor-prefixed style property %s. Did you mean %s?',
      name,
      name.charAt(0).toUpperCase() + name.slice(1),
    );
  }
}

/** 对末尾携带分号的 style 值发出一次移除分号建议。 */
function warnStyleValueWithSemicolon(name, value) {
  if (__DEV__) {
    if (warnedStyleValues.hasOwnProperty(value) && warnedStyleValues[value]) {
      return;
    }

    warnedStyleValues[value] = true;
    console.error(
      "Style property values shouldn't contain a semicolon. " +
        'Try "%s: %s" instead.',
      name,
      value.replace(badStyleValueWithSemicolonPattern, ''),
    );
  }
}

/** 对首个 NaN 数值样式发出开发警告。 */
function warnStyleValueIsNaN(name, value) {
  if (__DEV__) {
    if (warnedForNaNValue) {
      return;
    }

    warnedForNaNValue = true;
    console.error(
      '`NaN` is an invalid value for the `%s` css style property.',
      name,
    );
  }
}

/** 对首个无限数值样式发出开发警告。 */
function warnStyleValueIsInfinity(name, value) {
  if (__DEV__) {
    if (warnedForInfinityValue) {
      return;
    }

    warnedForInfinityValue = true;
    console.error(
      '`Infinity` is an invalid value for the `%s` css style property.',
      name,
    );
  }
}

/**
 * 执行 React style 的开发期拼写和值域检查。
 * 顺序上先检查名称/分号，再独立检查数值是否为 NaN 或 Infinity。
 */
function warnValidStyle(name, value) {
  if (__DEV__) {
    if (name.indexOf('-') > -1) {
      warnHyphenatedStyleName(name);
    } else if (badVendoredStyleNamePattern.test(name)) {
      warnBadVendoredStyleName(name);
    } else if (badStyleValueWithSemicolonPattern.test(value)) {
      warnStyleValueWithSemicolon(name, value);
    }

    if (typeof value === 'number') {
      if (isNaN(value)) {
        warnStyleValueIsNaN(name, value);
      } else if (!isFinite(value)) {
        warnStyleValueIsInfinity(name, value);
      }
    }
  }
}

export default warnValidStyle;
