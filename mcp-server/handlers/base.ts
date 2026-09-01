/**
 * 工具处理器基类
 */

import type { ToolHandler, ToolAnnotations, JSONSchema, ExecutionContext } from '../core/types.js';

export abstract class BaseToolHandler<TArgs = any, TResult = any>
  implements ToolHandler<TArgs, TResult>
{
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly inputSchema: JSONSchema;
  abstract readonly annotations: ToolAnnotations;

  abstract execute(args: TArgs, context: ExecutionContext): Promise<TResult>;

  /**
   * 必填但允许传空串的参数名。
   *
   * 空串对多数参数意味着"忘了填"，但对另一些参数是一条确切的指令：清掉图标、删掉标签。
   * 一刀切拒空串，等于把工具描述里写着的用法直接堵死——set_icon(icon: "") 曾因此完全
   * 无法调用，而 batch_replace_tag 撞上同一件事时是把参数改成可选绕过去的，两处修法
   * 还不一致（PF-54 第二轮）。
   *
   * 与其一处处打补丁，不如让工具自己声明：空串在这个参数上是不是一个有意义的值。
   * 判断方法很简单——工具描述里如果写了"empty string 会怎样"，就把它列在这里。
   */
  readonly allowEmpty: readonly string[] = [];

  /**
   * 默认的参数验证（子类可覆盖）
   *
   * 这里管的是"参数名写错了会怎样"。以前少传或写错一个必填参数不会被拦下，工具带着
   * undefined 继续跑，内核返回 null，调用方拿到的是一句 Cannot read properties of null
   * 或者一个光秃秃的 null——读起来像"这个文档是空的"，而不是"你把参数名写错了"。有人
   * 据此认定整片文档区是空壳，差点用重写覆盖掉真实文档（PF-50、PF-52）。
   *
   * 所以：必填项缺失或为空要报错，未声明的顶层参数也要报错并列出可用参数名。空值判断
   * 只认 undefined/null/空串——false 和 0 是合法取值，不能当成缺失。
   */
  validate(args: any): args is TArgs {
    const properties = this.inputSchema.properties ?? {};
    const known = Object.keys(properties);

    if (args && typeof args === 'object' && known.length) {
      const unknown = Object.keys(args).filter((key) => !known.includes(key));
      if (unknown.length) {
        throw new Error(
          `${this.name}: unknown argument${unknown.length > 1 ? 's' : ''} ${unknown.map((k) => `"${k}"`).join(', ')}. ` +
            `Accepted: ${known.join(', ')}. Rejected rather than ignored, because a dropped argument looks exactly like one that was honoured — ` +
            `a misnamed id makes a read tool answer about nothing at all.`
        );
      }
    }

    for (const field of this.inputSchema.required ?? []) {
      const value = args?.[field];
      const emptyString = value === '' && !this.allowEmpty.includes(field);
      if (value === undefined || value === null || emptyString) {
        throw new Error(
          `${this.name}: required argument "${field}" is ${args && field in args ? 'empty' : 'missing'}. ` +
            `Accepted arguments: ${known.join(', ')}.`
        );
      }
    }

    return true;
  }

  /**
   * 包装执行，添加日志和错误处理
   */
  async safeExecute(args: any, context: ExecutionContext): Promise<TResult> {
    context.logger.debug(`Executing tool: ${this.name}`, args);

    try {
      this.validate(args);
      const result = await this.execute(args, context);
      context.logger.debug(`Tool ${this.name} completed successfully`);
      return result;
    } catch (error) {
      context.logger.error(`Tool ${this.name} failed:`, error);
      throw error;
    }
  }
}
