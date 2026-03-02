import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    themeColor: "#111113",
};

export const metadata: Metadata = {
    title: "ERD++",
    description: "Entity Relationship Diagram generator — paste SQL CREATE TABLE statements and get a polished ERD instantly.",
    metadataBase: new URL("https://erd-bheng.vercel.app"),
    icons: {
        icon: "/favicon.svg",
        shortcut: "/favicon.svg",
        apple: "/favicon.svg",
    },
    openGraph: {
        title: "ERD++ — Entity Relationship Diagram Generator",
        description: "Paste SQL schema, get beautiful ERD diagrams instantly.",
        type: "website",
    },
    twitter: {
        card: "summary_large_image",
        title: "ERD++ — Entity Relationship Diagram Generator",
        description: "Paste SQL schema, get beautiful ERD diagrams instantly.",
    },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body suppressHydrationWarning>{children}</body>
        </html>
    );
}
