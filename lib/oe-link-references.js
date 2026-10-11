function parseOeLinkReferences(text, acceptsUrl = url => /^https?:\/\/(?:localhost|127\.0\.0\.1):\d+\//i.test(url)) {
  const refs = [];
  const re = /https?:\/\/[^\s)"'<>]+\/images\/([^/?#\s)"'<>]+)\.info(?![\w.%-])/gi;
  let match;
  while ((match = re.exec(String(text || ""))) !== null) {
    if (!acceptsUrl(match[0])) continue;
    let id = match[1];
    try { id = decodeURIComponent(id); } catch (_) {}
    refs.push({ id, original: match[0], start: match.index, end: match.index + match[0].length });
  }
  return refs;
}

module.exports = { parseOeLinkReferences };
