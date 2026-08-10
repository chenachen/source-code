import type { SuspenseBoundary } from './components/Suspense'
import type {
  VNode,
  VNodeNormalizedRef,
  VNodeNormalizedRefAtom,
  VNodeRef,
} from './vnode'
import {
  EMPTY_OBJ,
  NO,
  ShapeFlags,
  hasOwn,
  isArray,
  isFunction,
  isString,
  remove,
} from '@vue/shared'
import { isAsyncWrapper } from './apiAsyncComponent'
import { warn } from './warning'
import { isRef, toRaw } from '@vue/reactivity'
import { ErrorCodes, callWithErrorHandling } from './errorHandling'
import { type SchedulerJob, SchedulerJobFlags } from './scheduler'
import { queuePostRenderEffect } from './renderer'
import { type ComponentOptions, getComponentPublicInstance } from './component'
import { isTemplateRefKey, knownTemplateRefs } from './helpers/useTemplateRef'

/**
 * 尚未执行的非空模板 ref 赋值任务。
 *
 * 动态 ref 在同一渲染周期内改变或卸载时，可据此把旧任务标记为 DISPOSED，避免 post
 * 阶段把过期节点重新写回。WeakMap 不会延长 VNode ref 描述对象生命周期。
 */
const pendingSetRefMap = new WeakMap<VNodeNormalizedRef, SchedulerJob>()

/**
 * 根据 VNode 的挂载/更新/卸载结果维护模板 ref。
 *
 * 支持字符串 ref、`Ref` 对象、函数 ref、`v-for` 数组 ref 和兼容层生成的 ref key。
 * 非空赋值延迟到渲染提交后，确保组件公开实例和 DOM 已完整挂载；清空则同步执行，
 * 防止同名新 ref 先赋值后又被旧节点的延迟卸载覆盖。
 */
export function setRef(
  rawRef: VNodeNormalizedRef,
  oldRawRef: VNodeNormalizedRef | null,
  parentSuspense: SuspenseBoundary | null,
  vnode: VNode,
  isUnmount = false,
): void {
  if (isArray(rawRef)) {
    rawRef.forEach((r, i) =>
      setRef(
        r,
        oldRawRef && (isArray(oldRawRef) ? oldRawRef[i] : oldRawRef),
        parentSuspense,
        vnode,
        isUnmount,
      ),
    )
    return
  }

  if (isAsyncWrapper(vnode) && !isUnmount) {
    // #4999：异步组件通常会把 ref 转发给解析后的内部组件；但若它已解析且被 KeepAlive
    // 缓存，包装器 setup 不会重新走转发流程，此时需沿缓存子树直接设置真实组件 ref。
    if (
      vnode.shapeFlag & ShapeFlags.COMPONENT_KEPT_ALIVE &&
      (vnode.type as ComponentOptions).__asyncResolved &&
      vnode.component!.subTree.component
    ) {
      setRef(rawRef, oldRawRef, parentSuspense, vnode.component!.subTree)
    }

    // 其他异步包装器由 `createInnerComp()` 转发 ref，此处不应让 ref 短暂指向包装器。
    return
  }

  const refValue =
    vnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT
      ? getComponentPublicInstance(vnode.component!)
      : vnode.el
  const value = isUnmount ? null : refValue

  const { i: owner, r: ref } = rawRef
  if (__DEV__ && !owner) {
    warn(
      `Missing ref owner context. ref cannot be used on hoisted vnodes. ` +
        `A vnode with ref must be created inside the render function.`,
    )
    return
  }
  const oldRef = oldRawRef && (oldRawRef as VNodeNormalizedRefAtom).r
  const refs = owner.refs === EMPTY_OBJ ? (owner.refs = {}) : owner.refs
  const setupState = owner.setupState
  const rawSetupState = toRaw(setupState)
  const canSetSetupRef =
    setupState === EMPTY_OBJ
      ? NO
      : (key: string) => {
          if (__DEV__) {
            if (hasOwn(rawSetupState, key) && !isRef(rawSetupState[key])) {
              warn(
                `Template ref "${key}" used on a non-ref value. ` +
                  `It will not work in the production build.`,
              )
            }

            if (knownTemplateRefs.has(rawSetupState[key] as any)) {
              return false
            }
          }

          // `useTemplateRef()` 已用 `$refs` 访问器同步自己的 shallowRef；再次写 setupState
          // 会绕过只读约束并产生重复来源，因此跳过。
          if (isTemplateRefKey(refs, key)) {
            return false
          }

          return hasOwn(rawSetupState, key)
        }

  const canSetRef = (ref: VNodeRef, key?: string) => {
    if (__DEV__ && knownTemplateRefs.has(ref as any)) {
      return false
    }
    if (key && isTemplateRefKey(refs, key)) {
      return false
    }
    return true
  }

  // 动态 ref 名称/对象变化：先撤销旧的待处理任务并清空旧目标，再写入新目标。
  if (oldRef != null && oldRef !== ref) {
    invalidatePendingSetRef(oldRawRef!)
    if (isString(oldRef)) {
      refs[oldRef] = null
      if (canSetSetupRef(oldRef)) {
        setupState[oldRef] = null
      }
    } else if (isRef(oldRef)) {
      // 上方已排除 null，这里可安全收窄成携带 key/for 标志的原子 ref 描述。
      const oldRawRefAtom = oldRawRef as VNodeNormalizedRefAtom
      if (canSetRef(oldRef, oldRawRefAtom.k)) {
        oldRef.value = null
      }
      if (oldRawRefAtom.k) refs[oldRawRefAtom.k] = null
    }
  }

  if (isFunction(ref)) {
    callWithErrorHandling(ref, owner, ErrorCodes.FUNCTION_REF, [value, refs])
  } else {
    const _isString = isString(ref)
    const _isRef = isRef(ref)

    if (_isString || _isRef) {
      const doSet = () => {
        if (rawRef.f) {
          // `ref_for`（通常来自 v-for）维护值数组：挂载去重追加，卸载只删除当前节点。
          const existing = _isString
            ? canSetSetupRef(ref)
              ? setupState[ref]
              : refs[ref]
            : canSetRef(ref) || !rawRef.k
              ? ref.value
              : refs[rawRef.k]
          if (isUnmount) {
            isArray(existing) && remove(existing, refValue)
          } else {
            if (!isArray(existing)) {
              if (_isString) {
                refs[ref] = [refValue]
                if (canSetSetupRef(ref)) {
                  setupState[ref] = refs[ref]
                }
              } else {
                const newVal = [refValue]
                if (canSetRef(ref, rawRef.k)) {
                  ref.value = newVal
                }
                if (rawRef.k) refs[rawRef.k] = newVal
              }
            } else if (!existing.includes(refValue)) {
              existing.push(refValue)
            }
          }
        } else if (_isString) {
          refs[ref] = value
          if (canSetSetupRef(ref)) {
            setupState[ref] = value
          }
        } else if (_isRef) {
          if (canSetRef(ref, rawRef.k)) {
            ref.value = value
          }
          if (rawRef.k) refs[rawRef.k] = value
        } else if (__DEV__) {
          warn('Invalid template ref type:', ref, `(${typeof ref})`)
        }
      }
      if (value) {
        // #1789：非空 ref 在 render 完成后赋值，确保拿到最终 DOM/组件实例，并排在普通
        // post 钩子前（job.id = -1）。清空必须同步：若新旧节点共用 ref key，延迟清空
        // 可能在新节点已赋值后把它错误覆盖成 null。
        const job: SchedulerJob = () => {
          doSet()
          pendingSetRefMap.delete(rawRef)
        }
        job.id = -1
        pendingSetRefMap.set(rawRef, job)
        queuePostRenderEffect(job, parentSuspense)
      } else {
        invalidatePendingSetRef(rawRef)
        doSet()
      }
    } else if (__DEV__) {
      warn('Invalid template ref type:', ref, `(${typeof ref})`)
    }
  }
}

/** 取消某个 ref 尚未执行的 post-render 赋值，防止动态切换后写入陈旧实例。 */
function invalidatePendingSetRef(rawRef: VNodeNormalizedRef) {
  const pendingSetRef = pendingSetRefMap.get(rawRef)
  if (pendingSetRef) {
    pendingSetRef.flags! |= SchedulerJobFlags.DISPOSED
    pendingSetRefMap.delete(rawRef)
  }
}
