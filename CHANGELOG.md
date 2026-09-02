# Changelog

Entries from 0.1.6 down are upstream's ([porkll/siyuan-mcp](https://github.com/porkll/siyuan-mcp)),
kept as they were written. Entries from 0.2.0 up are this fork's.

## [Unreleased]

## [0.2.0] - 2026-09-02

### Changed
- Package renamed to `siyuan-mcp-blocks`. Publishing under upstream's `@porkll` scope would imply
  an endorsement that does not exist, which Apache-2.0's trademark clause does not permit.
- `author`, `repository`, `bugs` and `homepage` now describe this fork. `license` stays
  `Apache-2.0`; upstream's author is credited in `contributors` and in `NOTICE`.

### Added
- `NOTICE` — attribution to upstream and the statement of modification.
- `MODIFICATIONS.md` — every inherited file that was changed, and everything added, as section 4(b)
  of the Apache License requires.
- README and README_zh: upstream attribution and licence provenance, and the AI-development notice
  extended to cover this fork's own code rather than only the code it inherits.

### Fixed
- The README's tool counts were stale (58); the server registers 76.

## [0.1.6] - 2025-10-27

### Improved
- 改进 `create_snapshot` 工具，现在返回有意义的成功信息（包括 success、memo、message 字段）
- 改进 `rollback_to_snapshot` 工具，现在返回有意义的成功信息（包括 success、snapshot_id、message 字段）

### Changed
- API 设计改进：所有工具现在都返回有意义的结果，而不是 void

## [0.1.5] - 2025-10-27

### Fixed
- 修复 MCP 服务器在处理返回 void 的工具时的响应格式错误
- 修复 snapshot 相关工具（create_snapshot, rollback_to_snapshot）在 MCP 客户端中报错的问题

## [0.1.4] - 2025-10-19

### Fixed
- 修复 snapshot API 的返回数据结构问题，确保 `getSnapshots` 返回完整的数据结构

### Added
- 新增标签（Tag）管理功能
  - `listAllTags()` - 列出所有文档标签
  - `searchByTag(tag, limit)` - 根据标签搜索文档
  - `replaceTag(oldTag, newTag)` - 批量替换标签
  - `removeTag(tag)` - 删除指定标签

- 新增统一搜索接口 `search(options)`
  - 支持按内容、标签、文件名等多种条件组合搜索
  - 可同时使用多个过滤条件

- 新增 MCP Server 工具
  - `siyuan_list_all_tags` - 列出所有标签
  - `siyuan_search_by_tag` - 根据标签搜索文档
  - `siyuan_replace_tag` - 批量替换标签
  - `siyuan_search` - 统一搜索工具（推荐使用）

### Changed
- 优化搜索功能，提供更灵活的查询选项
