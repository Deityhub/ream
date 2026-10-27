import { useEffect, useState } from "react";
import { Marketing, kicker, wrap } from "./Marketing";

// the texts are the repo's own files, loaded only when one of these pages opens
const sources = {
  licence: { title: "Licence", load: () => import("../../../LICENSE?raw") },
  notices: {
    title: "Third-party notices",
    load: () => import("../../../THIRD-PARTY-NOTICES.md?raw"),
  },
};
export type LegalPage = keyof typeof sources;

const inline = (s: string) =>
  s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");

/** a licence text wrapped at 80 columns, as paragraphs that wrap to the page (rules of dashes dropped) */
function Prose({ text, className = "" }: { text: string; className?: string }) {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .split("\n")
        .filter((l) => !/^-{5,}$/.test(l.trim()))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);
  return (
    <div className={`space-y-3 text-[15px] leading-relaxed ${className}`}>
      {paras.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

type Notice = { title: string; lines: string[]; text: string };
type Section = {
  title: string;
  notices: Notice[];
  items: string[];
  text: string;
};

/**
 * THIRD-PARTY-NOTICES.md as data: an intro, then sections (## ) of notices (### heading, a line or two, a fenced
 * licence) or of list items followed by one licence they share (the fonts and the OFL).
 */
function parse(md: string) {
  const intro: string[] = [];
  const sections: Section[] = [];
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const section = sections.at(-1);
    const notice = section?.notices.at(-1);
    if (line.startsWith("```")) {
      const body: string[] = [];
      while (++i < lines.length && !lines[i].startsWith("```"))
        body.push(lines[i]);
      if (notice && !notice.text) notice.text = body.join("\n");
      else if (section) section.text = body.join("\n");
    } else if (line.startsWith("## "))
      sections.push({ title: line.slice(3), notices: [], items: [], text: "" });
    else if (line.startsWith("### "))
      section?.notices.push({ title: line.slice(4), lines: [], text: "" });
    else if (line.startsWith("- ")) section?.items.push(inline(line.slice(2)));
    else if (line.trim() && !line.startsWith("#") && !line.startsWith("<!--")) {
      if (notice && !notice.text) notice.lines.push(inline(line));
      else if (!section) intro.push(inline(line));
    }
  }
  return { intro, sections };
}

const box = "blueprint flex flex-col gap-4 border border-line p-5 sm:p-6";

function Notices({ md }: { md: string }) {
  const { intro, sections } = parse(md);
  return (
    <div className="space-y-14">
      {intro.map((p, i) => (
        <p key={i} className="max-w-[75ch] text-lg leading-relaxed text-muted">
          {p}
        </p>
      ))}
      {sections.map((s) => (
        <section key={s.title} className="space-y-8">
          <h2 className={kicker}>{s.title}</h2>
          {s.notices.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(26rem,100%),1fr))] gap-6">
              {s.notices.map((n) => (
                <article key={n.title} className={box}>
                  <h3 className="text-xl">{n.title}</h3>
                  {n.lines.map((l, i) => (
                    <p key={i} className="text-[15px] leading-relaxed">
                      {l}
                    </p>
                  ))}
                  <Prose text={n.text} className="text-muted" />
                </article>
              ))}
            </div>
          )}
          {s.items.length > 0 && (
            // the fonts beside the one licence they share
            <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <ul className="space-y-4">
                {s.items.map((it) => {
                  const at = it.indexOf(": ");
                  return (
                    <li
                      key={it}
                      className="border-l border-line pl-3 text-[15px] leading-relaxed"
                    >
                      <span className="font-semibold">
                        {at < 0 ? it : it.slice(0, at)}
                      </span>
                      {at >= 0 && (
                        <span className="block text-muted">
                          {it.slice(at + 2)}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              {s.text && (
                <div className={box}>
                  <Prose text={s.text} className="text-muted" />
                </div>
              )}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

/** Ream's licence, or the licences of what it ships from others, as pages of the site. */
export function Legal({ page }: { page: LegalPage }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setText(null);
    sources[page].load().then((m) => live && setText(m.default));
    return () => {
      live = false;
    };
  }, [page]);
  const title = (
    <h1 className="pb-8 text-[clamp(2.5rem,5vw,4rem)] leading-[1.04] uppercase">
      {sources[page].title}
    </h1>
  );
  const loading = (
    <p role="status" className="text-muted">
      Loading…
    </p>
  );
  return (
    <Marketing>
      <article className={`${wrap} pt-16`}>
          {title}
          {text === null ? (
            loading
          ) : page === "licence" ? (
            <div className={box}>
              <Prose text={text} />
            </div>
          ) : (
            <Notices md={text} />
          )}
        </article>
    </Marketing>
  );
}
