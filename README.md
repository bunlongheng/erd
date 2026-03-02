# ERD++

> Entity Relationship Diagram generator — paste SQL `CREATE TABLE` statements and get a polished ERD instantly.

**Live → [erd-bheng.vercel.app](https://erd-bheng.vercel.app)**

![Screenshot](screenshot.png)

---

## Features

- **SQL schema input** — paste `CREATE TABLE` statements and see the ERD rendered live
- **Colorful nodes** — each table gets a unique color from the palette, rounded corners, white bold text
- **Relationship lines** — foreign key relationships auto-detected and drawn as arrows
- **Pan & zoom canvas** — scroll, pinch, drag to navigate; `F` to fit
- **Dark / Light / Monokai themes**
- **Resizable code editor** with dark mode toggle
- **Export PNG** (2× retina), export raw SQL, copy to clipboard
- **Mobile responsive**

## Usage

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  created_at TIMESTAMP
);

CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  title VARCHAR(255),
  body TEXT
);
```

Paste into the editor → ERD renders instantly.

## Stack

- Next.js 15 · React 19 · TypeScript
- Custom SVG renderer
- Tailwind CSS · Bun
