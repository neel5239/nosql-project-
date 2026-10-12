/* Online course + video recommendations, fetched from YouTube search and
   cached in MongoDB (collection `recommendations`).

   No API key needed: we read the public search page and pull the embedded
   ytInitialData JSON. Only ids we validate are kept; every URL the browser
   ever sees is rebuilt here from a validated id — never copied from the page. */
const { col } = require('./db');

const VID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST = /^(PL|OL|UU)[A-Za-z0-9_-]{10,64}$/;
const TTL_MS = 7 * 24 * 3600 * 1000;
const clean = s => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 160);

const BAND_WORD = { L1: 'basics concept', L2: 'concept with examples', L3: 'advanced problems', L4: 'JEE Advanced problems' };
function queryFor(topicName, band) { return `${topicName} ${BAND_WORD[band] || ''} JEE physics`.trim(); }

async function fetchSearch(q, playlists) {
  try { return await fetchOnce(q, playlists) }
  catch (e) { await new Promise(r => setTimeout(r, 1500)); return fetchOnce(q, playlists) }   // one retry — YouTube throttles bursts
}
async function fetchOnce(q, playlists) {
  const url = 'https://www.youtube.com/results?hl=en&gl=IN&search_query=' + encodeURIComponent(q) + (playlists ? '&sp=EgIQAw%253D%253D' : '');
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'accept-language': 'en-IN,en;q=0.9', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36' } });
    if (!r.ok) throw new Error('youtube ' + r.status);
    const html = await r.text();
    const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s) || html.match(/ytInitialData"\]\s*=\s*(\{.*?\});/s);
    if (!m) throw new Error('no ytInitialData');
    return JSON.parse(m[1]);
  } finally { clearTimeout(t); }
}

function walk(node, fn, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 40) return;
  fn(node);
  for (const k in node) walk(node[k], fn, depth + 1);
}

function parseVideos(data, max) {
  const out = [], seen = new Set();
  walk(data, n => {
    const v = n.videoRenderer;
    if (!v || out.length >= max || !VID.test(v.videoId) || seen.has(v.videoId)) return;
    if (v.badges?.some(b => /live/i.test(JSON.stringify(b)))) return;
    seen.add(v.videoId);
    out.push({
      kind: 'video', id: v.videoId,
      title: clean(v.title?.runs?.map(r => r.text).join('') || v.title?.simpleText),
      channel: clean(v.ownerText?.runs?.[0]?.text),
      length: clean(v.lengthText?.simpleText),
      views: clean(v.viewCountText?.simpleText || v.shortViewCountText?.simpleText),
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
      thumb: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`
    });
  });
  return out;
}

function parsePlaylists(data, max) {
  const out = [], seen = new Set();
  walk(data, n => {
    if (out.length >= max) return;
    let id, title, channel, count, thumbVid;
    if (n.playlistRenderer) {
      const p = n.playlistRenderer;
      id = p.playlistId; title = p.title?.simpleText || p.title?.runs?.[0]?.text;
      channel = p.shortBylineText?.runs?.[0]?.text; count = p.videoCount; thumbVid = p.navigationEndpoint?.watchEndpoint?.videoId;
    } else if (n.lockupViewModel && /PLAYLIST/.test(n.lockupViewModel.contentType || '')) {
      const l = n.lockupViewModel, md = l.metadata?.lockupMetadataViewModel;
      id = l.contentId; title = md?.title?.content;
      const rows = md?.metadata?.contentMetadataViewModel?.metadataRows || [];
      channel = rows[0]?.metadataParts?.[0]?.text?.content;
      const ov = JSON.stringify(l.contentImage || {}).match(/"text":"(\d+) (?:videos|lessons)"/);
      count = ov ? ov[1] : '';
      const tv = JSON.stringify(l.contentImage || {}).match(/\/vi\/([A-Za-z0-9_-]{11})\//);
      thumbVid = tv ? tv[1] : '';
    } else return;
    if (!PLAYLIST.test(id || '') || seen.has(id)) return;
    seen.add(id);
    out.push({
      kind: 'course', id, title: clean(title), channel: clean(channel), lessons: clean(count),
      url: `https://www.youtube.com/playlist?list=${id}`,
      thumb: VID.test(thumbVid || '') ? `https://i.ytimg.com/vi/${thumbVid}/mqdefault.jpg` : ''
    });
  });
  return out;
}

/* returns cached doc if fresh; otherwise fetches, stores, returns.
   If YouTube is unreachable, the last cached copy is served (stale but real). */
async function getRecommendations(topicId, topicName, band, { force = false } = {}) {
  const c = col('recommendations');
  const cached = await c.findOne({ topic: topicId, band }, { projection: { _id: 0 } });
  if (cached && !force && Date.now() - new Date(cached.fetchedAt).getTime() < TTL_MS) return { ...cached, source: 'cache' };
  const query = queryFor(topicName, band);
  try {
    const [vData, pData] = await Promise.all([fetchSearch(query, false), fetchSearch(query + ' full course', true)]);
    const videos = parseVideos(vData, 4), courses = parsePlaylists(pData, 2);
    if (!videos.length && !courses.length) throw new Error('empty result');
    const doc = { topic: topicId, topicName, band, query, videos, courses, fetchedAt: new Date() };
    await c.updateOne({ topic: topicId, band }, { $set: doc }, { upsert: true });
    return { ...doc, source: 'youtube' };
  } catch (e) {
    if (cached) return { ...cached, source: 'stale-cache', error: 'YouTube unreachable — showing last saved list' };
    return { topic: topicId, topicName, band, query, videos: [], courses: [], fetchedAt: null, source: 'none', error: 'Could not reach YouTube and nothing is saved yet.' };
  }
}

module.exports = { getRecommendations, queryFor, parseVideos, parsePlaylists };
