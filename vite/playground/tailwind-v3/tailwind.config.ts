import type { Config } from 'tailwindcss'

// Tailwind v3 配置加载在 Node 20 场景使用 __dirname。

export default {
  content: [
    // components/views glob 与 main.js 单文件项保持不重叠，分别覆盖两种内容监听方式。
    // https://github.com/vitejs/vite/pull/6959
    __dirname + '/src/{components,views}/**/*.js',
    __dirname + '/src/main.js',
  ],
  theme: {
    extend: {},
  },
  variants: {
    extend: {},
  },
  plugins: [],
} satisfies Config
