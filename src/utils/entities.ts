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
/**
 * 把 kramdown IAL 属性值里的转义还原成原文。
 *
 * 写进去的是 &，读 IAL 读出来的是 &amp;——两边直接比较永远不相等。于是"标题里带 &
 * 的改名"每次都报 verified: false，而改名其实成功了（PF-65）。读回来比较之前先还原。
 *
 * 只认 XML 那五个实体加数字实体：这里处理的是内核的转义，不是用户输入。用户输入里
 * 出现实体是另一回事，那由 rejectHtmlEntities 在写入前拦下。
 */
export function unescapeIalValue(value: string): string {
  return (value ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    // &amp; 必须最后还原，否则 &amp;lt; 会被两步还原成 <
    .replace(/&amp;/g, '&');
}

export function rejectHtmlEntities(value: string, what: string, consequence: string): void {
  const found = ENTITY.exec(value ?? '');
  if (!found) return;

  throw new Error(
    `The ${what} contains the HTML entity "${found[0]}" — ${what}s are not HTML and SiYuan does not decode entities, ` +
      `so this would store a literal "${found[0]}" instead of the character you meant. Pass raw text: "&", not "&amp;". ${consequence}`
  );
}
