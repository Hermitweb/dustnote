/**
 * 同步引擎：框架无关的离线队列重放编排（架构改进 #1）
 *
 * 旧实现：flushQueue 长在 web/store.ts 的 zustand store 里，与 get()/set()/
 * api()/loadAll() 深度耦合，mobile/miniprogram 只能各自重写一套重放+退避+
 * 冲突丢弃逻辑。本模块把「重放编排」抽成纯逻辑，只依赖：
 * - 一个 OfflineQueue（队列操作）
 * - replayOp(op) 钩子（执行网络请求，由各端的 ApiClient 提供具体实现）
 * - onConflict(op, serverData) 钩子（409 时做字段级合并，见 conflict.ts）
 * - onFlushed(summary) 钩子（重放后回调，web 用来 loadAll 校正 + 标记在线）
 *
 * 关键改进：409 不再静默丢弃。当 op 携带 conflictCtx 时，SyncEngine 把
 * 服务端 current（409 响应体）交给 onConflict 钩子，由钩子解密 base/local/
 * server 后调用 resolveConflict 做字段级合并——无歧义自动重应用，有歧义
 * 推到 UI 让用户裁决。彻底消除「静默覆盖丢数据」。
 *
 * 重入守卫、串行重放、指数退避、网络不可达停止等语义与旧 flushQueue 一致，
 * 行为不回退。
 */

import type { OfflineQueue, QueuedOp } from './offline-queue.js';

/** 409 响应里服务端当前 NoteRow（由各端按其 Note 类型解释） */
export type ServerConflictData = unknown;

/**
 * 错误分类结果：null = 无法分类（按未知错误处理）。
 *
 * 用 `status: number | undefined` 而非可选属性 `status?: number`，避免
 * exactOptionalPropertyTypes 下 `{ status: undefined }` 不可赋值的问题。
 */
export interface ErrorClass {
  /** HTTP 状态码；undefined = 非 HTTP 错误（如 TypeError 网络故障） */
  status: number | undefined;
  /** 409 响应体 / ApiException.err.data 等附加数据 */
  data: unknown;
}

export interface SyncEngineHooks {
  /** 执行单条 op 的网络请求（成功 resolve，失败 reject） */
  replayOp(op: QueuedOp): Promise<unknown>;
  /**
   * 409 冲突处理钩子。
   * - serverData：409 响应体（含服务端 current NoteRow）
   * - 返回值：true = 已处理（如已自动重应用合并结果），false = 未处理（仅丢弃 op）
   * 钩子内部负责解密 + resolveConflict + 重新发起 PATCH / 推 UI 冲突。
   * 无论返回什么，SyncEngine 都会移除该 op（避免死循环）；钩子的「处理」
   * 指的是是否产生了新的重应用动作。
   */
  onConflict?(op: QueuedOp, serverData: ServerConflictData): Promise<boolean>;
  /** flush 完成回调 */
  onFlushed?(summary: FlushSummary): void;
  /**
   * 错误分类：把各端的异常类型（ApiException / Taro 错误 / RN fetch 错误）
   * 归一成 { status, data }。默认实现按 web 的 ApiException 鸭子类型判定。
   */
  classifyError?(err: unknown): ErrorClass | null;
}

export interface FlushSummary {
  hadConflict: boolean;
  /** 重放后剩余队列长度（0 = 全部成功，可标记在线） */
  remaining: number;
  /**
   * M3：本轮因写限流（429）中止——队列**完整保留**,未消耗任何重试预算。
   * 调用方应按服务端 Retry-After（或下次触发时机）稍后重试,并提示用户
   * 「同步受限」,不要把它当成同步完成。
   */
  rateLimited?: boolean;
}

/** 默认错误分类：识别 web ApiException({err:{status,data}}) 与 TypeError */
function defaultClassifyError(err: unknown): ErrorClass | null {
  // web ApiException: { err: { status, data } }
  const maybe = err as { err?: { status?: number; data?: unknown } };
  if (maybe && typeof maybe === 'object' && maybe.err && typeof maybe.err.status === 'number') {
    return { status: maybe.err.status, data: maybe.err.data };
  }
  // 网络故障（fetch 抛 TypeError）：无 HTTP 状态码
  if (err instanceof TypeError) {
    return { status: undefined, data: undefined };
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SyncEngine {
  private inFlight = false;

  constructor(
    private readonly queue: OfflineQueue,
    private readonly hooks: SyncEngineHooks
  ) {}

  /**
   * 串行重放离线队列。
   *
   * - 重入守卫：并发触发（online 事件 + 手动同步）只跑一次
   * - 409：调用 onConflict（若有）后移除 op，避免死循环
   * - 429：写限流——中止本轮,队列完整保留且不消耗重试预算（M3）
   * - 其余 4xx：客户端错误,不可恢复,移除 op
   * - 5xx：bumpRetries + 指数退避后继续下一条
   * - 网络不可达（TypeError）：停止重放，保留剩余 op
   * - 未知错误：丢弃 op，避免阻塞队列
   */
  async flush(): Promise<FlushSummary> {
    // 重入守卫：并发触发会 peek 到同一批 op 并重复执行
    if (this.inFlight) {
      return { hadConflict: false, remaining: await this.queue.size(), rateLimited: false };
    }
    this.inFlight = true;
    const classify = this.hooks.classifyError ?? defaultClassifyError;

    try {
      const ops = await this.queue.peekAll();
      if (ops.length === 0) {
        const summary: FlushSummary = { hadConflict: false, remaining: 0, rateLimited: false };
        this.hooks.onFlushed?.(summary);
        return summary;
      }

      let hadConflict = false;
      let rateLimited = false;
      for (const op of ops) {
        try {
          await this.hooks.replayOp(op);
          await this.queue.remove(op.id);
        } catch (err) {
          const cls = classify(err);
          const status = cls?.status;

          if (status === 409) {
            // 版本冲突：交给合并钩子，然后移除 op（避免死循环）
            if (this.hooks.onConflict) {
              try {
                await this.hooks.onConflict(op, cls?.data);
              } catch {
                // 合并钩子自身失败：不阻塞队列，丢弃 op
              }
            }
            await this.queue.remove(op.id);
            hadConflict = true;
          } else if (status === 429) {
            // M3：写限流**不消耗重试预算**——此前 bumpRetries 到阈值后 op 被
            // 静默永久删除（审计 C1 的同类问题只是被推迟），且删除后
            // getRetryDelayForOp 返回 0 不退避,循环立刻打下一个 op 反而加剧
            // 请求密度。现在直接中止本轮 flush：队列完整保留,由调用方按
            // 服务端 Retry-After / 下次触发时机重试,并据 rateLimited 提示用户。
            rateLimited = true;
            break;
          } else if (status !== undefined && status >= 400 && status < 500) {
            // 其他 4xx 客户端错误：不可恢复，丢弃
            await this.queue.remove(op.id);
            hadConflict = true;
          } else if (status !== undefined && status >= 500) {
            // 5xx：服务端可能恢复，保留 + 退避后继续
            await this.queue.bumpRetries(op.id);
            const delay = await this.queue.getRetryDelayForOp(op.id);
            if (delay > 0) await sleep(delay);
          } else if (cls !== null && status === undefined) {
            // 网络不可达（TypeError）：停止重放，保留剩余
            break;
          } else {
            // 未知错误：丢弃避免阻塞
            await this.queue.remove(op.id);
          }
        }
      }

      const remaining = await this.queue.size();
      const summary: FlushSummary = { hadConflict, remaining, rateLimited };
      this.hooks.onFlushed?.(summary);
      return summary;
    } finally {
      this.inFlight = false;
    }
  }
}
