// GET /api/app/download  パソコンのアプリ（Windows）のインストーラーへ移動させる。
// インストーラーの名前にはバージョンが入るので、GitHub の最新リリースから探す。
// GitHub への問い合わせは Cloudflare に10分キャッシュさせ、API の回数制限に当たらないようにする。
// 見つからなければリリースのページへ移動させる（そこから手で選べる）。
import { defineHandler } from "void";

const REPO = "happa0827/kumamorun-app";
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const INSTALLER = /_x64-setup\.exe$/;

export const GET = defineHandler(async (c) => {
  return c.redirect((await installerUrl()) ?? RELEASES_PAGE, 302);
});

async function installerUrl(): Promise<string | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "kumamorun-download",
      },
      cf: { cacheTtl: 600, cacheEverything: true },
    });
    if (!response.ok) return null;
    const release = (await response.json()) as {
      assets?: { name: string; browser_download_url: string }[];
    };
    return (
      release.assets?.find((asset) => INSTALLER.test(asset.name))?.browser_download_url ?? null
    );
  } catch {
    return null;
  }
}
