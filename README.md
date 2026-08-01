# @pipeworx/congressional-documents

Full-text search and retrieval over the official record of Congress — hearing transcripts, committee reports and the Congressional Record. Platform key (data.gov), BYO accepted.

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

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Congressional Documents data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [All tools and guides](https://github.com/pipeworx-io/examples)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
