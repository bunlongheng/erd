"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Code2, SlidersHorizontal, X } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Column { name: string; type: string; isPK: boolean; isFK: boolean }
interface Rel { fromTable: string; fromColumn: string; toTable: string; toColumn: string; label?: string }
interface ParsedERD { tables: Array<{ name: string; columns: Column[] }>; rels: Rel[] }
interface TLayout { name: string; x: number; y: number; width: number; height: number; color: string; columns: Column[] }
interface Opts { coloredHeaders: boolean; showTypes: boolean; showLabels: boolean; curvedArrows: boolean; darkBg: boolean }
interface Layout { tableWidth: number; rowHeight: number; headerHeight: number; hGap: number; vGap: number }

// ── Palette ───────────────────────────────────────────────────────────────────
const PAL = ["#38bdf8","#34d399","#e879f9","#f87171","#fb923c","#a78bfa","#facc15","#4ade80","#60a5fa","#f472b6","#2dd4bf","#818cf8"];
const DEFAULT_OPTS: Opts = { coloredHeaders: true, showTypes: true, showLabels: true, curvedArrows: true, darkBg: false };
const DEFAULT_LAYOUT: Layout = { tableWidth: 240, rowHeight: 30, headerHeight: 42, hGap: 80, vGap: 60 };

// ── SQL Parser ────────────────────────────────────────────────────────────────
function splitCommas(s: string): string[] {
    const parts: string[] = [];
    let depth = 0, start = 0, inLineComment = false;
    for (let i = 0; i < s.length; i++) {
        if (!inLineComment && s[i] === "-" && s[i + 1] === "-") inLineComment = true;
        if (inLineComment && s[i] === "\n") inLineComment = false;
        if (inLineComment) continue;
        if (s[i] === "(") depth++;
        else if (s[i] === ")") depth--;
        else if (s[i] === "," && depth === 0) { parts.push(s.slice(start, i)); start = i + 1; }
    }
    parts.push(s.slice(start));
    return parts;
}

function parseSQL(sql: string): ParsedERD {
    const tables: ParsedERD["tables"] = [];
    const rels: Rel[] = [];

    const labelMap = new Map<string, string>();
    const relsBlockM = sql.match(/--\s*@rels\s*\n((?:--[^\n]*\n?)*)/i);
    if (relsBlockM) {
        for (const line of relsBlockM[1].split("\n")) {
            const m = line.match(/^--\s*(\w+)\s*->\s*(\w+)\s*:\s*(.+)$/);
            if (m) labelMap.set(`${m[1]}:${m[2]}`, m[3].trim());
        }
    }

    let src = sql.replace(/\/\*[\s\S]*?\*\//g, " ");
    const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`\[]?(\w+)["`\]]?\s*\(([\s\S]*?)\)\s*(?:ENGINE\s*=[^;]+)?;/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
        const tableName = m[1];
        const body = m[2];
        const columns: Column[] = [];
        const tblPKs = new Set<string>();
        const parts = splitCommas(body);

        for (const raw of parts) {
            const lineCommentIdx = raw.search(/--/);
            const t = (lineCommentIdx >= 0 ? raw.slice(0, lineCommentIdx) : raw).trim();
            const pkM = t.match(/^(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\s*\(([^)]+)\)/i);
            if (pkM) { pkM[1].split(",").forEach(c => tblPKs.add(c.trim().replace(/["`[\]]/g, ""))); continue; }
            const fkM = t.match(/^(?:CONSTRAINT\s+\S+\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+["`\[]?(\w+)["`\]]?\s*\(([^)]+)\)/i);
            if (fkM) {
                const fromCols = fkM[1].split(",").map(c => c.trim().replace(/["`[\]]/g, ""));
                const toTable = fkM[2];
                const toCols = fkM[3].split(",").map(c => c.trim().replace(/["`[\]]/g, ""));
                fromCols.forEach((fc, i) => {
                    rels.push({ fromTable: tableName, fromColumn: fc, toTable, toColumn: toCols[i] ?? toCols[0], label: labelMap.get(`${toTable}:${tableName}`) });
                });
            }
        }

        for (const raw of parts) {
            const lineCommentIdx = raw.search(/--/);
            const inlineLabel = lineCommentIdx >= 0 ? raw.slice(lineCommentIdx + 2).trim() : undefined;
            const t = (lineCommentIdx >= 0 ? raw.slice(0, lineCommentIdx) : raw).trim();
            if (!t) continue;
            if (/^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY|INDEX|KEY\s+\w)/i.test(t)) continue;
            const colM = t.match(/^["`\[]?(\w+)["`\]]?\s+(\S+)/);
            if (!colM) continue;
            const colName = colM[1];
            const baseType = colM[2].replace(/\(.*\)/, "").toUpperCase();
            const isPK = /\bPRIMARY\s+KEY\b/i.test(t) || tblPKs.has(colName);
            if (/\bPRIMARY\s+KEY\b/i.test(t)) tblPKs.add(colName);
            const refM = t.match(/\bREFERENCES\s+["`\[]?(\w+)["`\]]?\s*\(([^)]+)\)/i);
            const isFK = !!refM;
            if (refM) {
                const toTable = refM[1];
                const toCol = refM[2].trim().replace(/["`[\]]/g, "");
                const label = inlineLabel || labelMap.get(`${toTable}:${tableName}`);
                rels.push({ fromTable: tableName, fromColumn: colName, toTable, toColumn: toCol, label });
            }
            columns.push({ name: colName, type: baseType, isPK, isFK });
        }
        tables.push({ name: tableName, columns });
    }
    return { tables, rels };
}

// ── Hierarchical layout ───────────────────────────────────────────────────────
function computeLayout(erd: ParsedERD, layout: Layout): TLayout[] {
    const { tables, rels } = erd;
    if (!tables.length) return [];
    const { tableWidth: TW, rowHeight: RH, headerHeight: HH, hGap, vGap } = layout;
    const names = tables.map(t => t.name);
    const byName = new Map(tables.map(t => [t.name, t]));
    const parents = new Map<string, Set<string>>(names.map(n => [n, new Set()]));
    const childrenOf = new Map<string, Set<string>>(names.map(n => [n, new Set()]));
    for (const r of rels) {
        if (byName.has(r.fromTable) && byName.has(r.toTable) && r.fromTable !== r.toTable) {
            parents.get(r.fromTable)!.add(r.toTable);
            childrenOf.get(r.toTable)!.add(r.fromTable);
        }
    }
    const level = new Map<string, number>();
    const queue: string[] = [];
    for (const n of names) { if (!parents.get(n)!.size) { level.set(n, 0); queue.push(n); } }
    if (!queue.length) names.forEach((n, i) => level.set(n, Math.floor(i / 4)));
    let qi = 0;
    while (qi < queue.length) {
        const cur = queue[qi++]; const cl = level.get(cur)!;
        for (const child of childrenOf.get(cur)!) {
            if ((level.get(child) ?? -Infinity) <= cl) { level.set(child, cl + 1); queue.push(child); }
        }
    }
    names.forEach(n => { if (!level.has(n)) level.set(n, 0); });
    const byLevel = new Map<number, string[]>();
    for (const [n, l] of level) { if (!byLevel.has(l)) byLevel.set(l, []); byLevel.get(l)!.push(n); }
    const sortedLevels = [...byLevel.keys()].sort((a, b) => a - b);
    const maxRowW = Math.max(...sortedLevels.map(l => { const g = byLevel.get(l)!; return g.length * TW + (g.length - 1) * hGap; }));
    const pos = new Map<string, { x: number; y: number }>();
    let yOff = 40;
    for (const lv of sortedLevels) {
        const group = byLevel.get(lv)!;
        const rowW = group.length * TW + (group.length - 1) * hGap;
        let xOff = 40 + (maxRowW - rowW) / 2;
        let maxH = 0;
        for (const n of group) {
            pos.set(n, { x: xOff, y: yOff }); xOff += TW + hGap;
            const t = byName.get(n)!; maxH = Math.max(maxH, HH + t.columns.length * RH);
        }
        yOff += maxH + vGap;
    }
    return tables.map((t, i) => {
        const p = pos.get(t.name)!;
        return { name: t.name, x: p.x, y: p.y, width: TW, height: HH + t.columns.length * RH, color: PAL[i % PAL.length], columns: t.columns };
    });
}

// ── SVG builder ───────────────────────────────────────────────────────────────
function esc(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function buildErdSvg(layouts: TLayout[], rels: Rel[], opts: Opts, layout: Layout): string {
    if (!layouts.length) return "";
    const { rowHeight: RH, headerHeight: HH } = layout;
    const F = "'Inter', sans-serif";
    const parts: string[] = [];
    const byName = new Map(layouts.map(t => [t.name, t]));
    const W = Math.max(...layouts.map(t => t.x + t.width)) + 80;
    const H = Math.max(...layouts.map(t => t.y + t.height)) + 80;
    const bg = opts.darkBg ? "#0f172a" : "white";
    parts.push(`<rect width="${W}" height="${H}" fill="${bg}"/>`);

    const parentCount = new Map<string, number>();
    const parentIdx = new Map<string, number>();
    const drawn = new Set<string>();
    const relList = rels.filter(r => {
        const k = `${r.toTable}→${r.fromTable}:${r.fromColumn}`;
        if (drawn.has(k)) return false;
        drawn.add(k);
        return byName.has(r.fromTable) && byName.has(r.toTable) && r.fromTable !== r.toTable;
    });
    for (const r of relList) parentCount.set(r.toTable, (parentCount.get(r.toTable) || 0) + 1);
    const parentCur = new Map<string, number>();

    for (const rel of relList) {
        const parentT = byName.get(rel.toTable)!;
        const childT = byName.get(rel.fromTable)!;
        const pCount = parentCount.get(rel.toTable) || 1;
        const pIdx = parentCur.get(rel.toTable) || 0;
        parentCur.set(rel.toTable, pIdx + 1);

        const pCX = parentT.x + parentT.width / 2;
        const pCY = parentT.y + parentT.height / 2;
        const cCX = childT.x + childT.width / 2;
        const cCY = childT.y + childT.height / 2;
        const dy = cCY - pCY; const dx = cCX - pCX;

        const fkIdx = Math.max(0, childT.columns.findIndex(c => c.name === rel.fromColumn));
        const fkRowY = childT.y + HH + fkIdx * RH + RH / 2;
        const pkIdx = Math.max(0, parentT.columns.findIndex(c => c.isPK));
        const pkRowY = parentT.y + HH + pkIdx * RH + RH / 2;

        const margin = parentT.width * 0.15;
        const usableW = parentT.width - 2 * margin;
        const exitFraction = pCount === 1 ? 0.5 : (pIdx / (pCount - 1));
        const spreadX = parentT.x + margin + exitFraction * usableW;

        const isBelow = childT.y >= parentT.y + parentT.height - 5;
        const isAbove = childT.y + childT.height <= parentT.y + 5;
        const isRight = childT.x >= parentT.x + parentT.width - 5;
        const isLeft = childT.x + childT.width <= parentT.x + 5;

        let sx: number, sy: number, ex: number, ey: number;
        let arrowDir: "down" | "up" | "right" | "left";

        if (isBelow || (!isLeft && !isRight && dy > Math.abs(dx) * 0.5)) {
            sx = spreadX; sy = parentT.y + parentT.height; ex = cCX; ey = childT.y; arrowDir = "down";
        } else if (isAbove || (!isLeft && !isRight && dy < -Math.abs(dx) * 0.5)) {
            sx = spreadX; sy = parentT.y; ex = cCX; ey = childT.y + childT.height; arrowDir = "up";
        } else if (isRight || dx > 0) {
            sx = parentT.x + parentT.width; sy = pkRowY; ex = childT.x; ey = fkRowY; arrowDir = "right";
        } else {
            sx = parentT.x; sy = pkRowY; ex = childT.x + childT.width; ey = fkRowY; arrowDir = "left";
        }

        let c1x: number, c1y: number, c2x: number, c2y: number;
        if (arrowDir === "down") {
            const t = Math.max(50, Math.abs(ey - sy) * 0.45);
            c1x = sx; c1y = sy + t; c2x = ex; c2y = ey - t;
        } else if (arrowDir === "up") {
            const t = Math.max(50, Math.abs(ey - sy) * 0.45);
            c1x = sx; c1y = sy - t; c2x = ex; c2y = ey + t;
        } else if (arrowDir === "right") {
            const t = Math.max(50, Math.abs(ex - sx) * 0.45);
            c1x = sx + t; c1y = sy; c2x = ex - t; c2y = ey;
        } else {
            const t = Math.max(50, Math.abs(ex - sx) * 0.45);
            c1x = sx - t; c1y = sy; c2x = ex + t; c2y = ey;
        }

        const color = parentT.color;
        const pathD = opts.curvedArrows
            ? `M${sx} ${sy} C${c1x} ${c1y},${c2x} ${c2y},${ex} ${ey}`
            : `M${sx} ${sy} L${ex} ${ey}`;
        parts.push(`<path d="${pathD}" fill="none" stroke="${color}" stroke-width="2" opacity="0.75"/>`);

        const AH = 7;
        let arrowPts: string;
        switch (arrowDir) {
            case "down": arrowPts = `${ex},${ey} ${ex - AH},${ey - AH * 1.5} ${ex + AH},${ey - AH * 1.5}`; break;
            case "up":   arrowPts = `${ex},${ey} ${ex - AH},${ey + AH * 1.5} ${ex + AH},${ey + AH * 1.5}`; break;
            case "right": arrowPts = `${ex},${ey} ${ex - AH * 1.5},${ey - AH} ${ex - AH * 1.5},${ey + AH}`; break;
            default:      arrowPts = `${ex},${ey} ${ex + AH * 1.5},${ey - AH} ${ex + AH * 1.5},${ey + AH}`; break;
        }
        parts.push(`<polygon points="${arrowPts}" fill="${color}" opacity="0.9"/>`);

        const NX = arrowDir === "right" ? ex + 10 : arrowDir === "left" ? ex - 18 : ex + 10;
        const NY = arrowDir === "down" ? ey - 6 : arrowDir === "up" ? ey + 16 : ey - 6;
        parts.push(`<text x="${NX}" y="${NY}" font-family="${F}" font-size="11" font-weight="700" fill="${color}" opacity="0.9">N</text>`);

        const BAR = 9;
        if (arrowDir === "down" || arrowDir === "up") {
            const sign = arrowDir === "down" ? 1 : -1;
            parts.push(`<line x1="${sx - BAR}" y1="${sy}" x2="${sx + BAR}" y2="${sy}" stroke="${color}" stroke-width="1.5" opacity="0.75"/>`);
            parts.push(`<line x1="${sx - BAR}" y1="${sy + sign * 6}" x2="${sx + BAR}" y2="${sy + sign * 6}" stroke="${color}" stroke-width="1.5" opacity="0.75"/>`);
        } else {
            const sign = arrowDir === "right" ? -1 : 1;
            parts.push(`<line x1="${sx}" y1="${sy - BAR}" x2="${sx}" y2="${sy + BAR}" stroke="${color}" stroke-width="1.5" opacity="0.75"/>`);
            parts.push(`<line x1="${sx + sign * 6}" y1="${sy - BAR}" x2="${sx + sign * 6}" y2="${sy + BAR}" stroke="${color}" stroke-width="1.5" opacity="0.75"/>`);
        }

        if (opts.showLabels) {
            const lbl = rel.label || rel.fromColumn;
            const midX = (sx + ex) / 2;
            const midY = (sy + ey) / 2;
            const PW = Math.max(28, lbl.length * 6.5 + 14);
            const PH = 18;
            parts.push(`<rect x="${midX - PW / 2}" y="${midY - PH / 2}" width="${PW}" height="${PH}" rx="${PH / 2}" fill="${color}" opacity="0.9"/>`);
            parts.push(`<text x="${midX}" y="${midY + 1}" text-anchor="middle" dominant-baseline="middle" font-family="${F}" font-size="10" font-weight="600" fill="white">${esc(lbl)}</text>`);
        }
    }

    for (const tbl of layouts) {
        const { x, y, width, height, color, columns } = tbl;
        const hdrColor = opts.coloredHeaders ? color : "#64748b";
        const textBg = opts.darkBg ? "#1e293b" : "white";
        const textDefault = opts.darkBg ? "#e2e8f0" : "#1e293b";

        parts.push(`<rect x="${x + 3}" y="${y + 3}" width="${width}" height="${height}" rx="10" fill="rgba(0,0,0,0.08)"/>`);
        parts.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" fill="${textBg}" stroke="${hdrColor}30" stroke-width="1.5"/>`);
        parts.push(`<rect x="${x}" y="${y}" width="${width}" height="${HH}" fill="${hdrColor}" rx="10"/>`);
        parts.push(`<rect x="${x}" y="${y + HH - 10}" width="${width}" height="10" fill="${hdrColor}"/>`);
        parts.push(`<text x="${x + width / 2}" y="${y + HH / 2 + 1}" text-anchor="middle" dominant-baseline="middle" font-family="${F}" font-size="13" font-weight="700" fill="white">${esc(tbl.name)}</text>`);

        columns.forEach((col, i) => {
            const rowY = y + HH + i * RH;
            const isLast = i === columns.length - 1;
            if (i % 2 === 0) parts.push(`<rect x="${x + 1}" y="${rowY}" width="${width - 2}" height="${RH}" fill="${hdrColor}0a"/>`);
            if (i > 0) parts.push(`<line x1="${x + 1}" y1="${rowY}" x2="${x + width - 1}" y2="${rowY}" stroke="${hdrColor}" stroke-width="0.5" opacity="0.25"/>`);
            if (isLast) {
                parts.push(`<rect x="${x + 1}" y="${rowY + RH - 10}" width="${width - 2}" height="10" fill="${textBg}"/>`);
                if (i % 2 === 0) parts.push(`<rect x="${x + 1}" y="${rowY + RH - 10}" width="${width - 2}" height="10" fill="${hdrColor}0a"/>`);
            }

            const midY = rowY + RH / 2;
            if (col.isPK) {
                parts.push(`<text x="${x + 10}" y="${midY + 1}" dominant-baseline="middle" font-family="${F}" font-size="9" font-weight="800" fill="#f59e0b">PK</text>`);
            } else if (col.isFK) {
                parts.push(`<text x="${x + 10}" y="${midY + 1}" dominant-baseline="middle" font-family="${F}" font-size="9" font-weight="800" fill="#60a5fa">FK</text>`);
            } else {
                parts.push(`<circle cx="${x + 13}" cy="${midY}" r="2.5" fill="${hdrColor}70"/>`);
            }
            const nameColor = col.isPK ? "#f59e0b" : col.isFK ? "#3b82f6" : textDefault;
            parts.push(`<text x="${x + 28}" y="${midY + 1}" dominant-baseline="middle" font-family="${F}" font-size="12" font-weight="${col.isPK || col.isFK ? "600" : "400"}" fill="${nameColor}">${esc(col.name)}</text>`);
            if (opts.showTypes) {
                parts.push(`<text x="${x + width - 8}" y="${midY + 1}" text-anchor="end" dominant-baseline="middle" font-family="${F}" font-size="10" fill="#94a3b8">${esc(col.type.toLowerCase())}</text>`);
            }
        });
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
}

// ── Default SQL ───────────────────────────────────────────────────────────────
const DEFAULT_SQL = `-- ERD++ — Paste your CREATE TABLE SQL here
-- Supports: PostgreSQL, MySQL, SQLite DDL
-- Add relationship labels in the @rels block below, or inline after REFERENCES

-- @rels
-- integrations -> triggers : has
-- integrations -> actions : has
-- integrations -> tenant_connections : connects
-- integrations -> integration_access : controls
-- triggers -> trigger_events : fires
-- actions -> action_events : fires
-- triggers -> fields : has

CREATE TABLE integrations (
  integration_key VARCHAR PRIMARY KEY,
  integrator_id   VARCHAR,
  title           VARCHAR,
  status          VARCHAR,
  access_mode     VARCHAR,
  license_type    VARCHAR,
  internal        BOOLEAN
);

CREATE TABLE triggers (
  trigger_key      VARCHAR PRIMARY KEY,
  integration_key  VARCHAR REFERENCES integrations(integration_key),
  title            VARCHAR,
  status           VARCHAR,
  request_base_url VARCHAR,
  trigger_type     VARCHAR
);

CREATE TABLE actions (
  action_key       VARCHAR PRIMARY KEY,
  integration_key  VARCHAR REFERENCES integrations(integration_key),
  title            VARCHAR,
  status           VARCHAR,
  license_type     VARCHAR,
  request_base_url VARCHAR
);

CREATE TABLE tenant_connections (
  integration_key VARCHAR REFERENCES integrations(integration_key),
  tenant_id       VARCHAR,
  status          VARCHAR,
  configured      BOOLEAN
);

CREATE TABLE integration_access (
  integration_key VARCHAR REFERENCES integrations(integration_key),
  tenant_id       VARCHAR
);

CREATE TABLE trigger_events (
  id          UUID PRIMARY KEY,
  trigger_key VARCHAR REFERENCES triggers(trigger_key),
  tenant_id   VARCHAR,
  status      VARCHAR
);

CREATE TABLE action_events (
  id         UUID PRIMARY KEY,
  action_key VARCHAR REFERENCES actions(action_key),
  tenant_id  VARCHAR,
  status     VARCHAR
);

CREATE TABLE fields (
  id          UUID PRIMARY KEY,
  trigger_key VARCHAR REFERENCES triggers(trigger_key),
  name        VARCHAR,
  label       VARCHAR,
  field_type  VARCHAR
);`;

// ── UI helpers ────────────────────────────────────────────────────────────────
function SliderRow({ label, value, min, max, unit = "", onChange }: {
    label: string; value: number; min: number; max: number; unit?: string; onChange: (v: number) => void;
}) {
    return (
        <div>
            <div className="flex justify-between mb-1">
                <span style={{ fontSize: 12, color: "#ffffff", fontWeight: 400 }}>{label}</span>
                <span style={{ fontSize: 12, color: "#636366", fontWeight: 400 }}>{value}{unit}</span>
            </div>
            <input type="range" min={min} max={max} value={value}
                onChange={e => onChange(parseInt(e.target.value))}
                className="w-full" style={{ accentColor: "#0a84ff" }} />
        </div>
    );
}

function IconBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button onClick={onClick}
            className="w-10 h-10 rounded-full flex items-center justify-center transition-all hover:brightness-125"
            style={{ background: active ? "#0a84ff" : "#2a2a2c", color: "white" }}>
            {children}
        </button>
    );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
    return (
        <div className="flex items-center justify-between cursor-pointer select-none" onClick={onChange}>
            <span style={{ fontSize: 13, color: "#bbb", fontWeight: 400 }}>{label}</span>
            <div style={{ position: "relative", width: 42, height: 24, borderRadius: 12, flexShrink: 0, background: checked ? "#34c759" : "#333", transition: "background 0.2s", cursor: "pointer" }}>
                <div style={{ position: "absolute", top: 2, width: 20, height: 20, borderRadius: 10, background: "white", left: checked ? 20 : 2, transition: "left 0.2s ease", boxShadow: "0 1px 4px rgba(0,0,0,0.4)" }} />
            </div>
        </div>
    );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function ErdPage() {
    const [mounted, setMounted] = useState(false);
    const [code, setCode] = useState(DEFAULT_SQL);
    const [showCode, setShowCode] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [editorDark, setEditorDark] = useState(false);
    const [codeWidth, setCodeWidth] = useState(360);
    const [copied, setCopied] = useState(false);
    const [hasFit, setHasFit] = useState(false);
    const [fitActive, setFitActive] = useState(true);
    const [opts, setOpts] = useState<Opts>(DEFAULT_OPTS);
    const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
    const [zoom, setZoom] = useState(1.0);

    const canvasRef = useRef<HTMLDivElement>(null);
    const isResizing = useRef(false);
    const resizeStartX = useRef(0);
    const resizeStartW = useRef(360);
    const isDragging = useRef(false);
    const dragOrigin = useRef({ x: 0, y: 0, sl: 0, st: 0 });
    const [draggingCanvas, setDraggingCanvas] = useState(false);

    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!isResizing.current) return;
            setCodeWidth(Math.max(220, Math.min(780, resizeStartW.current + (e.clientX - resizeStartX.current))));
        };
        const onUp = () => { isResizing.current = false; document.body.style.cursor = ""; document.body.style.userSelect = ""; };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    }, []);

    useEffect(() => {
        if (!mounted) return;
        const el = canvasRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            const speed = e.deltaMode === 1 ? 0.06 : 0.004;
            setZoom(z => parseFloat(Math.min(3, Math.max(0.15, z - e.deltaY * speed)).toFixed(3)));
            setFitActive(false);
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, [mounted]);

    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!isDragging.current || !canvasRef.current) return;
            canvasRef.current.scrollLeft = dragOrigin.current.sl - (e.clientX - dragOrigin.current.x);
            canvasRef.current.scrollTop = dragOrigin.current.st - (e.clientY - dragOrigin.current.y);
        };
        const onUp = () => { if (isDragging.current) { isDragging.current = false; setDraggingCanvas(false); } };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    }, []);

    useEffect(() => {
        setMounted(true);
        const c = localStorage.getItem("erd-code");
        if (c) setCode(c);
        try { const o = localStorage.getItem("erd-opts"); if (o) setOpts(p => ({ ...p, ...JSON.parse(o) })); } catch {}
        try { const l = localStorage.getItem("erd-layout"); if (l) setLayout(p => ({ ...p, ...JSON.parse(l) })); } catch {}
    }, []);
    useEffect(() => { if (mounted) localStorage.setItem("erd-code", code); }, [code, mounted]);
    useEffect(() => { if (mounted) localStorage.setItem("erd-opts", JSON.stringify(opts)); }, [opts, mounted]);
    useEffect(() => { if (mounted) localStorage.setItem("erd-layout", JSON.stringify(layout)); }, [layout, mounted]);

    const erd = useMemo(() => parseSQL(code), [code]);
    const tableLayouts = useMemo(() => computeLayout(erd, layout), [erd, layout]);
    const svg = useMemo(() => buildErdSvg(tableLayouts, erd.rels, opts, layout), [tableLayouts, erd.rels, opts, layout]);
    const svgDims = useMemo(() => { const m = svg.match(/width="(\d+)" height="(\d+)"/); return m ? { w: +m[1], h: +m[2] } : null; }, [svg]);
    const displaySvg = useMemo(() => {
        if (!svg || !svgDims) return svg;
        return svg.replace(/width="\d+" height="\d+"/, `width="${Math.round(svgDims.w * zoom)}" height="${Math.round(svgDims.h * zoom)}"`);
    }, [svg, svgDims, zoom]);

    const fitZoom = useCallback(() => {
        if (!canvasRef.current || !svgDims) return;
        const { clientWidth: cw, clientHeight: ch } = canvasRef.current;
        setZoom(parseFloat(Math.min((cw - 48) / svgDims.w, (ch - 48) / svgDims.h).toFixed(3)));
        setFitActive(true);
    }, [svgDims]);

    useEffect(() => {
        if (svgDims && !hasFit) { const id = requestAnimationFrame(() => { fitZoom(); setHasFit(true); }); return () => cancelAnimationFrame(id); }
    }, [svgDims, hasFit, fitZoom]);

    const panelMounted = useRef(false);
    useEffect(() => {
        if (!panelMounted.current) { panelMounted.current = true; return; }
        const id = requestAnimationFrame(() => fitZoom());
        return () => cancelAnimationFrame(id);
    }, [showSettings, showCode]); // eslint-disable-line react-hooks/exhaustive-deps

    const upd = (p: Partial<Opts>) => setOpts(o => ({ ...o, ...p }));
    const updL = (p: Partial<Layout>) => setLayout(l => ({ ...l, ...p }));

    const exportPng = useCallback(() => {
        if (!svg) return;
        const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        const img = new Image();
        img.onload = () => {
            const c = document.createElement("canvas");
            c.width = img.width * 2; c.height = img.height * 2;
            const ctx = c.getContext("2d")!;
            ctx.scale(2, 2); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, img.width, img.height);
            ctx.drawImage(img, 0, 0);
            c.toBlob(b => { if (!b) return; const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "erd.png"; a.click(); });
            URL.revokeObjectURL(url);
        };
        img.src = url;
    }, [svg]);

    const exportSvg = useCallback(() => {
        if (!svg) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        a.download = "erd.svg"; a.click();
    }, [svg]);

    const exportCode = useCallback(() => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([code], { type: "text/plain" }));
        a.download = "schema.sql"; a.click();
    }, [code]);

    const exportJson = useCallback(() => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([JSON.stringify(erd, null, 2)], { type: "application/json" }));
        a.download = "schema.json"; a.click();
    }, [erd]);

    const copyCode = useCallback(() => {
        navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
    }, [code]);

    const zoomPct = Math.round(zoom * 100);

    return (
        <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ fontFamily: "Inter, sans-serif" }}>

            {/* ── HEADER ── */}
            <header className="flex items-center px-5 shrink-0"
                style={{ height: 54, background: "#111113", borderBottom: "1px solid #27272a" }}>
                <span className="font-bold text-[16px]" style={{ color: "#f4f4f5", letterSpacing: "-0.3px" }}>ERD++</span>
                {mounted && erd.tables.length > 0 && (
                    <span className="ml-3 text-[11px] font-medium" style={{ color: "#52525b" }}>
                        {erd.tables.length} tables · {erd.rels.length} relationships
                    </span>
                )}
                <div className="flex-1" />
                <div className="flex gap-2">
                    <IconBtn active={showCode} onClick={() => setShowCode(v => !v)}>
                        <Code2 size={18} strokeWidth={2} />
                    </IconBtn>
                    <IconBtn active={showSettings} onClick={() => setShowSettings(v => !v)}>
                        <SlidersHorizontal size={18} strokeWidth={2} />
                    </IconBtn>
                </div>
            </header>

            {/* ── BODY ── */}
            <div className="flex-1 flex overflow-hidden">

                {/* ── Code panel ── */}
                {showCode && (
                    <div className="flex shrink-0 relative" style={{ width: codeWidth }}>
                        <div className="flex flex-col flex-1 overflow-hidden border-r"
                            style={{ background: editorDark ? "#0d1117" : "#ffffff", borderColor: editorDark ? "#1e2334" : "#e2e8f0" }}>
                            <div className="flex items-center justify-between px-4 py-2 border-b shrink-0"
                                style={{ borderColor: editorDark ? "#1e2334" : "#e2e8f0", background: editorDark ? "#0a0f1e" : "#f8fafc" }}>
                                <span className="text-[9px] font-bold uppercase tracking-widest"
                                    style={{ color: editorDark ? "#4a5568" : "#94a3b8" }}>SQL Schema</span>
                                <div className="flex items-center gap-1">
                                    <button onClick={copyCode}
                                        className="h-6 px-2 rounded flex items-center justify-center text-[10px] font-semibold transition-all"
                                        style={{ color: copied ? "#22c55e" : (editorDark ? "#64748b" : "#94a3b8"), background: copied ? (editorDark ? "rgba(34,197,94,0.12)" : "rgba(34,197,94,0.08)") : "transparent" }}>
                                        {copied ? "✓ Copied" : "Copy"}
                                    </button>
                                    <button onClick={() => setEditorDark(v => !v)}
                                        className="w-6 h-6 rounded flex items-center justify-center text-sm"
                                        style={{ color: editorDark ? "#7dd3fc" : "#64748b" }}>
                                        {editorDark ? "☀️" : "🌙"}
                                    </button>
                                </div>
                            </div>
                            <textarea
                                className="flex-1 resize-none outline-none p-4"
                                spellCheck={false}
                                value={code}
                                onChange={e => setCode(e.target.value)}
                                style={{
                                    background: "transparent",
                                    color: editorDark ? "#8892a4" : "#1e293b",
                                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                                    fontSize: "12.5px",
                                    lineHeight: 1.75,
                                    border: "none",
                                }}
                            />
                        </div>
                        {/* Resize handle */}
                        <div
                            onMouseDown={e => { isResizing.current = true; resizeStartX.current = e.clientX; resizeStartW.current = codeWidth; document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none"; e.preventDefault(); }}
                            className="absolute right-0 top-0 bottom-0 flex items-center justify-center z-10"
                            style={{ width: 8, cursor: "col-resize" }}>
                            <div className="h-12 rounded-full w-1" style={{ background: editorDark ? "#2a3148" : "#e2e8f0" }} />
                        </div>
                    </div>
                )}

                {/* ── Diagram canvas ── */}
                <div className="flex-1 relative" style={{ background: opts.darkBg ? "#0f172a" : "#dde4ed" }}>
                    <div ref={canvasRef} className="absolute inset-0 overflow-auto"
                        style={{ cursor: draggingCanvas ? "grabbing" : "grab" }}
                        onMouseDown={e => {
                            if ((e.target as HTMLElement).closest("button")) return;
                            isDragging.current = true; setDraggingCanvas(true);
                            dragOrigin.current = { x: e.clientX, y: e.clientY, sl: canvasRef.current?.scrollLeft ?? 0, st: canvasRef.current?.scrollTop ?? 0 };
                            e.preventDefault();
                        }}>
                        {mounted && displaySvg ? (
                            <div style={{ minWidth: "100%", minHeight: "100%", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: 24, boxSizing: "border-box" }}>
                                <div style={{ flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: displaySvg }} />
                            </div>
                        ) : (
                            <div className="flex items-center justify-center h-full">
                                {mounted && <span className="text-sm" style={{ color: "#94a3b8" }}>No tables — open the SQL editor and paste your schema.</span>}
                            </div>
                        )}
                    </div>

                    {/* Floating zoom toolbar */}
                    {mounted && (
                        <div className="absolute bottom-3 z-10 flex items-center"
                            style={{ left: "50%", transform: "translateX(-50%)", background: "white", border: "1px solid #e2e8f0", borderRadius: 10, padding: "3px 10px", boxShadow: "0 2px 12px rgba(0,0,0,0.1)", gap: 2 }}>
                            <button onClick={() => { setZoom(z => parseFloat(Math.max(0.15, z - 0.1).toFixed(2))); setFitActive(false); }}
                                className="flex items-center justify-center w-6 h-6 rounded hover:bg-black/5 transition-all"
                                style={{ color: "#64748b", fontSize: 18, lineHeight: 1 }}>−</button>
                            <span style={{ color: "#1e293b", fontSize: 11, fontWeight: 600, minWidth: 38, textAlign: "center" }}>{zoomPct}%</span>
                            <button onClick={() => { setZoom(z => parseFloat(Math.min(3, z + 0.1).toFixed(2))); setFitActive(false); }}
                                className="flex items-center justify-center w-6 h-6 rounded hover:bg-black/5 transition-all"
                                style={{ color: "#64748b", fontSize: 18, lineHeight: 1 }}>+</button>
                            <div style={{ width: 1, height: 14, background: "#e2e8f0", margin: "0 6px" }} />
                            {[50, 75, 100, 150].map(p => (
                                <button key={p}
                                    onClick={() => { setZoom(p / 100); setFitActive(false); }}
                                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold transition-all hover:bg-black/5"
                                    style={{ color: !fitActive && zoomPct === p ? "#3b82f6" : "#64748b", background: !fitActive && zoomPct === p ? "rgba(59,130,246,0.08)" : "transparent" }}>
                                    {p}%
                                </button>
                            ))}
                            <div style={{ width: 1, height: 14, background: "#e2e8f0", margin: "0 6px" }} />
                            <button onClick={fitZoom}
                                className="rounded px-2 py-0.5 text-[10px] font-bold hover:bg-black/5 transition-all"
                                style={{ color: fitActive ? "#3b82f6" : "#64748b", background: fitActive ? "rgba(59,130,246,0.08)" : "transparent" }}>
                                Fit
                            </button>
                        </div>
                    )}
                </div>

                {/* ── Settings panel ── */}
                {showSettings && (
                    <div className="shrink-0 flex flex-col" style={{ width: 272, background: "#161618", borderLeft: "1px solid #2a2a2a" }}>
                        <div className="flex items-center justify-between shrink-0"
                            style={{ padding: "0 16px", height: 54, borderBottom: "1px solid #2a2a2a" }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: "#fff", letterSpacing: "-0.2px" }}>Settings</span>
                            <button onClick={() => setShowSettings(false)}
                                className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/10 transition-all"
                                style={{ color: "#555" }}>
                                <X size={14} strokeWidth={2.5} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto" style={{ padding: "20px 16px", display: "flex", flexDirection: "column", gap: 20 }}>

                            <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>Style</div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                                    <Toggle checked={opts.coloredHeaders} onChange={() => upd({ coloredHeaders: !opts.coloredHeaders })} label="Colored headers" />
                                    <Toggle checked={opts.showTypes} onChange={() => upd({ showTypes: !opts.showTypes })} label="Show types" />
                                    <Toggle checked={opts.showLabels} onChange={() => upd({ showLabels: !opts.showLabels })} label="Relationship labels" />
                                    <Toggle checked={opts.curvedArrows} onChange={() => upd({ curvedArrows: !opts.curvedArrows })} label="Curved arrows" />
                                    <Toggle checked={opts.darkBg} onChange={() => upd({ darkBg: !opts.darkBg })} label="Dark background" />
                                </div>
                            </div>

                            <div style={{ height: 1, background: "#222" }} />

                            <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>Table Colors</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                    {tableLayouts.map((t) => (
                                        <div key={t.name} title={t.name}
                                            style={{ width: 20, height: 20, borderRadius: 6, background: t.color, cursor: "default", border: "1px solid rgba(255,255,255,0.15)" }} />
                                    ))}
                                </div>
                                {tableLayouts.length === 0 && <span style={{ fontSize: 11, color: "#555" }}>No tables parsed yet</span>}
                            </div>

                            <div style={{ height: 1, background: "#222" }} />

                            <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14 }}>Layout</div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                    <SliderRow label="Table width" value={layout.tableWidth} min={140} max={360} onChange={v => updL({ tableWidth: v })} />
                                    <SliderRow label="Row height" value={layout.rowHeight} min={20} max={48} onChange={v => updL({ rowHeight: v })} />
                                    <SliderRow label="Header height" value={layout.headerHeight} min={28} max={64} onChange={v => updL({ headerHeight: v })} />
                                    <SliderRow label="H-gap" value={layout.hGap} min={20} max={200} onChange={v => updL({ hGap: v })} />
                                    <SliderRow label="V-gap" value={layout.vGap} min={20} max={160} onChange={v => updL({ vGap: v })} />
                                </div>
                            </div>

                            <div style={{ height: 1, background: "#222" }} />

                            <div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 9 }}>Export</div>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                                    <button onClick={exportPng} className="py-2.5 rounded-xl text-[12px] font-semibold transition-all hover:brightness-110 active:scale-95" style={{ background: "#f97316", color: "white", cursor: "pointer" }}>PNG</button>
                                    <button onClick={exportSvg} className="py-2.5 rounded-xl text-[12px] font-semibold transition-all hover:brightness-110 active:scale-95" style={{ background: "#0891b2", color: "white", cursor: "pointer" }}>SVG</button>
                                    <button onClick={exportCode} className="py-2.5 rounded-xl text-[12px] font-semibold transition-all hover:brightness-110 active:scale-95" style={{ background: "#3b82f6", color: "white", cursor: "pointer" }}>SQL</button>
                                    <button onClick={exportJson} className="py-2.5 rounded-xl text-[12px] font-semibold transition-all hover:brightness-110 active:scale-95" style={{ background: "#22c55e", color: "white", cursor: "pointer" }}>JSON</button>
                                    <button onClick={copyCode} className="col-span-2 py-2.5 rounded-xl text-[12px] font-semibold transition-all hover:brightness-110 active:scale-95" style={{ background: copied ? "#34c759" : "#8b5cf6", color: "white", cursor: "pointer" }}>{copied ? "✓ Copied" : "Copy SQL"}</button>
                                </div>
                            </div>

                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
