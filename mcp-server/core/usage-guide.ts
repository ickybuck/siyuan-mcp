/**
 * SiYuan MCP 使用指南的正文。
 *
 * 单独成文件，是因为它同时供两个出口使用：MCP 提示词 siyuan-usage-guide，以及
 * get_usage_guide 工具。后者存在的理由是可验证性——只有提示词入口时，一个只有
 * 工具的客户端（包括本项目用来做交叉验证的另一个线程）读不到这份文本，于是
 * "指南里写没写某件事"这一类的 Findings 条目没法自己确认，只能靠人转述。
 */
export function getUsageGuide(): string {
  return `# SiYuan MCP — usage guide

Generic to any source system and any client. Report anything wrong or missing to the project's
Findings queue rather than working around it silently; a fix here reaches every caller.

Served two ways from one source: the MCP prompt \`siyuan-usage-guide\` and the \`get_usage_guide\`
tool. Use the tool to check what this guide actually says — including from a client that reads
tools but not prompts — rather than relying on someone's account of it.

## The one habit that matters

**Read back what you wrote.** Not as diligence — as the only way to know. Many of SiYuan's write
paths report success before doing the work, and some report success for work they discarded. The
tools here now catch the known cases and fail loudly instead, but the habit is what caught every
one of them, and it is what will catch the next.

Concretely: after a write, read the thing you wrote, not the page around it. A document-level read
can be satisfied by neighbouring content and hide a block-level loss — that exact mistake let one
bug destroy content in this project's own records three times before anyone noticed.

## Structure

Notebooks contain documents, which nest arbitrarily deep as sub-documents. Nesting is set by the
\`path\` argument on \`create_document\` (e.g. \`/parent/child\`); there is no separate move step for
a document created in the right place. Titles and paths take raw text, not HTML entities — em
dashes, \`®\` and emoji pass through cleanly.

## Choosing a tool

**Editing note text.** Prefer block-level tools. \`update_document\` rewrites a whole note;
\`update_block\` changes one block; \`append_to_document\` adds to the end without resending what is
already there. On a 10,000-word note that is the difference between resending everything and
sending a few hundred bytes. \`get_child_blocks\` is the discovery path for block IDs.

**\`update_block\` writes exactly one block.** Multi-block markdown is rejected up front, because
SiYuan stores the first block and discards the rest while reporting success. Use
\`update_document\` for a whole note, \`append_block\` for children, or \`insert_block_after\` once
per sibling. A list whose items are separated by blank lines counts as several blocks and will be
refused — remove the blank lines or use another tool.

**Reading.** \`get_document_content\` for whole notes, \`get_block_kramdown\` for one block's exact
source, \`unified_search\` to find things, \`get_document_tree\` for structure.

**Reading a database without dragging its text along.** \`render_database\` returns every column of
every row unless you pass \`fields\`, which limits it to the columns named — by field ID or exact
name — and trims the column definitions to match. On a database whose rows carry prose this is the
difference between a status check and a full re-read: a four-column read of a 27-row board went
from 219 KB to 78 KB, and a single column to 21 KB. Read cheaply enough that checking your own
work stays worth doing.

Two things not to assume. Hiding a column in a view does **not** shrink what the kernel returns —
the hidden flag is presentation only, and \`fields\` is deliberately independent of it. And
\`get_database\` is a schema tool that carries every cell value of every row along with the schema;
it is not the cheap read it looks like. For primary keys alone,
\`get_database_primary_key_values\` is cheaper than either.

## Cross-document links

A block reference is \`((block-id "anchor text"))\`. The ID must be a real block ID — use
\`unified_search\` or \`get_child_blocks\` to find it rather than guessing. Links survive renames
because they bind to the ID, not the title.

## Bulk import

Do not create rows one at a time. \`add_database_rows_with_values\` creates rows and sets every
cell in one request; \`create_database\` accepts a whole field schema in one call. A 3-row,
10-field database takes about 4 calls this way and roughly 45 without.

Every row must include a non-empty value for the primary-key field. \`add_database_rows_with_values\`
rejects the whole call up front, naming the row index, rather than let SiYuan silently create no
row for that entry while still reporting it written. This is specific to that tool's endpoint — if
a row genuinely needs a blank title, use \`add_database_rows\` and fill the rest in afterwards.

Recommended order:

1. \`create_snapshot\` — bulk writes are hard to undo without one
2. \`create_database\` with its \`fields\` schema and a \`name\`
3. \`add_database_rows_with_values\`, giving each row an \`item_id\`
4. \`embed_database\` to place it in a document
5. filters, sorts, grouping, layout — only after embedding
6. verify by **membership, not by count** — see below

**Verify by membership, not by count.** Pick several records you know are in the source —
including from the middle and end of the run, not just the first few — and confirm each is present
in the target, with \`render_database\`'s \`query\` parameter or \`get_database_primary_key_values\`
with a keyword. A total is not verification. A real import here lost a contiguous block of ~50 rows
while the total came back at 99 against a rough expectation of "about 90", and was declared
complete on that basis; it was caught only by searching for two specific entries and finding
nothing. Two counts that sum to a believable number tell you nothing about which rows are missing.

\`row_count\` echoes the rows *submitted*, not the rows written. It is a receipt for the request,
not evidence about the database.

**Consume a source page fully before advancing its cursor.** Cursor pagination has no concept of
partial consumption: once the next page is fetched, nothing records that the previous one had a
remainder. If a page cannot be finished in one go, record the boundary somewhere outside the
cursor. Across a long run where reader and writer may be different sessions, that loss is silent,
contiguous, and looks exactly like a complete import.

**\`item_id\` scheme, for a resumable import.** 14 digits, a hyphen, then 7 lowercase
alphanumerics, e.g. \`20230713000000-a3f9c2d\`. Build it as: the source row's *date only*
(\`YYYYMMDD\` + \`000000\`) — deliberately not time-of-day, since ambiguous time fields are what
produce silent collisions — plus the last 7 characters of the source's own record ID, which
inherits uniqueness rather than computing it. Re-sending a row whose \`item_id\` exists **updates
it in place**, which is what makes an interrupted import safely re-runnable. Without it, a retry
after a timeout doubles the data.

**Migration fidelity.** When a source field is ambiguous or inconsistently formatted, copy it
verbatim and log the data-quality issue separately. Reinterpreting source data mid-migration
silently changes what it means.

**Token-efficient bulk writes.** Build and validate the payload programmatically — row count, a
uniqueness check, one sample — rather than previewing it in conversation and then passing the same
data as a parameter, which doubles the cost for nothing. Select only the columns you need from the
source. \`chunk_size\` cuts round trips, not the token floor set by the row data itself.

**Write limits.** \`add_database_rows_with_values\` chunks internally at 100 rows per request and
single unchunked calls of 300+ are proven fine; the true ceiling is unmeasured and deliberately
not chased, so assume nothing beyond "300+ works". If a bulk operation throttles, check which side
is the bottleneck: a rate limit on the system being *read from* calls for backing off those reads,
not for shrinking SiYuan write batches that were never the constraint.

## Rows bound to real documents

A detached row lives only inside the database. A bound row points at a real document, which is what
you want when the row has a body — a character profile, an episode, a mystery entry.

**When the documents do not exist yet**, create the rows detached with all their values, then
convert the whole batch:

1. \`add_database_rows_with_values\` — one call, all rows, all values, detached
2. \`embed_database\` — the conversion needs the database block
3. \`render_database\` — collect the row IDs
4. \`convert_database_rows_to_documents\` — one call: a document per row, named from that row's
   primary key, rebound, keeping every value already on the row

Rows already bound are skipped and named in \`skipped_item_ids\`. Each chunk is one kernel
transaction that undoes its own documents if it fails.

**The conversion does not apply row-creation template defaults**, with either \`save_mode\`. The
kernel clones each row's existing values and reads the template only for save location and body.
That bites hardest where it is least visible: the rows being bulk-converted are usually the least
finished, and they end up looking like the most finished. Pass \`apply_template_defaults\` to write
them afterwards; without it the response warns whenever the database has templates with defaults.
The documents are created with **empty bodies** either way — for real per-row content use
\`create_database_row_from_template_with_markdown\` (one call per row), or carry the reference in a
*field* rather than a body, which stays queryable and survives someone editing the document.

**When the documents already exist**, use \`add_bound_database_rows_with_values\`: one call binds
them and writes their values. Row IDs come back in \`item_ids\`, keyed by block ID.

**A bound row's identity is its block ID.** There is no \`item_id\` here and passing one is
rejected rather than ignored — you do not need it, because re-binding a block that is already a row
updates that row in place instead of adding a second. Re-sending after an uncertain failure is
therefore already safe.

Neither tool accepts a primary-key value: a bound row takes its name from its document, and writing
the primary key only overrides the row's display text, leaving it disagreeing with the document's
own title. Rename the document instead.

The path is detached → bound. Neither tool goes the other way.

## Re-pointing rows at different blocks

\`replace_database_blocks\` takes a map keyed on **row ID**, not on the block a row is currently
bound to. That distinction has cost real time: an unmatched key is ignored by SiYuan without any
error, so a map keyed the other way used to return a confident success having changed nothing.
Keys are now validated and the call refused if any is not a current row; \`replaced\` is measured by
reading the bindings back, with \`requested\` alongside.

Row IDs come from \`render_database\` (\`rows[].id\`). Watch the naming trap in
\`get_database_primary_key_values\`: the row ID is the field called \`blockID\`, and the bound block
sits under \`block.id\`.

## Building a database schema

**Name the database.** \`create_database\` takes a \`name\`; without it SiYuan calls it "Untitled",
and a workspace of Untitled databases is genuinely hard to navigate. \`rename_database\` fixes one
afterwards. Three different things can be renamed here: the database (\`rename_database\`), a field
(\`update_database_field\`), and the document holding it (\`rename_document\`).

The primary key is auto-named "Primary Key" and placed first. \`update_database_field\` renames or
retypes a field without discarding values, except that the kernel refuses to retype a primary key —
that refusal is silent, so the tool rejects it first.

\`add_database_field\` appends to every view and registers the field in the database's global field
order. Both need doing explicitly, and the tool does them: SiYuan prepends a new table column to
the *left of the primary key* when given no position, and never adds the field to \`keyIDs\` at all,
which would leave it invisible to anything iterating that list. A second field with the same name
**and** type is refused, since two fields sharing a name make later writes addressed by name
ambiguous, and \`render_database\`'s name filter would show only one of them. Pass
\`allow_duplicate_name\` if two are genuinely wanted.

select/mSelect fields cannot declare their options at creation; the first row written to one
creates them implicitly, uncased and untrimmed. Use \`configure_select_options\` first to control
names and colours.

## Views

\`create_database_view\` adds a view — its own filters, sorts, grouping, layout and column
visibility over the same rows. \`set_database_field_visibility\` shows or hides one column in one
view.

**Configuring a view that is not the active one requires switching to it.** SiYuan resolves the
target view from the block for filters, sorts, grouping and layout; none of those endpoints take a
view ID at all. So: \`set_database_block_view\` to point the block at the view, apply the change,
switch back if needed.

And again, because it is the most common wrong assumption: hiding a column does not reduce what
\`render_database\` returns. Use \`fields\` for that.

## Row-creation templates

\`configure_new_item_templates\` sets a database's row-creation templates — SiYuan's equivalent of
Notion's page templates. A "detached" template pre-fills field defaults; a "document" template
also binds each new row to a real document.

It **replaces the whole template set**, not a merge — read \`newItemTemplates\` back from
\`get_database\` first if amending. select/mSelect defaults must already exist as options
(\`configure_select_options\` first): SiYuan discards *every* template in the call over one missing
option. That is checked here before the write, along with field types, and the template set is read
back afterwards so a discarded write raises an error instead of returning IDs for templates that
were never stored.

A document template's \`content_template_path\` resolves against the workspace's \`data/templates/\`
folder, not the document tree. Use \`save_document_as_template\` to produce a file to point at.

\`create_database_row_from_template\` creates a row from a template;
\`create_database_row_from_template_with_markdown\` does the same with fresh per-row content. A
template's \`primary_key_template\` wins over the per-row \`title\`, and the kernel still requires a
non-empty title on the call, so there is no per-row way to opt out — that combination is rejected.
Clear \`primary_key_template\`, or use \`create_database_row_from_template\`.

Rows created from a document template bind documents created as *children of the host document*,
so removing the host document cascade-deletes them.

## Relations between databases

A \`relation\` or \`rollup\` field is created inert — it exists and points at nothing. Wire it:

1. create and populate the target database
2. \`configure_relation_field\` to point the relation at it
3. write relation values as an array of target row IDs
4. \`configure_rollup_field\` last — it depends on a configured relation

That ordering is enforced, not merely advised: a rollup through a field that is not an already-
configured relation is rejected, as is a summarised field that does not exist in the related
database. SiYuan accepts both and simply never resolves the rollup, which looks exactly like the
inert field the tool exists to fix.

## Icons

\`set_icon\` covers documents, databases and notebooks. Pass the emoji itself or SiYuan's own form —
lowercase hex codepoints joined by hyphens, \`📖\` = \`1f4d6\`, \`✍️\` = \`270d-fe0f\`. The conversion is
handled for you, and it matters: the kernel silently blanks a value it does not recognise, and a
bare emoji character is one of those.

A database has no icon of its own — the icon belongs to a view, so \`set_icon\` sets it on the view
you name or the first one.

## Why writes can succeed without happening

Some configuration operations have no REST endpoint and go through \`/api/transactions\`, which
**queues** the work and answers \`code: 0\` before running it. Failures are reported to the SiYuan
interface, never to the caller. A success response from anything transaction-backed means
"accepted", not "done" — and no care taken reading that response can tell the difference.

The tools built on those operations — \`update_database_field\`, \`configure_select_options\`,
\`configure_relation_field\`, \`configure_rollup_field\`, \`configure_new_item_templates\`,
\`create_database_view\`, \`set_database_field_visibility\`, \`rename_database\`, \`set_icon\` — read
the database back and raise an error if the change is not there. Their success means the change is
real. Anywhere else, treat a success response as a claim to check.

## Limits, and what to do instead

These are kernel behaviours, not bugs to route around by trying harder:

- **\`search_databases\` returns at most 12 results**, a fixed limit with no total and no paging.
  The response now says \`truncated\` and gives \`embedded_database_count\` for comparison. Use it
  to find one database by a distinctive term; **never** to enumerate or audit them. An absent
  result is not evidence of absence.
- **\`/api/query/sql\` silently caps any statement without a \`LIMIT\`** at the workspace's search
  limit, 64 by default. "No LIMIT" means "64 rows, quietly". Anything reading through SQL must
  page explicitly.
- **\`unified_search\` matches ancestor blocks too**, because a list or list-item block carries its
  children's text. Those ancestors are dropped by default so counts are not inflated ~3× and so
  editing every hit cannot rewrite the same content twice; \`keep_nested_hits\` returns the raw
  form. A content search with \`types:["d"]\` searches every block and returns the documents they
  belong to — a document block's own content is only its title, so the literal reading would
  always return nothing.
- **Deleting unused databases requires naming them.** \`remove_unused_databases\` takes \`av_ids\`
  and refuses ids not currently unused. There is no sweep form: a database is "unused" for the
  moment between being created and embedded, so a blanket delete destroys whatever another session
  is midway through building.
- **No auto-increment field type.** \`get_next_sequence_value\` reads the current maximum and adds
  one; it is not atomic, so concurrent callers can collide. Derive IDs from stable source data
  where you can.
- **Formula/\`template\` field expressions cannot be set.** Deliberately not built — one formula
  column was found across a whole workspace migration.

## Values

Write cell values plainly — \`42\`, \`"2026-05-25"\`, \`"Done"\`, \`["A","B"]\`, \`true\`. The server
converts by field type. Dates as \`YYYY-MM-DD\` are read at local midnight in the instance's
timezone and render with no time; passing a UTC timestamp instead renders as the previous day west
of UTC. select/mSelect values are trimmed but not case-folded — "Done" and "done" become two
options, silently.

## Failure modes that are silent

- **View operations on a detached database** do nothing. Those tools require a \`block_id\` and
  fail fast instead.
- **Row ID versus bound block ID** are different identifiers; writing a cell with the wrong one
  stores a value that never appears. \`resolve_database_ids\` converts between them, returning an
  object keyed by the ID you asked about — not a positional array.
- **Grouping hides rows.** A grouped view can report \`rowCount\` above zero while returning an
  empty \`rows\` array. Clear the group before concluding data is missing.
- **The SQL index lags writes by 1–2 seconds.** A document created a moment ago may not appear in
  \`get_document_tree\` yet.
- **\`indexing\` is often what "no such document" looks like.** When a block ID is not in the block
  tree, SiYuan searches the filesystem for it, rate-limited to one call every three seconds; a
  second miss inside that window is refused with \`indexing\` rather than \`tree not found\`. During
  a burst of deletes this reads as a transient fault when the real cause is a stale ID.

## Reporting problems

This guide lags reality — anything wrong or missing belongs in the Project Findings database under
3.9.1 (\`Owner\` = \`Code\`), not worked around silently. Before filing:

- **Verify it is a tool bug, not a caller mistake**, by reading the result back. A success response
  proves nothing; a thrown error is not proof the tool is broken.
- **Give the exact call and the exact response.** Tool name, arguments, what came back, and what a
  read-back actually showed.
- **Scope the claim to what was tested.** "This endpoint does X" beats "the kernel does X" — one
  finding here was corrected precisely because a single endpoint's behaviour was generalised.
- **Say what you already ruled out.** It is the most useful part and the least often written down.

## Safety

- \`remove_document\` deletes child documents too.
- \`remove_database_rows\` deletes detached rows outright but only unbinds rows backed by real
  blocks; the underlying documents survive.
- \`remove_unused_databases\` is irreversible and now requires explicit IDs.
- \`create_snapshot\` before anything bulk. It is the only cheap undo.
`;
}
