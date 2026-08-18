import type { SkinPreference } from "../useSkinPreference";
import { DraftingRegistrationMarks } from "./DraftingRegistrationMarks";
import { CaseBoardCorkTexture } from "./CaseBoardCorkTexture";

/**
 * Mounts the active skin's full-page decorative backdrop, if it has one.
 * Harness's decoration (HarnessWindowDots) is inline chrome rendered in the
 * masthead instead, not a backdrop, so it renders nothing here (s1,
 * consus-phase18).
 */
export function SkinBackdrop({ skin }: { skin: SkinPreference }) {
  switch (skin) {
    case "drafting":
      return <DraftingRegistrationMarks />;
    case "case-board":
      return <CaseBoardCorkTexture />;
    case "harness":
      return null;
  }
}
