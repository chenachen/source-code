import { capitalize, hyphenate, isArray, isString } from '@vue/shared'
import { camelize, warn } from '@vue/runtime-core'
import {
  type VShowElement,
  vShowHidden,
  vShowOriginalDisplay,
} from '../directives/vShow'
import { CSS_VAR_TEXT } from '../helpers/useCssVars'

/** VNode style 的运行时形态：cssText 字符串、属性对象或移除。 */
type Style = string | Record<string, string | string[]> | null

/** 检查 cssText 是否显式控制 display，供 v-show 协调优先级。 */
const displayRE = /(?:^|;)\s*display\s*:/

/**
 * 增量更新元素 style。
 *
 * 对象语法先删除旧对象中缺失的键，再逐项写新值；字符串语法直接替换 cssText，但保留
 * `useCssVars()` 注入文本。最后与 v-show 协调：记录绑定 display，隐藏态仍强制 none。
 */
export function patchStyle(el: Element, prev: Style, next: Style): void {
  const style = (el as HTMLElement).style
  const isCssString = isString(next)
  let hasControlledDisplay = false
  if (next && !isCssString) {
    if (prev) {
      if (!isString(prev)) {
        for (const key in prev) {
          if (next[key] == null) {
            setStyle(style, key, '')
          }
        }
      } else {
        for (const prevStyle of prev.split(';')) {
          const key = prevStyle.slice(0, prevStyle.indexOf(':')).trim()
          if (next[key] == null) {
            setStyle(style, key, '')
          }
        }
      }
    }
    for (const key in next) {
      if (key === 'display') {
        hasControlledDisplay = true
      }
      const value = next[key]
      if (value != null) {
        if (
          !shouldPreserveTextareaResizeStyle(
            el,
            key,
            !isString(prev) && prev ? prev[key] : undefined,
            value,
          )
        ) {
          setStyle(style, key, value)
        }
      } else {
        setStyle(style, key, '')
      }
    }
  } else {
    if (isCssString) {
      if (prev !== next) {
        // #9821：cssText 整体覆盖会删除 useCssVars() 直接写入的 CSS 变量，需把保存的
        // CSS_VAR_TEXT 追加回来。
        const cssVarText = (style as any)[CSS_VAR_TEXT]
        if (cssVarText) {
          ;(next as string) += ';' + cssVarText
        }
        style.cssText = next as string
        hasControlledDisplay = displayRE.test(next)
      }
    } else if (prev) {
      el.removeAttribute('style')
    }
  }
  // vShowOriginalDisplay 字段存在表示同一元素还受 v-show 控制。
  if (vShowOriginalDisplay in el) {
    // 显示时应恢复本次 v-bind:style 的 display，而不是指令挂载时的旧值。
    el[vShowOriginalDisplay] = hasControlledDisplay ? style.display : ''
    // 隐藏状态下 v-show 优先于绑定 style，最终仍为 none。
    if ((el as VShowElement)[vShowHidden]) {
      style.display = 'none'
    }
  }
}

/** 检测未转义的末尾分号，style 对象值不应包含声明分隔符。 */
const semicolonRE = /[^\\];\s*$/
/** 从值尾部提取 `!important`，改用 setProperty priority 参数写入。 */
const importantRE = /\s*!important$/

/**
 * 写一个 CSS 属性，支持 fallback 值数组、自定义属性、自动前缀与 !important。
 */
function setStyle(
  style: CSSStyleDeclaration,
  name: string,
  val: string | string[],
) {
  if (isArray(val)) {
    val.forEach(v => setStyle(style, name, v))
  } else {
    if (val == null) val = ''
    if (__DEV__) {
      if (semicolonRE.test(val)) {
        warn(
          `Unexpected semicolon at the end of '${name}' style value: '${val}'`,
        )
      }
    }
    if (name.startsWith('--')) {
      // CSS 自定义属性保持原始 `--name`，不能 camelize 或自动前缀。
      style.setProperty(name, val)
    } else {
      const prefixed = autoPrefix(style, name)
      if (importantRE.test(val)) {
        // CSSStyleDeclaration 点赋值无法表达优先级，使用 setProperty 第三个参数。
        style.setProperty(
          hyphenate(prefixed),
          val.replace(importantRE, ''),
          'important',
        )
      } else {
        style[prefixed as any] = val
      }
    }
  }
}

/** 按浏览器历史前缀尝试顺序。 */
const prefixes = ['Webkit', 'Moz', 'ms']
/** 原始 style 名到当前浏览器支持 property 名的缓存。 */
const prefixCache: Record<string, string> = {}

/** 选择浏览器支持的无前缀/厂商前缀 property，并缓存结果。 */
function autoPrefix(style: CSSStyleDeclaration, rawName: string): string {
  const cached = prefixCache[rawName]
  if (cached) {
    return cached
  }
  let name = camelize(rawName)
  if (name !== 'filter' && name in style) {
    return (prefixCache[rawName] = name)
  }
  name = capitalize(name)
  for (let i = 0; i < prefixes.length; i++) {
    const prefixed = prefixes[i] + name
    if (prefixed in style) {
      return (prefixCache[rawName] = prefixed)
    }
  }
  return rawName
}

/**
 * 判断是否保留用户拖拽 textarea 后浏览器直接写入的 width/height。
 *
 * 当新旧 VNode 样式值相同，框架没有新的尺寸意图，不应把用户原生 resize 覆盖回旧值。
 * 目前只特判常见 textarea；其他可调整尺寸场景仍按普通 VNode style patch。
 */
function shouldPreserveTextareaResizeStyle(
  el: Element,
  key: string,
  prev: string | string[] | undefined,
  next: string | string[],
): boolean {
  return (
    el.tagName === 'TEXTAREA' &&
    (key === 'width' || key === 'height') &&
    isString(next) &&
    prev === next
  )
}
