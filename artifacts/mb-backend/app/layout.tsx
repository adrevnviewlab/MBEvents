import type { Metadata } from "next";
import "./mb-site.css";

export const metadata: Metadata = {
  title: "MB Events | Long Island Event Entertainment & Production",
  description:
    "MB Events creates unforgettable weddings, Sweet 16s, mitzvahs, corporate celebrations, and private events across Long Island.",
  icons: { icon: "/assets/mb-events-logo.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
