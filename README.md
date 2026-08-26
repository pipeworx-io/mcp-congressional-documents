# @pipeworx/congressional-documents

Full-text search and retrieval over the official record of Congress — hearing transcripts, committee reports and the Congressional Record. Platform key (data.gov), BYO accepted.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1476+ live data sources.

## Tools

- `search_congressional_documents(...)` — search the full text of hearings, committee reports, committee prints, House/Senate documents and the Congressional Record. `doc_type` takes plain words (`"hearings"`, `"reports"`, `"record"`).
- `get_congressional_document_text(...)` — the actual document text, with its page citation and govinfo.gov URL, paged via `offset`/`next_offset` (a hearing runs ~200k characters).
- `list_congressional_document_types(...)` — what each document type contains, and what this source covers. Keyless.

## Auth

Platform key (`PLATFORM_DATAGOV_KEY`), or BYO via `_apiKey`. Free, instant signup at https://api.data.gov/signup — one key works across GovInfo and most federal APIs.

## Why this exists

All of this is reachable through the `govinfo` pack, but only as `search_packages({collections:"CHRG"})` and `list_granules`. No model asked *"what was said in the congressional hearing about X"* will reach for a granule API or know that `CHRG` means hearings. The data was never missing; the path to it was.

It exists for **grounding**: this corpus is voluminous, badly structured and heavily paraphrased second-hand, which makes it exactly what models confabulate about. Every result carries the package/granule id, the official citation and a govinfo.gov URL so an answer can quote rather than recall.

## Coverage

**Published documents only.** A hearing transcript appears months after the hearing. Ad-hoc releases a committee posts to its own website never reach GovInfo at all — use `search_committee_documents` (`committee-releases`) for those.

`page_citation` is a Congressional Record convention (`[Pages S6557-S6559]`); hearings do not carry one, so it is legitimately null there.

## A deliberate omission

There is **no person-centric tool** — nothing that takes a name and returns documents mentioning them. Two reasons:

1. **A name is not an identifier.** Searching "Epstein" across hearings ranks *Anthony C. Epstein*, a D.C. Superior Court nominee, first. A person-shaped tool would silently merge unrelated people who share a surname.
2. **Appearing in a document is not an allegation.** The record names witnesses, staff, cited authors and people mentioned once in passing. A "is X in the record" tool invites a summarizer to collapse *was mentioned* into *was implicated*.

Every response carries that disclosure. Please do not add a person→mentions tool; the omission is the design.

## Data sources

- `https://api.govinfo.gov/search`
- `https://api.govinfo.gov/packages/{packageId}/granules/{granuleId}/htm`

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "congressional-documents": {
      "url": "https://gateway.pipeworx.io/congressional-documents/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/congressional-documents/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1476+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Congressional Documents data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
