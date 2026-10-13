export type BookmarkNode = chrome.bookmarks.BookmarkTreeNode;
export interface FlatBookmark {
  node: BookmarkNode;
  path: string;
  depth: number;
  mutable: boolean;
  ancestors: string[];
}
export function flattenBookmarks(tree: BookmarkNode[]) {
  const result: FlatBookmark[] = [];
  function walk(nodes: BookmarkNode[], ancestors: string[], path: string[], managed: boolean) {
    for (const node of nodes) {
      const locked = managed || Boolean(node.unmodifiable);
      result.push({ node, path: [...path, node.title || '(untitled)'].join(' / '), depth: ancestors.length, ancestors, mutable: !locked && Boolean(node.parentId) && ancestors.length > 1 && !node.folderType });
      if (node.children) walk(node.children, [...ancestors, node.id], node.title ? [...path, node.title] : path, locked);
    }
  }
  walk(tree, [], [], false);
  return result;
}
export function treeFingerprint(tree: BookmarkNode[]) {
  return JSON.stringify(flattenBookmarks(tree).map(({ node, mutable }) => [node.id, node.parentId, node.index, node.title, node.url, mutable]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}
function normalizedFolder(name: string) {
  return name.normalize('NFKC').toLowerCase().replace(/[_\-]+/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(word => word && !['links', 'bookmarks', 'resources'].includes(word)).map(word => word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word).sort().join(' ');
}
function similar(a: string, b: string) {
  const left = normalizedFolder(a); const right = normalizedFolder(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (Math.min(left.length, right.length) < 6 || Math.abs(left.length - right.length) > 1) return false;
  // Conservative one-edit suggestions; merge decisions always remain explicit.
  let i = 0; let j = 0; let edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { i++; j++; }
    else { if (++edits > 1) return false; if (left.length <= right.length) j++; if (left.length >= right.length) i++; }
  }
  return edits + Number(i < left.length || j < right.length) <= 1;
}
export function analyzeBookmarks(tree: BookmarkNode[]) {
  const flat = flattenBookmarks(tree);
  const byUrl = new Map<string, FlatBookmark[]>();
  for (const item of flat) if (item.node.url) byUrl.set(item.node.url, [...(byUrl.get(item.node.url) ?? []), item]);
  const duplicates = [...byUrl.entries()].filter(([, nodes]) => nodes.length > 1 && nodes.some(node => node.mutable)).map(([url, nodes]) => ({ url, nodes: nodes.sort((a, b) => Number(a.mutable) - Number(b.mutable) || (a.node.dateAdded ?? Infinity) - (b.node.dateAdded ?? Infinity) || a.node.id.localeCompare(b.node.id)) }));
  const notEmpty = new Set<string>(); const protectedDescendants = new Set<string>();
  for (const child of flat) for (const ancestor of child.ancestors) {
    if (child.node.url || !child.mutable) notEmpty.add(ancestor);
    if (!child.mutable) protectedDescendants.add(ancestor);
  }
  const emptyFolders = flat.filter(item => !item.node.url && item.mutable && !notEmpty.has(item.node.id));
  const folders = flat.filter(item => !item.node.url && item.mutable && !protectedDescendants.has(item.node.id));
  const merges: { source: FlatBookmark; target: FlatBookmark }[] = [];
  for (let i = 0; i < folders.length; i++) for (let j = i + 1; j < folders.length; j++) {
    if (!folders[i].ancestors.includes(folders[j].node.id) && !folders[j].ancestors.includes(folders[i].node.id) && similar(folders[i].node.title, folders[j].node.title)) merges.push({ source: folders[j], target: folders[i] });
  }
  return { flat, duplicates, emptyFolders, merges, urls: [...byUrl.keys()].filter(url => /^https?:\/\//i.test(url)) };
}
