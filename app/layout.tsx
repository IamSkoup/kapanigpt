import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KapaniGPT — твой ИИ-ассистент",
  description: "Тёмный AI-чат KapaniGPT. Умные ответы, история диалогов, изображения и файлы.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
