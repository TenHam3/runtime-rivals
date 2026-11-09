import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Runtime Rivals",
  description: "Real-time competitive programming duels with friends",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
