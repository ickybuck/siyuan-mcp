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

This guide is generic to any source system and any client — it is not written around one
particular migration. Report anything wrong or missing to the project's Findings queue rather
than silently working around it; a fix here reaches every caller.

Served two ways from one source: the MCP prompt \`siyuan-usage-guide\` and the \`get_usage_guide\`
tool. Use the tool to check what this guide actually says — including from a client that reads
tools but not prompts — rather than relying on someone's account of it.

## Structure

Notebooks contain documents, which can nest arbitrarily deep as sub-documents — there is no
separate space/page distinction to worry about. Nesting is set by the \`path\` argument on
\`create_document\` (e.g. \`/parent/child\`); there is no separate move step for a document created
in the right place. Titles and paths take raw text, not HTML-escaped entities — see
\`create_document\`'s own description. Em dashes, \`®\`, and emoji all pass through cleanly.

## Choosing a tool

**Editing note text.** Prefer block-level tools over document-level ones. \`update_document\`
rewrites an entire note; \`update_block\` changes one block and leaves the rest byte-identical;
\`append_to_document\` adds to the end without resubmitting anything that already exists. On a
10,000-word note, block-level editing is the difference between resending the whole document and
sending a few hundred bytes. Use \`get_child_blocks\` to find block IDs first — that is the
discovery path for every block tool.

**Reading.** \`get_document_content\` for whole notes, \`get_block_kramdown\` for one block's exact
source including its attributes, \`unified_search\` to find things, \`get_document_tree\` for
structure.

**Reading a database without dragging its text along.** \`render_database\` returns every column of
every matched row unless you pass \`fields\`, which limits it to the columns named — by field ID or
exact field name, trimming the column definitions to match as well. On a database whose rows carry
real prose this is the difference between a status check and a full re-read: checking one field of
one row otherwise pulls every long text field on that row. Read cheaply enough that verifying your
own work stays worth doing.

Two things not to assume here. Hiding a column in a view does **not** shrink what the kernel
returns — the hidden flag is presentation-only, and \`fields\` is deliberately independent of it, so
the same call returns the same data whichever view it resolves. And \`get_database\` is a schema
tool that carries every cell value of every row along with the schema; it is not the cheap read it
looks like. For primary keys alone, \`get_database_primary_key_values\` is cheaper than either.

**Databases.** \`render_database\` is the main read: it returns computed rows and the row IDs that
every write tool needs. \`get_database\` returns the schema and raw view config but no rows.
\`add_database_rows_with_values\` creates rows; to correct or update rows that already exist, use
\`set_database_cell\` (one cell) or \`set_database_cells\` (many, across one or more rows, in one
call — the batch path for corrections the way \`add_database_rows_with_values\` is the batch path
for creation). Both accept the same plain-form values described below.

## Cross-document links

Block references use \`((document-id "Display Text"))\` and are bidirectional — a backlink appears
automatically on the target, with no separate step. The \`siyuan://blocks/<id>\` URL form also
works but is one-directional (no backlink). Document IDs come from \`create_document\`'s return
value. When a branch of documents references each other, create all of them first and add the
links in a second pass — referencing an ID that doesn't exist yet fails, so single-pass creation
with forward references doesn't work.

## Bulk import

Do not create rows one at a time. \`add_database_rows_with_values\` creates rows and sets every
cell in one request; \`create_database\` accepts a whole field schema in one call. A 3-row,
10-field database takes about 4 calls this way and roughly 45 without.

Every row must include a non-empty value for the primary-key field. \`add_database_rows_with_values\`
rejects the whole call up front, naming the row index, rather than let SiYuan silently create no
row at all for that one entry while still reporting it as written. This check is specific to that
tool's endpoint — if a row genuinely needs a blank title, use \`add_database_rows\` instead (accepts
an empty or omitted title) and fill in the other fields afterward with \`set_database_cell\`.

Recommended order:

1. \`create_snapshot\` — bulk writes are hard to undo without one
2. \`create_database\` with its \`fields\` schema
3. \`add_database_rows_with_values\`, giving each row an \`item_id\`
4. \`embed_database\` to place it in a document
5. filters, sorts, grouping, layout — only after embedding
6. verify by **membership, not by count** — see below

**Verify by membership, not by count.** Pick several records you know are in the source —
including ones from the middle and the end of the run, not just the first few — and confirm each
one is present in the target, with \`render_database\`'s \`query\` parameter or
\`get_database_primary_key_values\` with a keyword. A total is not verification. A real import on
this workspace lost a contiguous block of ~50 rows while the total came back at 99 against a
rough expectation of "about 90", and was declared complete on that basis; it was caught only by
searching for two specific entries and getting nothing back. Two counts that sum to a believable
number tell you nothing about which rows are missing, and the plausible total is exactly what
stops anyone looking further.

Note also that \`row_count\` from \`add_database_rows_with_values\` echoes the rows *submitted*, not
the rows written. It is a receipt for the request, not evidence about the database.

**Consume a source page fully before advancing its cursor.** Cursor pagination has no concept of
partial consumption: once the next page is fetched, nothing in the response, the cursor, or the
target records that the previous page had a remainder. If a page cannot be finished in one go,
record the boundary explicitly somewhere outside the cursor. This matters most across a long run
where the reader and the writer may be different sessions — the loss is silent, contiguous, and
looks exactly like a complete import.

**\`item_id\` scheme, for a resumable import.** Format is 14 digits, a hyphen, then 7 lowercase
alphanumerics, e.g. \`20230713000000-a3f9c2d\`. Recommended construction: prefix = the source row's
*date only* (\`YYYYMMDD\` + \`000000\`) — deliberately excluding any time-of-day component, since
freeform or ambiguous time fields are exactly what produces silent collisions; suffix = the last 7
characters of the source system's own record ID, which inherits uniqueness from the source rather
than computing it. This construction is generic — it works for any source, not just one particular
migration. Re-sending a row whose \`item_id\` already exists **updates it in place** rather than
duplicating it, which is what makes an interrupted import safely re-runnable from the start.
Without \`item_id\`, a retry after a timeout silently doubles the data.

**Migration-fidelity principle.** When a source field is ambiguous or inconsistently formatted,
do not resolve the ambiguity during migration — copy it verbatim, and log the data-quality issue
as a separate follow-up. Reinterpreting source data mid-migration silently changes what it means;
this is also why the \`item_id\` scheme above deliberately avoids parsing time-of-day fields.

**Token-efficient bulk writes.** Build and validate the row payload programmatically (row count,
a uniqueness check, one sample) rather than previewing the full payload in conversation before
calling the tool — dumping it first and then passing the same data as a parameter doubles the
token cost for no benefit. Select only the columns actually needed from the source query, not
every column. \`chunk_size\` controls round-trip/tool-call overhead, not the token floor set by the
row data itself — a larger \`chunk_size\` reduces call count, not total token cost.

**SiYuan's write limits, versus a source system's read limits.** These are unrelated and worth not
conflating: \`add_database_rows_with_values\` chunks internally, default 100 rows per request
(\`chunk_size\` is adjustable), and single unchunked calls of at least 300 rows have been confirmed
to work cleanly — the true ceiling above that is still unmeasured, so do not assume a hard number
beyond "300+ proven fine." If a bulk operation is failing or throttling, check which side is
actually the bottleneck before changing SiYuan-side batch sizes: a rate limit on the system you are
*reading from* (e.g. a source API's own query limits) calls for backing off or paginating those
reads, not for shrinking the SiYuan write batches, which were never the constraint in that case.

## Rows bound to real documents

A detached row lives only inside the database. A bound row points at a real document, which is
what you want whenever the row has a body — a character profile, an episode, a mystery entry.
Bound rows used to cost roughly one call per field; two tools now make them bulk work.

**When the documents do not exist yet** — the common case for a migration — create the rows
detached with all their values, then convert the whole batch:

1. \`add_database_rows_with_values\` — one call, all rows, all values, still detached
2. \`embed_database\` — \`convert_database_rows_to_documents\` needs the database block
3. \`render_database\` — collect the row IDs
4. \`convert_database_rows_to_documents\` — one call: SiYuan creates a document per row, named
   from that row's primary key, rebinds the row to it, and keeps every value already on the row

\`save_mode: "sub_doc"\` (the default) puts each document under the document holding the database;
\`"template"\` uses the database's default row-creation template for location and body. Rows that
are already bound are skipped and named in \`skipped_item_ids\` rather than counted as converted.
Each chunk is one kernel transaction that undoes its own documents if it fails.

**The conversion does not apply row-creation template defaults** — with either \`save_mode\`. The
kernel clones each row's existing values and never reads the template's \`field_values\`; the
template only ever supplies the save location and the body. So a database whose template sets, say,
a "pending" checkbox produces converted rows with that checkbox unset, silently. That bites hardest
where it is least visible: the rows being bulk-converted are usually the least finished ones, and
they end up looking like the most finished ones. Pass \`apply_template_defaults\` to write the
defaults afterward; without it, the response carries a warning whenever the database has templates
with defaults. The documents themselves are created with empty bodies either way — if each row
needs real content, \`create_database_row_from_template_with_markdown\` is the per-row alternative,
or carry the reference in a *field* instead of a body, which stays queryable and survives someone
editing the document.

**When the documents already exist**, use \`add_bound_database_rows_with_values\`: one call binds
them all and writes their values. Row IDs come back in \`item_ids\`, keyed by block ID.

A bound row takes its name from its document, so neither tool accepts a primary-key value.
Writing one succeeds but only overrides the row's display text, leaving the row disagreeing with
the title of the document it points at — rename the document instead.

Note the direction of travel: this path is detached → bound. Neither tool goes the other way, so
bind when the content warrants a document rather than counting on unbinding later.

## Building a database schema

**Name the database.** \`create_database\` takes an optional \`name\`; without it SiYuan calls it
"Untitled", and a workspace of databases all called Untitled is genuinely hard to navigate even
though \`av_id\` is what everything binds to. \`rename_database\` fixes one afterward. Note the three
different things that can be renamed here and the tool for each: the database (\`rename_database\`),
one of its fields (\`update_database_field\`), and the document holding it (\`rename_document\`).

\`create_database\`'s primary key is auto-named "Primary Key" and placed first in the column order
when created with a \`fields\` schema — rename it with \`update_database_field\` if a more specific
name is wanted. \`update_database_field\` renames a field or changes its type without discarding
existing data (the primary key can be renamed but not retyped, and no other field can become the
primary key). \`configure_select_options\` sets the option list for a select/mSelect field
explicitly — useful both to control colours (implicit option creation always assigns the same
colour) and to pre-seed a known option set before an import that uses \`validate_options\`.

**select/mSelect options are created on write, with no validation, no case-folding.** A value not
already an existing option becomes a new option silently — \`"Done"\` and \`"done"\` are two separate
options with no warning either way, and this is easy to miss because it looks identical in a table
view until filters start silently missing rows. Whitespace is trimmed automatically (there being
no legitimate use for a leading or trailing space in an option name), but case is not folded, since
folding it automatically could just as easily merge two options that were meant to be distinct.
Prefer passing values through unchanged from a canonical source rather than retyping them by hand.
For anything where a stray near-duplicate option would matter, set \`validate_options: true\` on
\`add_database_rows_with_values\` to reject unknown values instead of silently creating them —
pair it with \`configure_select_options\` to declare the allowed set first.

**No auto-increment field type exists.** \`lineNumber\` is row position, not a stable identifier —
it renumbers on delete or reorder, silently reassigning what a given number refers to, which is
worse than having no ID column at all. For a manually-maintained sequential ID (e.g. a "BL-#" or
"PF-#" style scheme), \`get_next_sequence_value\` reads the current maximum of a number field and
suggests max+1. This is a convenience read, not an atomic counter, and does not guarantee
uniqueness under concurrent writers — it replaces scanning for the highest existing value by hand,
not a real auto-increment.

## Row-creation templates

\`configure_new_item_templates\` sets a database's row-creation templates — SiYuan's equivalent of
Notion's page templates. A "detached" template just pre-fills field defaults; a "document"
template additionally binds each new row to a real document, with a body copied from a template
document (or supplied fresh per row — see below). Requires the database to be embedded
(\`block_id\` from \`embed_database\`) before rows can actually be created from a template, though
the templates themselves can be configured on a detached database.

This call **replaces the whole template set**, not a merge — read \`newItemTemplates\` back from
\`get_database\` first if amending rather than replacing. select/mSelect default values must
already exist as options on the field (\`configure_select_options\` first); unlike a normal cell
write, an unknown option here is rejected rather than created — and SiYuan throws away *every*
template in the call over one missing option, not just the offending default. Seed the options
first, then configure the templates. That ordering matters most on a database you just created,
where a fresh select field has no options at all yet.

Template writes go through SiYuan's transaction queue, which returns success as soon as the
request is queued and reports failures only to the SiYuan interface — a rejection is invisible to
the caller. This tool therefore checks the field defaults itself before writing and reads the
template set back afterward, so a discarded write raises an error instead of returning ids for
templates that do not exist. If one ever slips through, the symptom shows up a call later as
\`new item template [id] not found\` from \`create_database_row_from_template*\`, which names the
wrong operation — the configure call is what failed.

A "document" template's \`content_template_path\` is **not** a document ID or path in the notebook
tree — it resolves against the workspace's \`data/templates/\` folder, SiYuan's own template-file
mechanism, unrelated to regular documents. Write a document with the structure a new row's body
should start from, then call \`save_document_as_template\` to turn it into a template file, and
pass the path it returns as \`content_template_path\`.

To use a template: \`create_database_row_from_template\` creates a row from it (or a blank row if
no template is given), reusing a "document" template's own content unchanged.
\`create_database_row_from_template_with_markdown\` does the same but takes fresh markdown for the
new document's body instead — the one to use when each row's content should be generated per-row
(e.g. an AI-written brief from a fixed structural template) rather than starting from identical
boilerplate every time. It only works with a document-target template.

A template's \`primary_key_template\` wins over the per-row \`title\` on
\`create_database_row_from_template_with_markdown\`. SiYuan falls back to \`title\` only when
\`primary_key_template\` is empty, so a template setting both names every row alike while their
bodies still differ, with no error anywhere — and it still requires a non-empty \`title\` on the
call, so there is no per-row way to opt out. That combination is rejected up front instead.
Either clear \`primary_key_template\` on the template, or use
\`create_database_row_from_template\`, whose rows are meant to take their name from it.

A document-target template creates each row's document as a **child of the document holding the
database**, unless the template's own save location says otherwise. So removing the host document
removes those row documents with it — there is no need to delete them separately, and trying to
is what surfaces the misleading \`indexing\` error described below.

## Relations between databases

A field of type \`relation\` or \`rollup\` is created inert. It exists, and it points at nothing.
Values written to it go nowhere and no error is raised. Wire it up:

1. Create and populate the target database first
2. \`configure_relation_field\` to point the relation at that database
3. Write relation values as an array of target row IDs
4. \`configure_rollup_field\` last — it depends on a configured relation

Migrating databases that reference each other in the wrong order silently loses the links.

That ordering is now enforced rather than merely advised: a rollup through a field that is not a
configured relation is rejected, as is a summarised field that does not exist in the related
database. SiYuan itself accepts both and simply never resolves the rollup, which looks exactly
like the inert shell \`configure_rollup_field\` exists to fix. Options written to a field that is
not select/mSelect are rejected for the same reason — the kernel stores them, where they do
nothing.

## Why writes here can succeed without happening

Some of SiYuan's configuration operations have no REST endpoint and go through
\`/api/transactions\`, which **queues** the work and answers \`code: 0\` before running it. The
queue reports failures to the SiYuan interface, never to the caller. A success response from
anything transaction-backed therefore means "accepted", not "done" — and no amount of care
reading that response can tell the difference.

The tools built on those operations — \`update_database_field\`, \`configure_select_options\`,
\`configure_relation_field\`, \`configure_rollup_field\`, \`configure_new_item_templates\` — read the
database back after writing and raise an error if the change is not there. So their success
means the change is real. Anywhere else, treat a success response as a claim to check: read
back what you wrote.

## Failure modes that are silent

These fail without raising an error, so they are worth knowing rather than discovering:

- **View operations on a detached database.** \`set_database_filters\`, \`set_database_sorts\`,
  \`set_database_group\` and \`change_database_layout\` do nothing unless the database is embedded
  in a document. These tools require a \`block_id\` and fail fast instead.
- **Row ID versus bound block ID.** They are different identifiers. Writing a cell with the wrong
  one stores a value that never appears anywhere. \`resolve_database_ids\` converts between them.
- **Unconfigured relation and rollup fields**, as above.
- **select/mSelect option case-sensitivity**, as above — the whitespace half of this is now
  handled automatically, the case-folding half is not, deliberately.
- **Changing a primary key's type, or changing another field to the primary-key type.**
  \`update_database_field\` refuses this itself with a clear error before contacting SiYuan,
  precisely because the kernel's own refusal is silent — it reports success and changes nothing,
  with no way to detect that from the response.
- **The SQL index lags writes by one to two seconds.** A document created a moment ago may not
  appear in \`get_document_tree\` yet.
- **\`indexing\` is what "no such document" often looks like.** Not silent, but misleading: when a
  block ID is not in the block tree, SiYuan falls back to searching the filesystem for it, and
  that search is rate-limited to one call every three seconds. A second miss inside that window
  is refused with the error \`indexing\` instead of \`tree not found\`. During a burst of writes and
  deletes this reads like a transient kernel problem when the real cause is a stale ID — usually
  a document already removed as a child of something else. Re-check the ID before retrying.
- **Grouping hides rows.** A grouped view can report \`rowCount\` above zero while returning an
  empty \`rows\` array, and grouping survives a layout change. Clear the group before concluding
  data is missing.

## Values

Write cell values plainly — \`42\`, \`"2026-05-25"\`, \`"Done"\`, \`["A","B"]\`, \`true\`. The server
converts them according to each field's type. Dates given as \`YYYY-MM-DD\` are interpreted at
local midnight in the instance's timezone and rendered with no time shown, matching what the
interface displays; passing a UTC timestamp instead renders as the previous day west of UTC.

## Known limitations, not planned

- **Formula/\`template\` fields cannot be configured.** They can be created but the expression
  cannot be set through this server. Deliberately not built: a survey of every database in one
  full workspace migration found exactly one formula column in use, and it was worked around by
  dropping it. Revisit only if a specific need for a computed column shows up.
- **The real ceiling above ~300 rows per unchunked \`add_database_rows_with_values\` call is
  unmeasured**, as above.

## Reporting problems

This guide is generic, so it lags reality — anything found wrong or missing belongs in the
Project Findings database under 3.9.1 (\`Owner\` set to \`Code\`), not worked around silently. A
finding is only as useful as what it lets the other side reproduce without asking follow-up
questions. Before filing one:

- **Verify it is actually a tool bug, not a caller mistake**, by reading the result back — a
  success response is not proof of anything written; a thrown error is not proof the tool is
  broken (it may be doing exactly what it should with bad input). Several fixes on this project
  turned out to require correction after a first pass overstated how broadly a limitation applied
  (see the PF-18 entry in the Decisions log) — scope a claim to the specific tool and endpoint
  actually tested, not "the kernel" or "the connector" in general.
- **Quote the exact error text**, verbatim, not a paraphrase — silent-failure classes on this
  project have repeatedly turned on one specific wrong word in a JSON key or action name.
- **Name the exact tool called and the arguments that triggered it** (redact real data, keep
  structure/shape), and what \`render_database\` or the equivalent read-back actually showed
  afterward, not just what was expected.
- **Give a minimal reproduction** where possible — the smallest call that reproduces it, not the
  full migration context it was found in.

## Safety

- \`create_snapshot\` before bulk or destructive work; \`list_snapshots\` and \`rollback_to_snapshot\`
  to recover.
- \`remove_document\` deletes child documents too.
- \`remove_database_rows\` deletes detached rows outright but only unbinds rows backed by real
  blocks; the underlying documents survive.
- \`remove_unused_databases\` is irreversible and counts any database you have created but not yet
  embedded as unused. Do not run it while building one.
`;
}
