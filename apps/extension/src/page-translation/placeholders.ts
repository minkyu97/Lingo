/**
 * Marks text that is waiting for its translation: gray bars in place of its
 * lines, pulsing slowly.
 *
 * The bars are CSS custom highlights. The browser paints a highlight on the
 * text itself, so a bar is exactly as wide as its line, and it scrolls,
 * clips, and stacks as the text does. Nothing is added to the page's
 * elements. The price is the look: a highlight has square corners and one
 * flat color, and it cannot be animated, so the pulse is made by moving
 * each group of text from one color to the next, step by step.
 */
import {
  PLACEHOLDER_STEP_MS,
  PLACEHOLDER_STEPS,
  placeholderColor,
} from "@lingo/ui";

export interface Placeholders {
  /** Covers a stretch of the page. `key` is what `hide` is called with. */
  show(key: unknown, range: Range): void;
  hide(key: unknown): void;
  clear(): void;
}

/** The part of a `Highlight` that is used here. */
interface RangeSet {
  add(range: AbstractRange): unknown;
  delete(range: AbstractRange): boolean;
}

export interface PlaceholderEnv {
  /** The browser's registry of highlights. Undefined where it has none. */
  registry:
    | {
        set(name: string, ranges: RangeSet): unknown;
        delete(name: string): boolean;
      }
    | undefined;
  createRangeSet(): RangeSet;
  /**
   * Puts a style sheet into a document or a shadow tree, without adding an
   * element to it. Returns a function that takes the sheet out again.
   */
  adoptStyles(scope: Document | ShadowRoot, css: string): () => void;
  /** Whether the user has asked for less motion. */
  prefersStillness(): boolean;
}

const nameOf = (step: number) => `lingo-placeholder-${step}`;

/** One rule per step of the pulse: the text hidden, and the bar's color. */
export const PLACEHOLDER_CSS = PLACEHOLDER_STEPS.map(
  (opacity, step) => `::highlight(${nameOf(step)}) {
  color: transparent;
  -webkit-text-fill-color: transparent;
  text-decoration-color: transparent;
  text-shadow: none;
  background-color: ${placeholderColor(opacity)};
}`,
).join("\n");

const browser: PlaceholderEnv = {
  registry: globalThis.CSS?.highlights,
  createRangeSet: () => new Highlight(),
  adoptStyles(scope, css) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    scope.adoptedStyleSheets = [...scope.adoptedStyleSheets, sheet];
    return () => {
      scope.adoptedStyleSheets = scope.adoptedStyleSheets.filter(
        (adopted) => adopted !== sheet,
      );
    };
  },
  prefersStillness: () =>
    globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
    false,
};

export function createPlaceholders(
  env: PlaceholderEnv = browser,
): Placeholders {
  const { registry } = env;
  // Without highlights there is nothing to paint with. Translation still
  // works; text just stays readable until it is replaced.
  if (!registry) return { show() {}, hide() {}, clear() {} };

  const steps = PLACEHOLDER_STEPS.length;
  /**
   * Text is spread over as many groups as the pulse has steps. Each group is
   * one step behind the one before it, so the pulse runs down the page.
   */
  let groups: RangeSet[] = [];
  const shown = new Map<unknown, { range: Range; group: RangeSet }>();
  const styled = new Map<Node, () => void>();
  let next = 0;
  let tick = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  /** Gives each group the color of the step it is at. */
  function paint() {
    groups.forEach((group, index) => {
      registry?.set(nameOf((((tick - index) % steps) + steps) % steps), group);
    });
  }

  function step() {
    tick += 1;
    paint();
  }

  function stop() {
    clearInterval(timer);
    timer = undefined;
    for (let index = 0; index < steps; index++) registry?.delete(nameOf(index));
    for (const remove of styled.values()) remove();
    styled.clear();
    groups = [];
    next = 0;
    tick = 0;
  }

  return {
    show(key, range) {
      this.hide(key);
      if (groups.length === 0) {
        groups = PLACEHOLDER_STEPS.map(() => env.createRangeSet());
        paint();
      }
      // The rules have to be in the tree that the text is in.
      const scope = range.startContainer.getRootNode() as Document | ShadowRoot;
      if (!styled.has(scope)) {
        styled.set(scope, env.adoptStyles(scope, PLACEHOLDER_CSS));
      }

      const still = env.prefersStillness();
      // Without motion, every bar keeps the resting tone of the first group.
      const group = groups[still ? 0 : next++ % steps];
      if (!group) return;
      group.add(range);
      shown.set(key, { range, group });
      if (!still) timer ??= setInterval(step, PLACEHOLDER_STEP_MS);
    },

    hide(key) {
      const entry = shown.get(key);
      if (!entry) return;
      entry.group.delete(entry.range);
      shown.delete(key);
      if (shown.size === 0) stop();
    },

    clear() {
      shown.clear();
      stop();
    },
  };
}
