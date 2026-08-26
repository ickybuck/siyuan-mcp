/**
 * 导出所有工具处理器
 */

export { BaseToolHandler } from './base.js';

// 搜索相关
export * from './search.js';

// 文档相关
export * from './document.js';

// 块相关
export * from './block.js';

// 数据库相关
export * from './av.js';

// 笔记本相关
export * from './notebook.js';

// 快照相关
export * from './snapshot.js';

// 标签相关
export * from './tag.js';

import {
  UnifiedSearchHandler,
} from './search.js';
import {
  GetDocumentContentHandler,
  CreateDocumentHandler,
  AppendToDocumentHandler,
  UpdateDocumentHandler,
  AppendToDailyNoteHandler,
  MoveDocumentsHandler,
  GetDocumentTreeHandler,
  RemoveDocumentHandler,
  RenameDocumentHandler,
  SetDocSortModeHandler,
  SetSortHandler,
  SaveDocumentAsTemplateHandler,
} from './document.js';
import {
  GetBlockKramdownHandler,
  UpdateBlockHandler,
  AppendBlockHandler,
  InsertBlockBeforeHandler,
  InsertBlockAfterHandler,
  DeleteBlockHandler,
  MoveBlockHandler,
  GetChildBlocksHandler,
  PrependBlockHandler,
  FoldBlockHandler,
  UnfoldBlockHandler,
} from './block.js';
import {
  CreateDatabaseHandler,
  AddDatabaseFieldsHandler,
  AddDatabaseRowsWithValuesHandler,
  AddBoundDatabaseRowsWithValuesHandler,
  ConvertDatabaseRowsToDocumentsHandler,
  SetDatabaseCellsHandler,
  ListUnusedDatabasesHandler,
  RemoveUnusedDatabasesHandler,
  UpdateDatabaseFieldHandler,
  ConfigureSelectOptionsHandler,
  GetNextSequenceValueHandler,
  ConfigureRelationFieldHandler,
  ConfigureRollupFieldHandler,
  ResolveDatabaseIdsHandler,
  ReplaceDatabaseBlocksHandler,
  EmbedDatabaseHandler,
  RenderDatabaseHandler,
  GetDatabaseHandler,
  GetDatabasePrimaryKeyValuesHandler,
  SearchDatabasesHandler,
  SetDatabaseCellHandler,
  AddDatabaseRowsHandler,
  RemoveDatabaseRowsHandler,
  ChangeDatabaseLayoutHandler,
  SetDatabaseGroupHandler,
  GetDatabaseFilterSortHandler,
  SetDatabaseFiltersHandler,
  SetDatabaseSortsHandler,
  AddDatabaseFieldHandler,
  RemoveDatabaseFieldHandler,
  SortDatabaseFieldHandler,
  SortDatabaseViewFieldHandler,
  ConfigureNewItemTemplatesHandler,
  CreateDatabaseRowFromTemplateHandler,
  CreateDatabaseRowFromTemplateWithMarkdownHandler,
} from './av.js';
import {
  ListNotebooksHandler,
  GetRecentlyUpdatedDocumentsHandler,
  CreateNotebookHandler,
} from './notebook.js';
import {
  CreateSnapshotHandler,
  ListSnapshotsHandler,
  RollbackSnapshotHandler,
} from './snapshot.js';
import {
  ListAllTagsHandler,
  ReplaceTagHandler,
} from './tag.js';

// 工厂函数：创建所有处理器实例
export function createAllHandlers() {
  return [
    // 搜索
    new UnifiedSearchHandler(), // 统一搜索

    // 文档
    new GetDocumentContentHandler(),
    new CreateDocumentHandler(),
    new AppendToDocumentHandler(),
    new UpdateDocumentHandler(),
    new AppendToDailyNoteHandler(),
    new MoveDocumentsHandler(),
    new GetDocumentTreeHandler(),
    new RemoveDocumentHandler(),
    new RenameDocumentHandler(),
    new SetDocSortModeHandler(),
    new SetSortHandler(),
    new SaveDocumentAsTemplateHandler(),

    // 块
    new GetBlockKramdownHandler(),
    new UpdateBlockHandler(),
    new AppendBlockHandler(),
    new InsertBlockBeforeHandler(),
    new InsertBlockAfterHandler(),
    new DeleteBlockHandler(),
    new MoveBlockHandler(),
    new GetChildBlocksHandler(),
    new PrependBlockHandler(),
    new FoldBlockHandler(),
    new UnfoldBlockHandler(),

    // 数据库
    new CreateDatabaseHandler(),
    new AddDatabaseFieldsHandler(),
    new AddDatabaseRowsWithValuesHandler(),
    new AddBoundDatabaseRowsWithValuesHandler(),
    new ConvertDatabaseRowsToDocumentsHandler(),
    new SetDatabaseCellsHandler(),
    new ListUnusedDatabasesHandler(),
    new RemoveUnusedDatabasesHandler(),
    new UpdateDatabaseFieldHandler(),
    new ConfigureSelectOptionsHandler(),
    new GetNextSequenceValueHandler(),
    new ConfigureRelationFieldHandler(),
    new ConfigureRollupFieldHandler(),
    new ResolveDatabaseIdsHandler(),
    new ReplaceDatabaseBlocksHandler(),
    new EmbedDatabaseHandler(),
    new RenderDatabaseHandler(),
    new GetDatabaseHandler(),
    new GetDatabasePrimaryKeyValuesHandler(),
    new SearchDatabasesHandler(),
    new SetDatabaseCellHandler(),
    new AddDatabaseRowsHandler(),
    new RemoveDatabaseRowsHandler(),
    new ChangeDatabaseLayoutHandler(),
    new SetDatabaseGroupHandler(),
    new GetDatabaseFilterSortHandler(),
    new SetDatabaseFiltersHandler(),
    new SetDatabaseSortsHandler(),
    new AddDatabaseFieldHandler(),
    new RemoveDatabaseFieldHandler(),
    new SortDatabaseFieldHandler(),
    new SortDatabaseViewFieldHandler(),
    new ConfigureNewItemTemplatesHandler(),
    new CreateDatabaseRowFromTemplateHandler(),
    new CreateDatabaseRowFromTemplateWithMarkdownHandler(),

    // 笔记本
    new ListNotebooksHandler(),
    new GetRecentlyUpdatedDocumentsHandler(),
    new CreateNotebookHandler(),

    // 快照
    new CreateSnapshotHandler(),
    new ListSnapshotsHandler(),
    new RollbackSnapshotHandler(),

    // 标签
    new ListAllTagsHandler(),
    new ReplaceTagHandler(),
  ];
}
