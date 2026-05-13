import "./globals.css";
import ThemeModeControl from "@/components/ThemeModeControl";

const THEME_BOOTSTRAP_SCRIPT = `
(() => {
  const key = "ubon_theme_preference";
  const allowed = new Set(["light", "dark", "system"]);
  const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const root = document.documentElement;

  const sanitize = (value) => (allowed.has(value) ? value : "system");

  const readStoredPreference = () => {
    try {
      return sanitize(localStorage.getItem(key));
    } catch {
      return "system";
    }
  };

  const resolveTheme = (preference) => {
    if (preference === "system") {
      return media && media.matches ? "dark" : "light";
    }
    return preference;
  };

  const applyPreference = (nextPreference, shouldPersist) => {
    const preference = sanitize(nextPreference);
    const resolvedTheme = resolveTheme(preference);
    root.setAttribute("data-theme", resolvedTheme);
    root.setAttribute("data-theme-preference", preference);
    if (shouldPersist) {
      try {
        localStorage.setItem(key, preference);
      } catch {}
    }
    return { preference, resolvedTheme };
  };

  const syncWithSystemTheme = () => {
    const currentPreference = sanitize(root.getAttribute("data-theme-preference"));
    if (currentPreference === "system") {
      applyPreference("system", false);
    }
  };

  applyPreference(readStoredPreference(), false);

  if (media) {
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", syncWithSystemTheme);
    } else if (typeof media.addListener === "function") {
      media.addListener(syncWithSystemTheme);
    }
  }

  window.__UBON_THEME__ = {
    key,
    getPreference() {
      return sanitize(root.getAttribute("data-theme-preference"));
    },
    setPreference(preference) {
      return applyPreference(preference, true);
    },
    syncSystem: syncWithSystemTheme,
  };
})();
`;

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
    <html lang="en" translate="no" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="antialiased notranslate" translate="no">
        <ThemeModeControl />
        {children}
      </body>
    </html>
  );
}
