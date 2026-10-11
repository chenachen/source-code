// vitestGlobalSetup.ts 为此 base 变体复制独立 fixture 目录；tests() 注册相同依赖 watch 场景，在不同 base 下复用。
import { tests } from '../tests'

tests()
