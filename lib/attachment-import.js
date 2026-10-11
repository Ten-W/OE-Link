const { makeMarkdownTableSafeReference } = require("./asset-utils");

function referenceKey(link) {
  return JSON.stringify([link.original, link.file?.path || link.localPath || link.url || link.target]);
}

function mergeAttachmentReplacements(source, latest, replacements, sourceLinks, latestLinks) {
  const applied = [];
  for (const replacement of replacements) {
    const { link } = replacement;
    if (source.slice(link.start, link.end) !== link.original) continue;
    const key = referenceKey(link);
    const before = sourceLinks.filter(candidate => referenceKey(candidate) === key);
    const after = latestLinks.filter(candidate => referenceKey(candidate) === key);
    // Duplicate insertion/removal makes occurrence-based matching ambiguous.
    if (before.length !== after.length) continue;
    const index = before.findIndex(candidate => candidate.start === link.start && candidate.end === link.end);
    const target = after[index];
    if (!target || latest.slice(target.start, target.end) !== link.original) continue;
    applied.push({ ...replacement, start: target.start, end: target.end });
  }
  let text = latest;
  for (const replacement of applied.slice().sort((a, b) => b.start - a.start)) {
    const value = makeMarkdownTableSafeReference(latest, replacement.start, replacement.value);
    text = text.slice(0, replacement.start) + value + text.slice(replacement.end);
  }
  return { text, applied };
}

module.exports = { mergeAttachmentReplacements };
