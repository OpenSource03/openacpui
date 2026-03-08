import { useState } from "react";
import { BookOpen, LayoutGrid, FileText, FolderOpen, Plus, Pencil, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { stripHtml } from "./helpers";

// ── Confluence: Search results ──

interface ConfluenceSearchResult {
  content?: { id?: string; title?: string; type?: string; space?: { key?: string; name?: string } };
  title?: string;
  url?: string;
  excerpt?: string;
}

interface ConfluenceSearchData {
  results?: ConfluenceSearchResult[];
  totalSize?: number;
}

function ConfluenceSearchResultsView({ data }: { data: ConfluenceSearchData }) {
  const results = data.results;
  if (!results || results.length === 0) {
    return <p className="text-foreground/40 py-2">No results found</p>;
  }

  return (
    <div className="space-y-0.5">
      <span className="text-[10px] text-foreground/40 uppercase tracking-wider font-medium block mb-1.5">
        {data.totalSize ?? results.length} result{(data.totalSize ?? results.length) !== 1 ? "s" : ""}
      </span>
      {results.map((r, i) => {
        const title = r.content?.title ?? r.title ?? "Untitled";
        const space = r.content?.space?.key;
        return (
          <div
            key={i}
            className="rounded-md px-2 py-1.5 hover:bg-foreground/[0.03] transition-colors"
          >
            <div className="flex items-center gap-1.5">
              <BookOpen className="h-3 w-3 shrink-0 text-foreground/30" />
              <span className="text-[11px] text-foreground/80 truncate">{title}</span>
              {space && (
                <Badge variant="outline" className="h-3.5 px-1 text-[9px] shrink-0">
                  {space}
                </Badge>
              )}
            </div>
            {r.excerpt && (
              <p className="text-[10px] text-foreground/40 truncate mt-0.5 ms-[18px]">
                {stripHtml(r.excerpt).slice(0, 120)}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ConfluenceSearchResults({ data }: { data: unknown }) {
  return <ConfluenceSearchResultsView data={data as ConfluenceSearchData} />;
}

// ── Confluence: Spaces ──

interface ConfluenceSpace {
  id?: string;
  key?: string;
  name?: string;
  type?: string;
  status?: string;
}

interface ConfluenceSpacesData {
  results?: ConfluenceSpace[];
}

function ConfluenceSpacesView({ data }: { data: ConfluenceSpacesData }) {
  const spaces = data.results;
  if (!spaces || spaces.length === 0) {
    return <p className="text-foreground/40 py-2">No spaces found</p>;
  }

  return (
    <div className="space-y-0.5">
      <span className="text-[10px] text-foreground/40 uppercase tracking-wider font-medium block mb-1.5">
        {spaces.length} space{spaces.length !== 1 ? "s" : ""}
      </span>
      {spaces.map((s) => (
        <div
          key={s.key ?? s.id}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-foreground/[0.03] transition-colors"
        >
          <LayoutGrid className="h-3 w-3 shrink-0 text-foreground/30" />
          <span className="shrink-0 text-[11px] font-mono text-foreground/50 w-[72px] truncate" title={s.key}>
            {s.key}
          </span>
          {s.name && (
            <span className="min-w-0 flex-1 truncate text-foreground/80 text-[11px]">
              {s.name}
            </span>
          )}
          {s.type && (
            <Badge variant="outline" className="h-3.5 px-1 text-[9px] shrink-0">
              {s.type}
            </Badge>
          )}
        </div>
      ))}
    </div>
  );
}

export function ConfluenceSpaces({ data }: { data: unknown }) {
  return <ConfluenceSpacesView data={data as ConfluenceSpacesData} />;
}

// ── Confluence: Page descendants (getConfluencePageDescendants) ──

interface ConfluenceDescendant {
  id?: string;
  title?: string;
  status?: string;
  parentId?: string;
  depth?: number;
  childPosition?: number;
  type?: string; // "page" | "folder"
}

const DESCENDANT_TYPE_ICON: Record<string, { icon: typeof FileText; color: string }> = {
  page: { icon: FileText, color: "text-blue-400/60" },
  folder: { icon: FolderOpen, color: "text-amber-400/60" },
};

interface ConfluencePageDescendantsData {
  results?: ConfluenceDescendant[];
  _links?: { base?: string };
}

function ConfluencePageDescendantsView({ data }: { data: ConfluencePageDescendantsData }) {
  const results = data.results;
  if (!results || results.length === 0) {
    return <p className="text-foreground/40 py-2">No descendants found</p>;
  }

  return (
    <div className="space-y-0.5">
      <span className="text-[10px] text-foreground/40 uppercase tracking-wider font-medium block mb-1.5">
        {results.length} descendant{results.length !== 1 ? "s" : ""}
      </span>
      {results.map((d) => {
        const typeKey = (d.type ?? "page").toLowerCase();
        const typeInfo = DESCENDANT_TYPE_ICON[typeKey] ?? DESCENDANT_TYPE_ICON.page;
        const Icon = typeInfo.icon;

        return (
          <div
            key={d.id}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-foreground/[0.03] transition-colors"
            style={d.depth && d.depth > 1 ? { paddingInlineStart: `${8 + (d.depth - 1) * 16}px` } : undefined}
          >
            <Icon className={`h-3.5 w-3.5 shrink-0 ${typeInfo.color}`} />
            <span className="min-w-0 flex-1 truncate text-foreground/80 text-[11px]">
              {d.title ?? "Untitled"}
            </span>
            {d.type && (
              <Badge variant="outline" className="h-3.5 px-1 text-[9px] shrink-0">
                {d.type}
              </Badge>
            )}
            {d.status && d.status !== "current" && (
              <Badge variant="outline" className="h-3.5 px-1 text-[9px] shrink-0 text-amber-400">
                {d.status}
              </Badge>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ConfluencePageDescendants({ data }: { data: unknown }) {
  return <ConfluencePageDescendantsView data={data as ConfluencePageDescendantsData} />;
}

// ── Confluence: Created page (createConfluencePage) ──

interface ConfluencePageResultData {
  id?: string;
  title?: string;
  status?: string;
  spaceId?: string;
  parentId?: string;
  parentType?: string;
  createdAt?: string;
  version?: { number?: number; message?: string; createdAt?: string };
  body?: {
    storage?: { value?: string };
  };
  _links?: {
    webui?: string;
    editui?: string;
    base?: string;
  };
}

/** Convert Confluence storage-format HTML to renderable HTML:
 *  - Unwrap ac:structured-macro code blocks → <pre><code>
 *  - Strip remaining ac:* tags (panels, layouts, etc.)
 *  - Remove CDATA wrappers
 */
function sanitizeConfluenceHtml(html: string): string {
  return html
    // Convert Confluence code macros to <pre><code>…</code></pre>
    .replace(
      /<ac:structured-macro[^>]*ac:name="code"[^>]*>[\s\S]*?<ac:plain-text-body>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/ac:plain-text-body>\s*<\/ac:structured-macro>/gi,
      (_match, code: string) => `<pre><code>${code.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`,
    )
    // Strip any remaining CDATA wrappers
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    // Strip remaining ac:* tags
    .replace(/<\/?ac:[^>]*>/g, "");
}

/** Shared renderer for both createConfluencePage and updateConfluencePage */
function ConfluencePageResult({ data, mode }: { data: ConfluencePageResultData; mode: "create" | "update" }) {
  if (!data.id && !data.title) return null;

  const isUpdate = mode === "update" || (data.version?.number != null && data.version.number > 1);
  const Icon = isUpdate ? Pencil : Plus;
  const label = isUpdate ? "Page updated" : "Page created";
  const accentBg = isUpdate ? "bg-blue-500/15" : "bg-emerald-500/15";
  const accentText = isUpdate ? "text-blue-400" : "text-emerald-400";
  const iconColor = isUpdate ? "text-blue-400/70" : "text-emerald-400/70";

  const versionDate = data.version?.createdAt
    ? new Date(data.version.createdAt).toLocaleString()
    : data.createdAt
      ? new Date(data.createdAt).toLocaleString()
      : null;

  const webUrl = data._links?.base && data._links?.webui
    ? `${data._links.base}${data._links.webui}`
    : null;

  const storageHtml = data.body?.storage?.value ?? "";
  const renderedHtml = storageHtml ? sanitizeConfluenceHtml(storageHtml) : "";

  return (
    <div className="rounded-md border border-foreground/[0.06] overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-foreground/[0.06]">
        <div className="flex items-center gap-2 mb-1">
          <Icon className={`h-3.5 w-3.5 shrink-0 ${iconColor}`} />
          <span className="text-[10px] text-foreground/30 uppercase tracking-wider font-medium">
            {label}
          </span>
          {data.status && (
            <Badge
              variant="outline"
              className={`h-3.5 px-1 text-[9px] shrink-0 border-0 ${accentBg} ${accentText}`}
            >
              {data.status}
            </Badge>
          )}
        </div>
        <h4 className="text-[13px] font-medium text-foreground/90 wrap-break-word">
          {data.title ?? "Untitled"}
        </h4>
        {isUpdate && data.version?.message && (
          <p className="text-[11px] text-foreground/40 mt-0.5 wrap-break-word">
            {data.version.message}
          </p>
        )}
      </div>

      {/* Fields */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-3 py-2 text-[11px]">
        {data.id && (
          <ConfField label="Page ID">
            <span className="text-foreground/50 font-mono">{data.id}</span>
          </ConfField>
        )}
        {data.spaceId && (
          <ConfField label="Space ID">
            <span className="text-foreground/50 font-mono">{data.spaceId}</span>
          </ConfField>
        )}
        {data.parentId && (
          <ConfField label="Parent">
            <span className="text-foreground/50 font-mono">{data.parentId}</span>
            {data.parentType && (
              <span className="text-foreground/30 ms-1">({data.parentType})</span>
            )}
          </ConfField>
        )}
        {data.version?.number != null && (
          <ConfField label="Version">
            <span className="text-foreground/50">v{data.version.number}</span>
          </ConfField>
        )}
        {versionDate && (
          <ConfField label={isUpdate ? "Updated" : "Created"}>
            <span className="text-foreground/40">{versionDate}</span>
          </ConfField>
        )}
      </div>

      {/* Content preview */}
      {renderedHtml && (
        <ConfluenceContentPreview html={renderedHtml} />
      )}

      {/* Link */}
      {webUrl && (
        <div className="border-t border-foreground/[0.06] px-3 py-1.5">
          <span className="text-[10px] text-foreground/30 truncate block">{webUrl}</span>
        </div>
      )}
    </div>
  );
}

export function ConfluenceCreatedPage({ data }: { data: unknown }) {
  return <ConfluencePageResult data={data as ConfluencePageResultData} mode="create" />;
}

export function ConfluenceUpdatedPage({ data }: { data: unknown }) {
  return <ConfluencePageResult data={data as ConfluencePageResultData} mode="update" />;
}

/** Collapsible content preview rendering the actual Confluence HTML */
function ConfluenceContentPreview({ html }: { html: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t border-foreground/[0.06]">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex items-center gap-1.5 w-full px-3 py-1.5 hover:bg-foreground/[0.03] transition-colors">
          <ChevronRight
            className={`h-3 w-3 shrink-0 text-foreground/30 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
          />
          <span className="text-[10px] text-foreground/30 uppercase tracking-wider font-medium">
            Content preview
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div
            className="px-3 pb-2 max-w-none max-h-[600px] overflow-auto text-foreground/70 wrap-break-word confluence-preview"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function ConfField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-foreground/30 shrink-0">{label}</span>
      {children}
    </div>
  );
}

// ── Confluence: Pages in space (getPagesInConfluenceSpace) ──

interface ConfluenceSpacePage {
  id?: string;
  title?: string;
  status?: string;
  type?: string;
  parentId?: string;
}

interface ConfluencePageListData {
  results?: ConfluenceSpacePage[];
  _links?: { base?: string };
}

function ConfluencePageListView({ data }: { data: ConfluencePageListData }) {
  const results = data.results;
  if (!results || results.length === 0) {
    return <p className="text-foreground/40 py-2">No pages found</p>;
  }

  return (
    <div className="space-y-0.5">
      <span className="text-[10px] text-foreground/40 uppercase tracking-wider font-medium block mb-1.5">
        {results.length} page{results.length !== 1 ? "s" : ""}
      </span>
      {results.map((p) => {
        const typeKey = (p.type ?? "page").toLowerCase();
        const typeInfo = DESCENDANT_TYPE_ICON[typeKey] ?? DESCENDANT_TYPE_ICON.page;
        const Icon = typeInfo.icon;

        return (
          <div
            key={p.id}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-foreground/[0.03] transition-colors"
          >
            <Icon className={`h-3.5 w-3.5 shrink-0 ${typeInfo.color}`} />
            <span className="min-w-0 flex-1 truncate text-foreground/80 text-[11px]">
              {p.title ?? "Untitled"}
            </span>
            {p.type && p.type !== "page" && (
              <Badge variant="outline" className="h-3.5 px-1 text-[9px] shrink-0">
                {p.type}
              </Badge>
            )}
            {p.status && p.status !== "current" && (
              <Badge variant="outline" className="h-3.5 px-1 text-[9px] shrink-0 text-amber-400">
                {p.status}
              </Badge>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ConfluencePageList({ data }: { data: unknown }) {
  return <ConfluencePageListView data={data as ConfluencePageListData} />;
}
