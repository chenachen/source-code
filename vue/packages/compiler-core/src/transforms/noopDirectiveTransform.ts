import type { DirectiveTransform } from '../transform'

/**
 * 明确消费指令、但不生成任何 props 或运行时指令的空转换器。
 * 平台编译器可用它声明“该指令已处理”，避免被当作未知自定义指令保留到运行时。
 */
export const noopDirectiveTransform: DirectiveTransform = () => ({ props: [] })
