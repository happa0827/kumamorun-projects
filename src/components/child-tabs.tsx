// 親が、見る子供を切り替えるタブ（状況とショップ）。?child=<ID> で子供を選ぶ。
import { Link } from "@void/react";

export function ChildTabs({
  base,
  list,
  selected,
}: {
  base: "/" | "/shop";
  list: { id: string; name: string }[];
  selected: string;
}) {
  return (
    <nav aria-label="子供" className="nav child-tabs">
      {list.map((child) => {
        const q = `child=${encodeURIComponent(child.id)}`;
        return (
          <Link
            key={child.id}
            href={base === "/" ? `/?${q}` : `/shop?${q}`}
            aria-current={child.id === selected ? "page" : undefined}
          >
            {child.name || "（名前なし）"}
          </Link>
        );
      })}
    </nav>
  );
}
