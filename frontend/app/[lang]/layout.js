import LangFrame from "@/components/LangFrame";
import { normalizeLang } from "@/lib/site";

export default async function LangLayout({ children, params }) {
  const { lang } = await params;
  const activeLang = normalizeLang(lang);

  return <LangFrame lang={activeLang}>{children}</LangFrame>;
}
