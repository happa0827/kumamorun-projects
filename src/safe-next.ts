// ログインや種類の選択のあとの移動先（?next=）を、同じサイトの経路だけに絞る。サーバーとブラウザの両方で使う。
// 文字列の先頭だけを見ると、/\evil.com（ブラウザは \ を / と読むので //evil.com）や、
// タブや改行を挟んだ形（URL の解釈で取り除かれる）を通してしまう。ブラウザと同じ URL の解釈で確かめる。

/** 解釈の基準にする仮の origin。同じ origin のままなら、サイトの中の経路。 */
const BASE = "http://same-origin.invalid";

export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/")) return "/";
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return "/";
  }
  if (url.origin !== BASE) return "/";
  // 解釈し直した形を返す（\ や制御文字の残った元の文字列は使わない）。
  // ただし解釈で . と .. がたたまれ、/.//evil.com や /%2e//evil.com は //evil.com（別のサイト）になる。
  // 返す値そのものを、もう一度同じように確かめる。
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (path.startsWith("//") || new URL(path, BASE).origin !== BASE) return "/";
  return path;
}
