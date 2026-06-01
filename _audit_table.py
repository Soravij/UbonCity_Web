หกfrom pathlib import Path

lines = Path("collector/server/public/styles.css").read_text(encoding="utf-8").splitlines()

blocks = []
collecting = None
brace_depth = 0

for idx, raw in enumerate(lines, start=1):
    if raw.startswith("#panel-assignments.as-scope") or raw.startswith(":root[data-theme=\"dark\"] #panel-assignments.as-scope") or raw.startswith(":root[data-theme=\"dark\"] #panel-assignments.as-scope"):
        if "table" in raw or "as-table" in raw or "row-selected" in raw or "action-stack" in raw or "border-collapse" in raw or "border-spacing" in raw or "table-layout" in raw:
            collecting = {"start": idx, "selectors": raw, "lines": [raw]}
            brace_depth = raw.count("{") - raw.count("}")
    elif collecting is not None:
        collecting["lines"].append(raw)
        brace_depth += raw.count("{") - raw.count("}")
        if brace_depth <= 0:
            blocks.append(collecting)
            collecting = None

print(f"Found {len(blocks)} blocks matching criteria")
for b in blocks[-30:]:
    print(f"\n=== L{b['start']} ===")
    for l in b["lines"][:10]:
        print(l[:140])
    if len(b["lines"]) > 10:
        print(f"... ({len(b['lines']) - 10} more lines)")
