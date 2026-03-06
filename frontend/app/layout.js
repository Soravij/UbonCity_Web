import "./globals.css";

export const metadata = {
  title: "UbonCity Travel Guide",
  description: "Discover Ubon Ratchathani attractions, hotels, cafes, restaurants, and local transport.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
