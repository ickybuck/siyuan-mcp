/**
 * 标题和路径里的 HTML 实体检查。
 *
 * 思源不解码实体：&amp; 存进去就是字面量的 &amp;，和 & 是两个不同的名字。在路径上
 * 这会让匹配落空，进而触发内核"凭空造一棵树"（PF-48）；在标题上则是直接存下一个
 * 显示错误的名字。
 *
 * 抽成一处，是因为这两个口子原本只堵了一个：create_document 拦得很好，rename_document
 * 一点不拦，于是这条已知失败路径隔着一次调用照样能走到（PF-60）。任何接收标题或路径的
 * 工具都该走这里。
 */

const ENTITY = /&(amp|lt|gt|quot|apos|#\d+|nbsp);/;

/**
 * @param value 待检查的标题或路径
 * @param what 参数名，用在报错文本里，例如 "path" / "title"
 * @param consequence 一句话说明"什么都没发生"，让调用方知道不用回滚
 */
export function rejectHtmlEntities(value: string, what: string, consequence: string): void {
  const found = ENTITY.exec(value ?? '');
  if (!found) return;

  throw new Error(
    `The ${what} contains the HTML entity "${found[0]}" — ${what}s are not HTML and SiYuan does not decode entities, ` +
      `so this would store a literal "${found[0]}" instead of the character you meant. Pass raw text: "&", not "&amp;". ${consequence}`
  );
}
