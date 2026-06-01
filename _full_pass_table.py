"""Scan #panel-assignments.as-scope table properties for remaining duplicates."""
from pathlib import Path

lines = Path("collector/server/public/styles.css").read_text(encoding="utf-8").splitlines()

# Track property sets by selector-key for collision detection
rules_late = []  # blocks near end of file (~L7300+)
collecting = None
brace_depth = 0

for idx, raw in enumerate(lines, start=1):
    if idx < 7300:
        continue
    if (raw.startswith("#panel-assignments.as-scope") or raw.startswith(":root[data-theme=\"dark\"] #panel-assignments.as-scope")):
        if any(k in raw for k in ["table", "th", "td", "tfoot", "thead", "tbody", "row-selected", "action-stack", ".as-table"]):
            collecting = {"start": idx, "selectors": [raw], "lines": [raw]}
            brace_depth = raw.count("{") - raw.count("}")
    elif collecting is not None:
        collecting["selectors"].append(raw) if raw.strip() and not raw.strip().startswith("}") else None
        collecting["lines"].append(raw)
        brace_depth += raw.count("{") - raw.count("}")
        if brace_depth <= 0:
            selector_key = collecting["selectors"][0].strip().rstrip("{").strip()
            props = {}
            for l in collecting["lines"]:
                if ":" in l and "{" not in l:
                    parts = l.split(":", 1)
                    if len(parts) == 2:
                        k, v = parts[0].strip(), parts[1].strip().rstrip(";")
                        props[k] = v
            rules_late.append({"start": collecting["start"], "selector": selector_key, "props": props})
            collecting = None

# Group by property to find true duplicates
from collections import defaultdict
prop_map = defaultdict(list)
for r in rules_late:
    for prop, val in r["props"].items():
        key = f"{prop}:{val}"
        prop_map[key].append(r["start"])

print("=== Potential duplicates (same property:value across different blocks) ===\n")
for key, locs in sorted(prop_map.items()):
    if len(locs) > 1:
        # Only report if selectors actually overlap in what they target
        print(f"  {key}")
        for loc in locs:
            matching = [r for r in rules_late if r["start"] == loc]
            if matching:
                print(f"    L{loc}: {matching[0]['selector'][:130]}")
        print()

print("=== Look for border-collapse / border-spacing ===\n")
from pathlib import Path
file_text = Path("collector/server/public/styles.css").read_text(encoding="utf-8")
import re
for pat in ["border-collapse", "border-spacing"]:
    for m in re.finditer(rf"^.*{pat}.*$", file_text, re.MULTILINE):
        line_no = file_text[:m.start()].count("\n") + 1
        if "#panel-assignments" in m.group() or "as-table" in m.group() or "table\[" in m.group():
            print(f"  L{line_no}: {m.group().strip()[:130]}")
