/**
 * 使用指南工具处理器
 */

import { BaseToolHandler } from './base.js';
import type { ExecutionContext, JSONSchema } from '../core/types.js';
import { getUsageGuide } from '../core/usage-guide.js';

/**
 * 以工具的形式返回使用指南全文。
 *
 * 内容与 MCP 提示词 siyuan-usage-guide 完全相同，两处共用同一个来源。之所以还要有
 * 这个工具：提示词入口不是每个客户端都能取到，只有工具的调用方读不到这份文本，于是
 * "指南里到底写没写某件事"这类问题只能靠人转述才能确认——本项目就因此卡住过两条
 * Findings。可读即可验证，这个工具存在的意义就在这里。
 */
export class GetUsageGuideHandler extends BaseToolHandler<
  { section?: string },
  string
> {
  readonly name = 'get_usage_guide';
  readonly annotations = { readOnlyHint: true } as const;
  readonly description =
    'Return this server\'s own usage guide — which tool to reach for, the ordering constraints that matter, and the failure modes that are silent rather than loud. Identical to the MCP prompt siyuan-usage-guide, served as a tool so a client that reads tools but not prompts can still get it, and so a claim about what the guide says can be checked rather than taken on trust. Pass section to return one section instead of the whole guide.';
  readonly inputSchema: JSONSchema = {
    type: 'object',
    properties: {
      section: {
        type: 'string',
        description:
          'Return only the section whose heading contains this text, case-insensitively (e.g. "bulk import"). Omit for the whole guide. An unmatched value returns the list of available headings rather than nothing.',
      },
    },
    required: [],
  };

  async execute(args: { section?: string }, _context: ExecutionContext): Promise<string> {
    const guide = getUsageGuide();
    const wanted = args.section?.trim();
    if (!wanted) return guide;

    // 按二级标题切分：第一段是标题前的引言，之后每段以一个 "## " 标题开头
    const parts = guide.split(/\n(?=## )/);
    const match = parts.find((part) => {
      const heading = part.split('\n', 1)[0];
      return heading.startsWith('## ') && heading.toLowerCase().includes(wanted.toLowerCase());
    });
    if (match) return match.trim();

    const headings = parts
      .map((part) => part.split('\n', 1)[0])
      .filter((heading) => heading.startsWith('## '))
      .map((heading) => heading.slice(3).trim());
    return `No section heading contains "${wanted}". Available sections: ${headings.join(' · ')}.`;
  }
}
