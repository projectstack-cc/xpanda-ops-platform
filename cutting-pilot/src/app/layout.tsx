export const metadata = {
  title: "xPanda Cutting — v2",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-bg text-text font-sans antialiased">{children}</body>
    </html>
  );
}
