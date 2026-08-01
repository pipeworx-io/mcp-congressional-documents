interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Congressional Documents — full-text search and retrieval over the official
 * record of Congress: hearing transcripts, committee reports, committee prints,
 * House/Senate documents, and the Congressional Record.
 *
 * WHY THIS PACK EXISTS (discoverability). All of this already sits behind the
 * `govinfo` pack, but only as `search_packages({collections:"CHRG"})` /
 * `list_granules`. No model asked "what did executives say in the congressional
 * hearing about X" is going to reach for a granule API and know that CHRG means
 * hearings. Same reasoning as the OSHA-over-eCFR wrapper: the data was never
 * missing, the path to it was.
 *
 * WHAT IT IS FOR: grounding. These documents are voluminous, badly structured,
 * and heavily paraphrased second-hand — which makes them exactly the kind of
 * source a model invents plausible content about. Every result here carries the
 * package/granule id, the official citation, and a govinfo.gov URL, and
 * `get_congressional_document_text` returns the real text so an answer can quote
 * rather than recall.
 *
 * A DELIBERATE OMISSION, and the reason for it. There is no person-centric tool
 * here — nothing that takes a name and returns "documents mentioning them". Two
 * reasons, both load-bearing:
 *
 *   1. A name is not an identifier. Searching "Epstein" across hearings returns
 *      Anthony C. Epstein, a D.C. Superior Court nominee, above anything else
 *      (verified 2026-07-29). A person-shaped tool would silently merge
 *      unrelated people who share a surname.
 *   2. Appearing in a document is not an allegation. Congressional records name
 *      witnesses, staff, cited authors, and people mentioned once in passing.
 *      A tool that answers "is <person> in the record" invites a summarizer to
 *      collapse "was mentioned" into "was implicated", which is a defamation
 *      shape no disclaimer field reliably prevents.
 *
 * So this pack answers "what does the record say about <subject>", returns the
 * passage and its citation, and leaves characterising people to a human reading
 * the actual document.
 */


const BASE = 'https://api.govinfo.gov';

/**
 * GovInfo collection codes, mapped from words an agent would actually use.
 * Callers pass `doc_type: "hearings"`, never `collection:(CHRG)`.
 */
const DOC_TYPES: Record<string, { code: string; label: string }> = {
  hearings: { code: 'CHRG', label: 'Congressional hearing transcripts' },
  reports: { code: 'CRPT', label: 'Committee reports' },
  prints: { code: 'CPRT', label: 'Committee prints' },
  documents: { code: 'CDOC', label: 'House and Senate documents' },
  record: { code: 'CREC', label: 'Congressional Record (floor proceedings)' },
  all: { code: 'CHRG,CRPT,CPRT,CDOC,CREC', label: 'all congressional document types' },
};

const DISCLOSURE =
  'These are official published congressional documents. A person being named in one is not an ' +
  'allegation or a finding against them — the record names witnesses, staff, cited authors, and ' +
  'people mentioned only in passing. Quote the passage and cite it; do not infer wrongdoing from ' +
  'the fact of a mention.';

const COVERAGE =
  'Source is GovInfo (U.S. Government Publishing Office), the official repository. It covers ' +
  'PUBLISHED documents: hearings once transcribed and printed, committee reports, prints, and the ' +
  'Congressional Record. Ad-hoc document releases posted directly to a committee website are NOT ' +
  'here, and publication lags the hearing itself — often by months for hearing transcripts.';

interface SearchHit {
  package_id?: string;
  granule_id?: string | null;
  title?: string;
  doc_type?: string;
  date_issued?: string;
  congress?: string | null;
  committee?: string;
  citation?: string;
  details_url?: string;
}

function resolveDocType(input: unknown): { code: string; requested: string } {
  const raw = typeof input === 'string' ? input.toLowerCase().trim() : 'all';
  if (!raw) return { code: DOC_TYPES.all.code, requested: 'all' };
  // Accept the plain words, plus the raw GovInfo codes for callers who know them.
  const direct = DOC_TYPES[raw];
  if (direct) return { code: direct.code, requested: raw };
  const byCode = Object.entries(DOC_TYPES).find(([, v]) => v.code.toLowerCase() === raw);
  if (byCode) return { code: byCode[1].code, requested: byCode[0] };
  // Forgiving singulars: "hearing" -> "hearings".
  const plural = DOC_TYPES[`${raw}s`];
  if (plural) return { code: plural.code, requested: `${raw}s` };
  throw new Error(
    `Unknown doc_type "${raw}". Valid values: ${Object.keys(DOC_TYPES).join(', ')} ` +
    `(hearings = transcripts, reports = committee reports, prints = committee prints, ` +
    `documents = House/Senate documents, record = Congressional Record).`,
  );
}

async function govinfoPost<T>(apiKey: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}?api_key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error('GovInfo rejected the API key. A data.gov key is required (free at api.data.gov/signup).');
  }
  if (res.status === 429) {
    throw new Error('upstream_throttled: GovInfo rate limit (HTTP 429) — retry shortly.');
  }
  if (!res.ok) {
    throw new Error(`GovInfo search error: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function govinfoGet(apiKey: string, path: string, accept = 'application/json'): Promise<Response> {
  const res = await fetch(`${BASE}${path}?api_key=${encodeURIComponent(apiKey)}`, { headers: { Accept: accept } });
  if (res.status === 401 || res.status === 403) {
    throw new Error('GovInfo rejected the API key. A data.gov key is required (free at api.data.gov/signup).');
  }
  if (res.status === 429) {
    throw new Error('upstream_throttled: GovInfo rate limit (HTTP 429) — retry shortly.');
  }
  return res;
}

/** Turn GovInfo's <pre>-wrapped HTML into readable text without dragging in a parser. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The Congressional Record and printed hearings carry their own page citation in
 * a bracketed header, e.g. "[Pages S6557-S6559]". Surfacing it lets a caller
 * cite a page rather than a whole document.
 */
function extractPageCitation(text: string): string | null {
  const m = text.match(/\[Pages?\s+([^\]]+)\]/i);
  return m ? m[1].trim() : null;
}

const tools: McpToolExport['tools'] = [
  {
    name: 'search_congressional_documents',
    description:
      'Search the full text of official U.S. congressional documents — hearing transcripts, ' +
      'committee reports, committee prints, House/Senate documents, and the Congressional Record. ' +
      'Use for "what was said in the congressional hearing about X", "the committee report on Y", ' +
      '"congressional testimony on Z", "what did Congress publish about ...". Returns matching ' +
      'documents with their official citation, date, congress number and a govinfo.gov link; pass ' +
      'the returned ids to get_congressional_document_text to read the actual wording. ' +
      'Searches PUBLISHED documents only — a hearing transcript appears months after the hearing. ' +
      'Note that a person named in a document is not thereby accused of anything.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Free-text search over document full text, e.g. "opioid settlement" or "FTX collapse"',
        },
        doc_type: {
          type: 'string',
          description:
            'Which record to search: "hearings" (transcripts), "reports" (committee reports), ' +
            '"prints", "documents" (House/Senate documents), "record" (Congressional Record), or ' +
            '"all" (default).',
        },
        congress: { type: 'number', description: 'Congress number, e.g. 118 for 2023-2024' },
        date_from: { type: 'string', description: 'Earliest publication date, YYYY-MM-DD' },
        date_to: { type: 'string', description: 'Latest publication date, YYYY-MM-DD' },
        limit: { type: 'number', description: 'Results to return (default 10, max 50)' },
        _apiKey: { type: 'string', description: 'data.gov API key (free at api.data.gov/signup)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_congressional_document_text',
    description:
      'Read the actual text of a congressional document — the full transcript, report or ' +
      'Congressional Record entry — so an answer can quote the source instead of paraphrasing from ' +
      'memory. Pass the package_id (and granule_id where the search returned one) from ' +
      'search_congressional_documents. Returns the document text, its official citation, the page ' +
      'range where the source prints one, and the govinfo.gov URL. Hearing transcripts run to ' +
      'hundreds of pages, so text is truncated by default — raise max_chars or use the offset to page ' +
      'through it.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        package_id: {
          type: 'string',
          description: 'GovInfo package id, e.g. "CHRG-116shrg42133" or "CREC-2025-09-10"',
        },
        granule_id: {
          type: 'string',
          description: 'Optional granule id for one item within a package, e.g. "CREC-2025-09-10-pt1-PgS6557-4"',
        },
        max_chars: { type: 'number', description: 'Characters of text to return (default 20000, max 200000)' },
        offset: { type: 'number', description: 'Character offset to start from, for paging long transcripts' },
        _apiKey: { type: 'string', description: 'data.gov API key (free at api.data.gov/signup)' },
      },
      required: ['package_id'],
    },
  },
  {
    name: 'list_congressional_document_types',
    description:
      'List the kinds of congressional documents that can be searched (hearings, committee reports, ' +
      'committee prints, House/Senate documents, Congressional Record), what each contains, and what ' +
      'this source does and does not cover. Call this when unsure which doc_type answers a question.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
];

function requireKey(args: Record<string, unknown>): string {
  const key = (args._apiKey as string | undefined)?.trim();
  if (!key) {
    throw new Error(
      'Congressional document search requires a data.gov API key. Pass _apiKey — free, instant signup ' +
      'at https://api.data.gov/signup (one key works across GovInfo and most federal APIs).',
    );
  }
  return key;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === 'list_congressional_document_types') {
    return {
      doc_types: Object.entries(DOC_TYPES)
        .filter(([k]) => k !== 'all')
        .map(([key, v]) => ({ doc_type: key, contains: v.label, govinfo_collection: v.code })),
      coverage: COVERAGE,
      disclosure: DISCLOSURE,
    };
  }

  const apiKey = requireKey(args);

  switch (name) {
    case 'search_congressional_documents': {
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      if (!query) throw new Error('Required argument "query" is missing. Pass a string like "opioid settlement".');
      const { code, requested } = resolveDocType(args.doc_type);
      const limit = Math.min(Math.max(Number(args.limit ?? 10), 1), 50);

      // Free text goes in bare; field filters AND onto it. A `query:"..."`
      // wrapper makes GovInfo 500 — see the govinfo pack for the full note.
      const parts = [query, `collection:(${code})`];
      if (args.congress) parts.push(`congress:${Number(args.congress)}`);
      const from = args.date_from as string | undefined;
      const to = args.date_to as string | undefined;
      if (from && to) parts.push(`publishdate:range(${from},${to})`);
      else if (from) parts.push(`publishdate:range(${from},)`);
      else if (to) parts.push(`publishdate:range(,${to})`);

      const data = await govinfoPost<{
        count?: number;
        results?: {
          packageId?: string;
          granuleId?: string;
          title?: string;
          collectionCode?: string;
          dateIssued?: string;
          congress?: string;
          governmentAuthor?: string[];
          detailsLink?: string;
        }[];
      }>(apiKey, '/search', {
        query: parts.join(' AND '),
        pageSize: limit,
        offsetMark: '*',
        sorts: [{ field: 'relevancy', sortOrder: 'DESC' }],
      });

      const byCode = new Map(Object.entries(DOC_TYPES).map(([k, v]) => [v.code, k]));
      const results: SearchHit[] = (data.results ?? []).map((r) => ({
        package_id: r.packageId,
        granule_id: r.granuleId ?? null,
        title: r.title,
        doc_type: r.collectionCode ? byCode.get(r.collectionCode) ?? r.collectionCode : undefined,
        date_issued: r.dateIssued,
        congress: r.congress ?? null,
        committee: Array.isArray(r.governmentAuthor) ? r.governmentAuthor.join('; ') : undefined,
        citation: r.packageId,
        details_url: r.detailsLink ?? (r.packageId ? `https://www.govinfo.gov/app/details/${r.packageId}` : undefined),
      })) as SearchHit[];

      return {
        query,
        doc_type: requested,
        total_matches: data.count ?? null,
        returned: results.length,
        results,
        next_step:
          results.length
            ? 'Pass package_id (and granule_id when present) to get_congressional_document_text to read and quote the actual wording.'
            : 'No published documents matched. Note that hearing transcripts are published months after the hearing, so a recent hearing may not be in the record yet.',
        coverage: COVERAGE,
        disclosure: DISCLOSURE,
      };
    }

    case 'get_congressional_document_text': {
      const pkg = (args.package_id as string | undefined)?.trim();
      if (!pkg) {
        throw new Error('Required argument "package_id" is missing. Pass a string like "CREC-2025-09-10".');
      }
      const gran = (args.granule_id as string | undefined)?.trim();
      const maxChars = Math.min(Math.max(Number(args.max_chars ?? 20000), 500), 200000);
      const offset = Math.max(Number(args.offset ?? 0), 0);

      const path = gran
        ? `/packages/${encodeURIComponent(pkg)}/granules/${encodeURIComponent(gran)}/htm`
        : `/packages/${encodeURIComponent(pkg)}/htm`;

      const res = await govinfoGet(apiKey, path, 'text/html');
      if (res.status === 404) {
        throw new Error(
          `GovInfo has no text at that id. Check package_id "${pkg}"${gran ? ` / granule_id "${gran}"` : ''} — ` +
          `ids come from search_congressional_documents, and a granule_id only works with its own package_id. ` +
          `Some older scanned documents are PDF-only and have no text rendition.`,
        );
      }
      if (!res.ok) {
        throw new Error(`GovInfo text error: ${res.status} ${(await res.text()).slice(0, 200)}`);
      }

      const full = htmlToText(await res.text());
      const slice = full.slice(offset, offset + maxChars);

      // Metadata is a nice-to-have here; a failure to fetch it must not cost the
      // caller the text they actually asked for.
      let summary: Record<string, unknown> = {};
      try {
        const sres = await govinfoGet(apiKey, `/packages/${encodeURIComponent(pkg)}/summary`);
        if (sres.ok) summary = (await sres.json()) as Record<string, unknown>;
      } catch {
        /* text still returned below */
      }

      return {
        package_id: pkg,
        granule_id: gran ?? null,
        title: summary.title ?? null,
        date_issued: summary.dateIssued ?? null,
        congress: summary.congress ?? null,
        committee: summary.committees ?? null,
        page_citation: extractPageCitation(full),
        details_url: `https://www.govinfo.gov/app/details/${pkg}${gran ? `/${gran}` : ''}`,
        total_chars: full.length,
        offset,
        returned_chars: slice.length,
        truncated: offset + slice.length < full.length,
        ...(offset + slice.length < full.length
          ? { next_offset: offset + slice.length, paging_note: 'Call again with this offset to continue reading.' }
          : {}),
        text: slice,
        disclosure: DISCLOSURE,
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default { tools, callTool, meter: { credits: 1 }, provider: 'govinfo.gov' } satisfies McpToolExport;
