<div align="center">

# ERD++

Paste SQL `CREATE TABLE` statements and get a polished ER diagram.

[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](package.json)
[![React](https://img.shields.io/badge/React-19-149eca?logo=react)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript)](tsconfig.json)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3-38bdf8?logo=tailwindcss)](tailwind.config.ts)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Live -> [erd-bheng.vercel.app](https://erd-bheng.vercel.app)**

![ERD++ screenshot](screenshot.png)

</div>

## Features

- **SQL schema input** - paste `CREATE TABLE` statements (Postgres, MySQL, SQLite, SQL Server-style quoting) and watch the diagram render live as you type.
- **Relationship detection** - inline `REFERENCES`, table-level `FOREIGN KEY (...) REFERENCES ...` (including composite keys), and table-level `PRIMARY KEY (...)` are all parsed; duplicate relationships are deduped automatically.
- **Custom relationship labels** - label an edge inline with a trailing `-- comment`, or declare a whole set up front in an `-- @rels` block (`parent -> child : label`).
- **Automatic hierarchical layout** - tables with no incoming foreign keys become the top row; children are placed one level below their parent via a breadth-first pass, and each row is centered under the widest row.
- **Colorful, readable nodes** - each table gets a color from a fixed 12-color palette, a rounded card, PK/FK badges, zebra-striped rows, and optional column types.
- **Curved (or straight) relationship arrows** with one-to-many notation - hash marks at the "one" end, an "N" at the many end - fanned out across the parent edge when a table has multiple children.
- **Pan & zoom canvas** - click-drag to pan, Ctrl/Cmd+scroll to zoom, a floating toolbar with +/-, 50/75/100/150% presets, and Fit-to-view.
- **Live style & layout controls** - toggle colored headers, column types, relationship labels, curved vs. straight arrows, and a dark canvas background; tune table width, row height, header height, and gaps with sliders.
- **Resizable, themeable SQL editor** - drag-to-resize panel, independent light/dark toggle, copy-to-clipboard.
- **Export** - 2x-retina PNG, raw SVG, the SQL source, or the parsed schema as JSON.
- **Local persistence** - your schema, style options, and layout settings are saved to `localStorage`, so a refresh picks up where you left off.
- **Mobile responsive**, fully client-side - no backend, no database, no account.

## How it works

`app/page.tsx` is a single client component that runs a four-stage pipeline on every keystroke, memoized with `useMemo`:

```mermaid
flowchart LR
    SQL[SQL text] --> Parse["parseSQL()\nregex CREATE TABLE + paren-aware\ncomma split -> tables, columns, rels"]
    Parse --> Layout["computeLayout()\nBFS levels by FK topology\n-> x/y per table"]
    Layout --> Render["buildErdSvg()\nhand-built SVG string:\nnodes, bezier/line edges, badges"]
    Render --> DOM[dangerouslySetInnerHTML into the canvas]
```

- **Parse** - `parseSQL` first splits each `CREATE TABLE` body on top-level commas (tracking paren depth and `--` comments so nested types like `NUMERIC(10,2)` survive), then reads primary keys, foreign keys (inline and table-level), and column types off the remaining lines.
- **Layout** - `computeLayout` builds a parent/child map from the detected relationships, assigns each table a level by walking from root tables (no parents) outward, and lays out each level as a centered row.
- **Render** - `buildErdSvg` emits one raw SVG string by hand (no diagramming library): rounded table cards with a colored header, PK/FK markers, zebra rows, and cubic-bezier or straight connector paths with crow's-foot-style "one" ticks and an "N" label at the many end.
- The same SVG string is rasterized to PNG (via an offscreen `<canvas>`) for export, or downloaded as-is for the SVG option.

There is no server component and no API route - `next.config.ts` builds the app with `output: "export"`, so the whole thing ships as static HTML/JS/CSS.

## Tech stack

| Layer | Tech |
|---|---|
| Framework | Next.js 15 (App Router), static export (`output: "export"`) |
| UI | React 19, TypeScript (strict mode) |
| Styling | Tailwind CSS |
| Icons | lucide-react |
| Diagram rendering | Hand-built SVG string builder - no charting/diagram library |
| State | React hooks + `localStorage`, no backend or database |
| Hosting | Vercel |

## Getting started

```bash
git clone https://github.com/bunlongheng/erd.git
cd erd
npm install
npm run dev
```

Open [http://localhost:3003](http://localhost:3003) and paste a schema into the SQL panel.

| Script | Description |
|---|---|
| `npm run dev` | Dev server on port 3003 |
| `npm run build` | Static production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |

---

<div align="center">

<a href="https://bunlongheng.com"><img src="https://img.shields.io/badge/-bunlongheng.com-3A3A3C?style=for-the-badge&amp;labelColor=2A2A2C&amp;logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAMAAABF0y%2BmAAADAFBMVEXx8vLq6v%2F19fX09PT8%2Ff309PT5%2BfnAwMBMaXHx8vL19fX5%2Bfny8vL09PT39%2Ff6%2Bfn6%2Bvr09PTx8fH4%2BPn%2F8vLy8%2FP09PTz8%2FPy8vL%2F%2F%2F%2Fz9PTz9PP19fby8vP19PXz8%2FT19%2Fb08%2FTx8vLy8vL09vby8%2FL29vf19fTv8PDz9vb7%2Bvn%2F%2Ff%2F9%2Ff3w8vH29fb%2F%2FP339%2Ff5%2Bfn59%2Ff19PT09PR7rao3VF3%2F%2Fv8AKDR6sqsBV1vv8fL4%2BPiux8b8%2Bvq90NDy8%2FR%2BlpppnZyZqrACLTxclZJSkI9en5ssZ2luqaUAeWgqbW4BX1gCfG0%2Fa3QaVG0MN0UKNUKUpKsGpYMAKjoRQ1UDf3AQRloJqIgEm32d0cUBg3ElbnQIln8eVWgrmIdP0KzF5d5s2acdfHwppJCP5MMXl4Tz8%2FLv8%2FP39%2FiewL5%2BqahYf4IrTFZkk5KlxsREiIYAHiqDnKFmnJowc3IdVllvpKK7zc3D2tnk5%2BmuycdwpKKuub2yv8Ly%2B%2FkAMT7z%2Bvjq7e09gH93q6kGdWpGgoJZmJSlw8M7c3WwyceTw76w1M8mYmpFfX8lW2AFOEpGiYhxqqRrqaRb2rdIsZ8AVE91jpU7d3t3saqBoKhako4AWVEcUlg3aWwDupAHb2YwmIkPP1ERSVA7WmZ8tq8HT14oZW%2BYuLsMl3wQT10ROksENUc8Z3MJSGVLh4dqpJ%2BXr7U51awUgHM4v6ad1MkPuJZAiowVd3IEhnZH0aoYrI05p5sDtYwkzZ8EPViYxsRel5USbHAIgmwIM0gQamzU4uF2malQi4oWQFQ1zaYrp4UXlYwfiHoyxqFE1q4qeX4yn5JIxKkdrX1b1rAbWGvd5Oh91sRijpomsJEVc3Ukc34dqIcwuJVKwZIXkoQZcXlNv5g%2BqZUZvpNl2rPG9N0WkIoNqouW4sVPwp%2BM0b6h0ssfq4d%2F1r8hpo%2Fh9e4AamUjnI9avaBixqgklYWSwL4xtItUxplYl5qZ58mq78wMgnYXfnlOmJaR1L%2Bj78ny9fS%2FrXQPAAAAFXRSTlP7Brvx%2FsJhAgD87r4U72C4uGH8vhRDodYHAAAACXBIWXMAAAsTAAALEwEAmpwYAAAC6UlEQVQokS2Sd3BUVRSHb0KS3QRCiZw5t%2By9j33zXjZkyUs2uekhEAi9dwRCL4JUEQRFAQUs9A4WOopKU0GpFoqCBZUivaqoFKkWLIS5GX7%2FfnPO78yZj%2Fj8UTViK6HggvNgSGuluEZRKbZqlN9H%2FFWiWUzIFQK5fhjOIRTDoqv4ia86S4q3KSByHdSqIhxofBKr5iNxLMm2bQqWVkorJ%2BAkO46nkQJhceSRmCTDvKJIJBLJzMxMLU6POJ4eBPF1KpNEbdt2Cms4LCcnZ%2FX6D3d%2BsKJJ7VSlNLoqgbjUtmkKKxlVmpf3bsFXW3d1b77gueJAQIPQBCilkMKemNi23Ts9T35%2FaMe2rsvmTypylGUFCSIYWJLXrm2nUwOPfNO5w%2B73Okxnjqe0JigQEL3JizoeONr%2F2u99vju4fd1rdZnyspQmnGvAUBprWNqz348%2FhXN%2F6P1%2By4Uvs%2FJkpRQRwpJBRVn7vf16Dfitz5XevQqWt3yalXtKaRIUQmglWfsu5y7%2BMrDs0TMftWo1ZVy64xioOVpcIdt8%2Fvqvf9%2F859KJsrLmrzA%2BOKC0IkFEtJza7JOfr%2FYd0P9G98tdOxe0Hp9qJrOIBgDuOeEtp%2F%2B4d%2FvWX%2F%2F9u%2B%2FtlaUTmOWZg7SQEEyuFe52%2BML9O3cZO%2F5xl06zn2VcadOJUqJTzt7a82XfP7sx9vmGNm1m1MstV4IHCVAAoTLqL1372ddn%2Fz%2B2v%2FWq12c1fSpsaeQWAZAANntxzuI3e3zbo8XGpm%2FMnNqiXrh%2BljaPd6UUabkjps19tdGnX2zKb9b4pTFDCzOMLmYtpW5h%2BpCRTeYtyV%2BT36zx808OL4xYGoFrkqDTbJpSXLdRgwbPZL%2BQnT129OOPFVEEsAMJpHKdeKMJgJSAiALdjJANQKnRJI4R6boAKEwLCiGoBBegQjBftQo1KQWOlplFKSV9qGaF1NpAE7QQESTlMSy6pp%2F4%2FFFVYxMNRBTaiM0tkImxNaL8vgfDR8gvoYRaxgAAAABJRU5ErkJggg%3D%3D" alt="bunlongheng.com"></a>
<a href="https://www.linkedin.com/in/bunlongheng/"><img src="https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white" alt="LinkedIn"></a>
<a href="https://www.instagram.com/ibunlong/"><img src="https://img.shields.io/badge/Instagram-C13584?style=for-the-badge&logo=instagram&logoColor=white" alt="Instagram"></a>
<a href="mailto:bheng.code@gmail.com"><img src="https://img.shields.io/badge/Email-2E7D32?style=for-the-badge&logo=gmail&logoColor=white" alt="Email"></a>

<br>

Built by **[Bunlong](https://bunlongheng.com)** &nbsp;&middot;&nbsp; [more apps](https://bunlongheng.com/projects)

</div>
