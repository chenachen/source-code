import fs from 'node:fs/promises'
import path from 'node:path'
import type { CopyOptions } from 'node:fs'
import type { TestProject } from 'vitest/node'
import type { BrowserServer } from 'playwright-chromium'
import { chromium } from 'playwright-chromium'

let browserServer: BrowserServer | undefined
/** 从测试文件路径提取第一层 playground 名，用于确定本次需要复制的 fixture 集合。 */
const PLAYGROUND_NAME_REGEX = /playground\/([\w-]+)\//

/**
 * 为整个 e2e project 启动 Chromium Server，注入连接地址，并准备可修改的 playground-temp 副本。
 * 每个测试文件再由 vitestSetup 创建自己的 page；共享目录与专用 variant 副本在这里统一复制。
 */
export async function setup(project: TestProject): Promise<void> {
  browserServer = await chromium.launchServer({
    headless: !process.env.VITE_DEBUG_SERVE,
    args: process.env.CI
      ? ['--no-sandbox', '--disable-setuid-sandbox']
      : undefined,
  })

  project.provide('wsEndpoint', browserServer.wsEndpoint())

  const tempDir = path.resolve(import.meta.dirname, '../playground-temp')
  const testFiles = project.vitest.state.getPaths()
  const playgroundDirs = [
    ...new Set(testFiles.map((file) => file.match(PLAYGROUND_NAME_REGEX)?.[1])),
  ]
  // 多个 playground 共用 tsconfig 与链接包目标，不能仅复制由 spec 路径推导的目录。
  const commonPlaygroundDirs = ['tsconfig.json', 'resolve-linked']

  await fs.rm(tempDir, { recursive: true, force: true })
  await fs.mkdir(tempDir, { recursive: true })
  await Promise.all(
    [...commonPlaygroundDirs, ...playgroundDirs].map(async (dir) => {
      const srcDir = path.resolve(import.meta.dirname, dir)
      const destDir = path.resolve(tempDir, dir)
      await copyWithFriendlyError(srcDir, destDir, {
        recursive: true,
        filter: filterForPlaygroundCopy,
      })
    }),
  )
  // 这几个 variant 会改文件或读取不同构建输出，给它们独立副本，避免与普通场景共用目录。
  const dedicatedCopyList: Record<string, string[]> = {
    assets: ['encoded-base', 'relative-base', 'runtime-base', 'url-base'],
    css: ['lightningcss'],
    'transform-plugin': ['base'],
  }
  const cpPromises = []
  for (const testFile of testFiles) {
    const testName = testFile.match(PLAYGROUND_NAME_REGEX)?.[1]
    const variantName = path.basename(path.dirname(testFile))
    if (variantName === '__tests__') continue
    if (testName && dedicatedCopyList[testName]?.includes(variantName)) {
      const srcDir = path.resolve(import.meta.dirname, testName)
      const destDir = path.resolve(tempDir, `${testName}__${variantName}`)
      cpPromises.push(
        copyWithFriendlyError(srcDir, destDir, {
          recursive: true,
          filter: filterForPlaygroundCopy,
        }),
      )
    }
  }
  await Promise.all(cpPromises)
}

/** 关闭全局 Chromium Server；只有显式保留构建产物时才留下 playground-temp 供排查。 */
export async function teardown(): Promise<void> {
  await browserServer?.close()
  if (!process.env.VITE_PRESERVE_BUILD_ARTIFACTS) {
    await fs.rm(path.resolve(import.meta.dirname, '../playground-temp'), {
      recursive: true,
    })
  }
}

/** 复制 fixture；Windows symlink 权限错误转换为 Developer Mode 提示，其他错误原样抛出。 */
function copyWithFriendlyError(
  src: string,
  dest: string,
  opts?: CopyOptions,
): Promise<void> {
  return fs.cp(src, dest, opts).catch(async (error) => {
    if (error.code === 'EPERM' && error.syscall === 'symlink') {
      throw new Error(
        'Could not create symlinks. On Windows, consider activating Developer Mode to allow non-admin users to create symlinks by following the instructions at https://docs.microsoft.com/en-us/windows/apps/get-started/enable-your-device-for-development.',
      )
    } else {
      throw error
    }
  })
}

/** 规范化分隔符后排除测试源码和旧 dist，保证测试修改副本且本轮构建不复用旧产物。 */
function filterForPlaygroundCopy(file: string): boolean {
  file = file.replace(/\\/g, '/')
  return !file.includes('__tests__') && !/dist(?:\/|$)/.test(file)
}
