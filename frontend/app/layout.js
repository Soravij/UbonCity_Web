import "./globals.css";

export const metadata = {
  title: "UbonCity Travel Guide",
  description: "Discover Ubon Ratchathani attractions, hotels, cafes, restaurants, and local transport.",
  icons: {
    icon: "/favicon-u.svg",
    shortcut: "/favicon-u.svg",
    apple: "/favicon-u.svg",
  },
  other: {
    google: "notranslate",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" translate="no">
      <body className="antialiased notranslate" translate="no">
        {children}
      </body>
    </html>
  );
}

