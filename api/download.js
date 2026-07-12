// Clean download: resolves the latest release's .zip and 302-redirects straight
// to the file, so the browser downloads it without ever showing a GitHub page.
// Auto-tracks new releases; the 302 is CDN-cached briefly to stay under GitHub's
// unauthenticated API rate limit.

export const config = { runtime: 'edge' };

const RELEASES_API = 'https://api.github.com/repos/f8lmz/voicequill-releases/releases/latest';
// Last-resort only if GitHub's API is unreachable (rare). Never hit in normal operation.
const FALLBACK = 'https://github.com/f8lmz/voicequill-releases/releases/latest';

export default async function handler() {
  try {
    const r = await fetch(RELEASES_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'voicequill-site', // GitHub API rejects requests without a UA
      },
    });
    if (!r.ok) throw new Error(`github api ${r.status}`);
    const release = await r.json();
    const asset = (release.assets || []).find(
      (a) => a && typeof a.name === 'string' && a.name.toLowerCase().endsWith('.zip')
    );
    const url = asset && asset.browser_download_url;
    if (!url) throw new Error('no .zip asset in latest release');

    return new Response(null, {
      status: 302,
      headers: {
        Location: url,
        // Cache the resolved redirect ~5 min: most hits skip the API entirely,
        // and a new release is still picked up within the window.
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
    });
  } catch (e) {
    return new Response(null, { status: 302, headers: { Location: FALLBACK } });
  }
}
