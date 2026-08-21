/**
 * jest-dom 匹配器类型声明（编译期）
 *
 * 运行时注册由 src/test-setup.ts 的 `expect.extend(matchers)` 完成；
 * 此文件仅为 tsc 补充 `toBeInTheDocument` / `toHaveAttribute` 等匹配器
 * 的类型信息，使 `tsc -b --noEmit` 通过。
 *
 * `@testing-library/jest-dom/vitest` 通过 `declare module 'vitest'` 向
 * vitest 的 Assertion / AsymmetricMatchersContaining 接口追加
 * TestingLibraryMatchers，import 该模块即应用类型增强。
 */
import '@testing-library/jest-dom/vitest';
