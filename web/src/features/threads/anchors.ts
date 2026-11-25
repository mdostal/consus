import { splitIntoSections } from "../docs/sections";
import type { DiagramEpic } from "../projects/DiagramView";
import type { AnchorOption } from "./ThreadsPanel";

/** One anchor per h1-h3 section of a markdown doc (same split DocRenderer
 *  uses), carrying the heading text and its 1-based start line. */
export function docSectionAnchors(content: string): AnchorOption[] {
  const out: AnchorOption[] = [];
  let line = 1;
  for (const section of splitIntoSections(content)) {
    const heading = /^#{1,3} +(.+?)\s*$/m.exec(section.split("\n")[0]);
    if (heading) out.push({ label: heading[1], anchor: { section: heading[1], line } });
    line += section.split("\n").length - 1;
  }
  return out;
}

/** One anchor per epic and story node of an epic/story diagram. */
export function diagramNodeAnchors(epics: DiagramEpic[]): AnchorOption[] {
  return epics.flatMap((epic) => [
    { label: epic.title, anchor: { nodeId: epic.id } },
    ...epic.stories.map((story) => ({ label: `${epic.title} › ${story.title}`, anchor: { nodeId: story.id } })),
  ]);
}
