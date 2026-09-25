/**
 * 工具名前缀。
 *
 * 同一份代码可以被部署成多个实例，各自指向不同的工作区。默认情况下它们广播的是
 * 完全相同的工具名，于是同时启用两个连接器的客户端就得在一堆同名工具之间做选择，
 * 而这些工具写向的是不同的工作区——写错目标不会报错，只会静静地写进另一个库。
 *
 * 前缀把这个歧义消灭在名字上：`tvhsop_update_block` 和 `update_block` 不会被弄混。
 */

/** 归一化之后的前缀体允许的字符。MCP 工具名只允许字母、数字、下划线和连字符。 */
const VALID_PREFIX_BODY = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Several MCP clients reject tool names longer than this. Exceeding it does not
 * throw here — it is reported at boot so a deploy fails visibly rather than
 * having a handful of tools silently disappear from one client's list.
 */
export const MAX_TOOL_NAME_LENGTH = 64;

/**
 * 归一化前缀：小写，去掉尾部的分隔符，再统一补一个下划线。
 * 空值表示不加前缀，保持向后兼容。
 */
export function normalizeToolPrefix(raw?: string): string {
  if (!raw) return '';

  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return '';

  const body = trimmed.replace(/[_-]+$/, '');
  if (!body || !VALID_PREFIX_BODY.test(body)) {
    throw new Error(
      `Invalid tool prefix '${raw}': use lowercase letters, digits, underscores and hyphens, ` +
        'starting with a letter or digit (for example "tvhsop").'
    );
  }

  return `${body}_`;
}

/** 对外广播的工具名。 */
export function applyToolPrefix(prefix: string, name: string): string {
  return prefix ? `${prefix}${name}` : name;
}

/**
 * 把调用进来的名字还原成内部注册名。
 *
 * 配置了前缀就**必须**带前缀：返回 undefined 让调用方拒绝请求。放宽这一点会让前缀
 * 变成可选的装饰——一个带着旧工具列表的客户端会照着裸名继续调用，而这正是前缀要
 * 消除的那种歧义。拒绝是响亮的，且错误信息里带着正确的名字，恢复只要一次重试。
 */
export function stripToolPrefix(prefix: string, name: string): string | undefined {
  if (!prefix) return name;
  return name.startsWith(prefix) ? name.slice(prefix.length) : undefined;
}
