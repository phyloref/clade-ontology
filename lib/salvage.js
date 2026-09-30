/*
 * lib/salvage.js: The decisions scripts/phylogenies/salvage-trees.js makes about one tree -- which
 * citation slot it was transcribed against, whether it fills that slot or sits beside it, and
 * which node it says a phyloreference should resolve to. They are kept free of git and the
 * filesystem so they can be tested on plain objects.
 */

const {
  cloneDeep, escapeRegExp, isEqual, pick,
} = require('lodash');

const { citationDOI, rawCitationDOI, normalizeNewick, CITATION_KEYS } = require('./phylogenies');

const hasNewick = (phylogeny) => Boolean((phylogeny.newick || '').trim());

/** A citation's first author surname, lowercased. */
function firstAuthorSurname(citation) {
  const first = (citation?.authors || [])[0];
  return (first?.lastname || first?.name || '').trim().toLowerCase();
}

/** First author surname + year + lowercased title, for sources with no usable DOI. */
function citationFingerprint(citation) {
  if (!citation) return undefined;
  const who = firstAuthorSurname(citation);
  const title = String(citation.title || '').trim().toLowerCase().replace(/[.\s]+$/, '');
  if (!who || !citation.year || !title) return undefined;
  return `${who}|${citation.year}|${title}`;
}

/**
 * A citation's title reduced to its letters and digits, so that "ANGIOSPERM PHYLOGENY: 17 GENES,
 * 640 TAXA" and "Angiosperm phylogeny: 17-genes, 640 taxa." compare equal.
 */
function citationTitleKey(citation) {
  const key = String(citation?.title || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  return key || undefined;
}

/**
 * Describe the tree to salvage out of a source file: its Newick, the citation it was transcribed
 * against, and what the curator recorded about it. Handles both source formats -- the 2020 files
 * carry the citation on the phylogeny, the 2018 files at the top level of the document.
 */
function readSourceTree(json) {
  const bearing = (json.phylogenies || []).filter(hasNewick);
  if (bearing.length !== 1) {
    throw new Error(`expected exactly one Newick-bearing phylogeny, found ${bearing.length}`);
  }
  const [phylogeny] = bearing;
  const onPhylogeny = CITATION_KEYS.map((k) => phylogeny[k]).find(Boolean);
  // The 2018 format records doi/title/citation as top-level strings; synthesize the little we
  // need from them so both formats compare the same way.
  const topLevel = json.doi || json.title
    ? {
      title: json.title,
      identifier: json.doi ? [{ type: 'doi', id: json.doi }] : [],
    }
    : undefined;
  const phyloref = (json.phylorefs || [])[0] || {};
  return {
    newick: phylogeny.newick,
    citation: onPhylogeny || topLevel,
    // The 2018 files' free-text citation ("Tank DC, Donoghue MJ. Phylogeny and ... 2010"), which
    // is the only place they name an author or a year.
    citationText: onPhylogeny ? undefined : json.citation,
    figure: phylogeny.description,
    nodeProperties: phylogeny.additionalNodeProperties,
    phylorefLabel: phyloref.label,
    curatorComments: phyloref.curatorComments,
  };
}

/** The citation matchers, strongest first. Each returns a key to compare, or undefined. */
const MATCHERS = [
  {
    name: 'doi',
    ofSource: (tree) => citationDOI(tree.citation),
    ofSlot: (slot) => citationDOI(slot.citation),
  },
  {
    name: 'fingerprint',
    ofSource: (tree) => citationFingerprint(tree.citation),
    ofSlot: (slot) => citationFingerprint(slot.citation),
  },
  {
    name: 'title',
    ofSource: (tree) => citationTitleKey(tree.citation),
    ofSlot: (slot) => citationTitleKey(slot.citation),
  },
  {
    // The weakest: the slot's first author and year both appear in the source's free-text
    // citation. It exists for one tree, whose source says "the Campanulidae" where the slot says
    // "Campanulideae", and it is only trusted because exactly one slot may match.
    name: 'author+year',
    ofSource: (tree) => (tree.citationText ? tree.citationText.toLowerCase() : undefined),
    ofSlot: (slot) => {
      const who = firstAuthorSurname(slot.citation);
      return who && slot.citation?.year ? { who, year: String(slot.citation.year) } : undefined;
    },
    matches: (text, { who, year }) => {
      // The surname as a whole word, so "tank" does not match inside "tankard".
      const surname = new RegExp(`(^|[^\\p{L}])${escapeRegExp(who)}([^\\p{L}]|$)`, 'u');
      return surname.test(text) && text.includes(year);
    },
    describe: (text, { who, year }) => `${who} ${year}`,
  },
];

/**
 * Find the citation slot in `target` that the source tree was transcribed against.
 *
 * Returns { index, key, phylogeny, citation, how, copies }, where `copies` are the indexes of
 * later phylogenies that repeat the slot's citations exactly and carry a tree: transcriptions this
 * script appended beside the slot on an earlier run. Throws, explaining why, unless exactly one
 * slot matches.
 *
 * The matchers are tried strongest first, and the first to match anything decides. When the
 * source has a usable DOI, a slot with a *different* usable DOI is a different publication and is
 * never offered to the weaker matchers.
 */
function matchSlot(target, tree) {
  const slots = (target.phylogenies || []).map((phylogeny, index) => {
    const key = CITATION_KEYS.find((k) => phylogeny[k]);
    return { index, key, phylogeny, citation: key ? phylogeny[key] : undefined };
  });

  const sourceDOI = citationDOI(tree.citation);
  const tried = [];
  for (const matcher of MATCHERS) {
    const wanted = matcher.ofSource(tree);
    if (wanted === undefined) continue;
    const candidates = matcher.name === 'doi' || !sourceDOI
      ? slots
      : slots.filter((s) => !citationDOI(s.citation));
    const matches = candidates.filter((slot) => {
      const have = matcher.ofSlot(slot);
      if (have === undefined) return false;
      return matcher.matches ? matcher.matches(wanted, have) : have === wanted;
    });
    if (!matches.length) {
      tried.push(matcher.name);
      continue;
    }

    const [slot, ...rest] = matches;
    const citationsOf = (phylogeny) => pick(phylogeny, CITATION_KEYS);
    const notCopies = rest.filter((other) => !hasNewick(other.phylogeny)
      || !isEqual(citationsOf(other.phylogeny), citationsOf(slot.phylogeny)));
    if (notCopies.length) {
      const found = `${1 + notCopies.length} of ${slots.length} citation slots`;
      throw new Error(`${found} match on ${matcher.name}, expected exactly 1`);
    }
    const matchedOn = matcher.describe
      ? matcher.describe(wanted, matcher.ofSlot(slot))
      : wanted;
    return { ...slot, how: `${matcher.name}:${matchedOn}`, copies: rest.map((s) => s.index) };
  }

  const raw = rawCitationDOI(tree.citation) || 'none';
  throw new Error(
    tried.length
      ? `none of ${slots.length} citation slots match on ${tried.join(', ')} (source DOI: ${raw})`
      : `no usable DOI (raw: ${raw}) and no author, year or title to fall back on`,
  );
}

/** Whether `label` names an internal node of `newick`, i.e. follows a closing parenthesis. */
function hasInternalNodeLabel(newick, label) {
  return new RegExp(`\\)\\s*'?${escapeRegExp(label)}'?\\s*(:[^,();]*)?[,();]`).test(newick);
}

/**
 * Translate a source tree's `additionalNodeProperties` for the target file.
 *
 * The 2018 files mark the node a phyloreference should resolve to with
 * `expectedPhyloreferenceNamed`, naming the phyloreference by *their own* label for it, which can
 * differ from the label PhyloRegnum gives it ("Apo-Tracheophyte", "Dikarya " with a trailing
 * space). Each source file holds one phyloreference, so an expectation that names it is rewritten
 * to the target's label; one that names anything else is refused rather than guessed at.
 *
 * `nodeLabelFixes` maps a node label the source wrote to the label actually in the Newick, for
 * annotations that dangle because of a typo. Returns { properties, notes }, where `notes` lists
 * what was written in the source for every expectation carried over.
 */
function translateNodeProperties(tree, targetLabel, nodeLabelFixes = {}) {
  const properties = {};
  const notes = [];
  for (const [writtenNode, props] of Object.entries(tree.nodeProperties || {})) {
    const node = nodeLabelFixes[writtenNode] || writtenNode;
    if (!hasInternalNodeLabel(tree.newick, node)) {
      throw new Error(`node properties are keyed on "${writtenNode}", which labels no internal node`);
    }
    const translated = { ...props };
    if (props.expectedPhyloreferenceNamed) {
      const foreign = props.expectedPhyloreferenceNamed.filter((n) => n !== tree.phylorefLabel);
      if (foreign.length) {
        throw new Error(
          `node "${writtenNode}" expects phyloreference "${foreign[0]}", `
          + `which is not the source file's own ("${tree.phylorefLabel}")`,
        );
      }
      translated.expectedPhyloreferenceNamed = props.expectedPhyloreferenceNamed.map(() => targetLabel);
      notes.push({ node, writtenNode, writtenPhyloref: tree.phylorefLabel });
    }
    properties[node] = translated;
  }
  return { properties, notes };
}

/**
 * Put `tree` into `target`, given the slot it was matched to. Mutates `target` only when it
 * returns `written: true`.
 *
 *   - Already there (in the slot, or appended beside it): nothing to do.
 *   - The slot is empty: fill it.
 *   - The slot holds a different tree: append a new phylogeny that repeats the slot's citations.
 *     A curated tree is never overwritten, and which of two transcriptions of one publication is
 *     the better one is not this script's call.
 *
 * Returns { action: 'filled' | 'appended', index, written }.
 */
function placeTree(target, tree, slot, nodeProperties = {}) {
  const norm = normalizeNewick(tree.newick);
  const holds = (phylogeny) => hasNewick(phylogeny) && normalizeNewick(phylogeny.newick) === norm;

  const at = target.phylogenies.findIndex(holds);
  if (at !== -1) {
    if (at !== slot.index && !slot.copies.includes(at)) {
      throw new Error(`the tree is already in phylogeny ${at}, under a different citation`);
    }
    return { action: at === slot.index ? 'filled' : 'appended', index: at, written: false };
  }

  const extras = {
    // Figure-level notes ("Vallin and Laurin 2004 Fig. 6") say which figure was transcribed.
    ...(tree.figure ? { description: tree.figure } : {}),
    ...(Object.keys(nodeProperties).length ? { additionalNodeProperties: nodeProperties } : {}),
  };

  if (!hasNewick(slot.phylogeny)) {
    slot.phylogeny.newick = tree.newick;
    for (const [key, value] of Object.entries(extras)) {
      if (!(key in slot.phylogeny)) slot.phylogeny[key] = value;
    }
    return { action: 'filled', index: slot.index, written: true };
  }

  target.phylogenies.push({
    ...cloneDeep(pick(slot.phylogeny, CITATION_KEYS)),
    newick: tree.newick,
    ...extras,
  });
  return { action: 'appended', index: target.phylogenies.length - 1, written: true };
}

module.exports = {
  citationFingerprint,
  citationTitleKey,
  readSourceTree,
  matchSlot,
  hasInternalNodeLabel,
  translateNodeProperties,
  placeTree,
};
