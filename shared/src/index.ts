/**
 * DustNote 共享层入口
 */

export * from './time-format.js';

export * from './version.js';
export * from './update-check.js';
export * from './types.js';
export * from './crypto.js';
export * from './api.js';
// v2.0.0 单机/联机双模式
export * from './repository.js';
export * from './local-auth.js';
// v2.1.0 模板系统
export * from './templates.js';
// 跨端共用工具（内网地址判定等）——单一实现,避免各端语义漂移
export * from './net-utils.js';
// 服务端错误码 → i18n key 映射（客户端统一取词,不再硬匹配中文文案）
export * from './error-codes.js';
// 主题 token 生成器与种子表（UI 阶段 1.2 / 1.3，四端共用单一真相源）
export * from './theme-engine.js';
export * from './theme-seeds.js';
// 模式切换迁移的策略层（账本/轮数门禁/清槽判定）——三端单一实现,可单测
export * from './migration.js';
