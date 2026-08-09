import { useMemo, useRef, useState } from "react";
import {
  EXCLUDEABLE_TAG_VOCAB,
  MAX_EXCLUDED_TAGS,
  normalizeTagToken,
  parseExcludedTagsText,
} from "./lib/settings";

type Props = {
  tags: readonly string[];
  onChange: (tags: string[]) => void;
};

function mergeTags(current: readonly string[], additions: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of [...current, ...additions]) {
    const token = normalizeTagToken(item);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= MAX_EXCLUDED_TAGS) break;
  }
  return out;
}

export function ExcludedTagsField({ tags, onChange }: Props) {
  const [input, setInput] = useState("");
  const [vocabOpen, setVocabOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = new Set(tags);

  const suggestions = useMemo(() => {
    const q = input.trim().toLowerCase().replace(/[\s-]+/g, "_");
    return EXCLUDEABLE_TAG_VOCAB.filter((tag) => {
      if (selected.has(tag)) return false;
      if (!q) return true;
      return tag.includes(q);
    }).slice(0, 8);
  }, [input, tags]);

  function commitRaw(raw: string) {
    const parsed = parseExcludedTagsText(raw);
    if (!parsed.length) return;
    onChange(mergeTags(tags, parsed));
    setInput("");
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  function addTag(tag: string) {
    onChange(mergeTags(tags, [tag]));
    setInput("");
    inputRef.current?.focus();
  }

  return (
    <div className="settings-field settings-span-2 excluded-tags-field">
      <span>Excluded tags</span>
      <div className="excluded-tags-box">
        <div className="excluded-tags-chips" aria-label="Excluded tags">
          {tags.length ? (
            tags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="excluded-tag-chip"
                onClick={() => removeTag(tag)}
                title={`Remove ${tag}`}
              >
                <span>{tag}</span>
                <span aria-hidden="true" className="excluded-tag-x">
                  ×
                </span>
              </button>
            ))
          ) : (
            <span className="excluded-tags-empty">None — tag excludes disabled</span>
          )}
        </div>
        <div className="excluded-tags-input-row">
          <input
            ref={inputRef}
            className="excluded-tags-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                commitRaw(input);
              } else if (e.key === "Backspace" && !input && tags.length) {
                removeTag(tags[tags.length - 1]!);
              }
            }}
            onBlur={() => {
              if (input.trim()) commitRaw(input);
            }}
            placeholder="Type a tag, comma or Enter to add"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            list="excluded-tags-suggest"
            aria-autocomplete="list"
          />
          <datalist id="excluded-tags-suggest">
            {EXCLUDEABLE_TAG_VOCAB.filter((tag) => !selected.has(tag)).map(
              (tag) => (
                <option key={tag} value={tag} />
              ),
            )}
          </datalist>
        </div>
        {input.trim() && suggestions.length ? (
          <ul className="excluded-tags-suggest" role="listbox">
            {suggestions.map((tag) => (
              <li key={tag}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => addTag(tag)}>
                  {tag}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <span className="settings-help">
        Still tagged by triage; dropped from Curated. Matches flags and intent.
        Comma or newline separated; whitespace stripped. Empty list disables tag
        excludes.
      </span>
      <details
        className="excluded-tags-vocab"
        open={vocabOpen}
        onToggle={(e) => setVocabOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary>Available tags to exclude</summary>
        <div className="excluded-tags-vocab-list">
          {EXCLUDEABLE_TAG_VOCAB.map((tag) => {
            const active = selected.has(tag);
            return (
              <button
                key={tag}
                type="button"
                className={
                  active
                    ? "excluded-tag-chip excluded-tag-chip-active"
                    : "excluded-tag-chip excluded-tag-chip-muted"
                }
                onClick={() => (active ? removeTag(tag) : addTag(tag))}
                disabled={
                  !active && tags.length >= MAX_EXCLUDED_TAGS
                }
              >
                {tag}
              </button>
            );
          })}
        </div>
      </details>
    </div>
  );
}
