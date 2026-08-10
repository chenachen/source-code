import { type ElementWithTransition, vtcKey } from '../components/Transition'

/**
 * 更新元素 class，并合并 Transition 临时添加的进出场 class。
 * 编译器已把同元素静态 class 与 `:class` 规范化为一个绑定；这里不能直接覆盖过渡类。
 */
export function patchClass(
  el: Element,
  value: string | null,
  isSVG: boolean,
): void {
  // HTML 直接写 className 更快；SVG 的 className 是 SVGAnimatedString，需 setAttribute。
  const transitionClasses = (el as ElementWithTransition)[vtcKey]
  if (transitionClasses) {
    value = (
      value ? [value, ...transitionClasses] : [...transitionClasses]
    ).join(' ')
  }
  if (value == null) {
    el.removeAttribute('class')
  } else if (isSVG) {
    el.setAttribute('class', value)
  } else {
    el.className = value
  }
}
