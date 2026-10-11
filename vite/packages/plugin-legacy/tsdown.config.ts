import { type UserConfig, defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  target: 'node20',
  tsconfig: false, // 打包时关闭 tsconfig paths 映射。
  dts: true,
  fixedExtension: false,
  deps: {
    onlyBundle: ['picocolors'],
  },
}) as UserConfig
