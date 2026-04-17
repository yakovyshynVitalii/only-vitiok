import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  deriveVipFromContent,
  deriveVipFromItemEvidence,
  enforceSexyTone,
  finalizeTitleCandidate,
} = require("../../scripts/generate-config.js") as {
  deriveVipFromContent: (contentSummary: string) => boolean;
  deriveVipFromItemEvidence: (item: {
    contentSummary?: string;
    title?: string;
    description?: string;
    hashtags?: string[];
  }) => boolean;
  enforceSexyTone: (
    text: string,
    options: { isTitle?: boolean; emoji?: string; maxLength?: number }
  ) => string;
  finalizeTitleCandidate: (
    title: string,
    options: { emoji: string }
  ) => string;
};

describe("deriveVipFromContent", () => {
  test("marks bare breasts as VIP", () => {
    expect(
      deriveVipFromContent(
        "Bare breasts and nipples are visible. NUDE_NIPPLES=YES NUDE_PUSSY=NO NUDE_ASS=NO"
      )
    ).toBe(true);
  });

  test("marks bare breasts with no bra visible as VIP", () => {
    expect(
      deriveVipFromContent(
        "Bare breasts, no bra visible, posed front, dimly lit room with blue accent lighting."
      )
    ).toBe(true);
  });

  test("marks bare vagina as VIP", () => {
    expect(
      deriveVipFromContent(
        "Bare vagina is clearly visible with no panties. NUDE_NIPPLES=NO NUDE_PUSSY=YES NUDE_ASS=NO"
      )
    ).toBe(true);
  });

  test("marks bare crotch with no panties visible as VIP", () => {
    expect(
      deriveVipFromContent(
        "Rear view with bare crotch visible between the legs and no panties visible. NUDE_NIPPLES=NO NUDE_PUSSY=YES NUDE_ASS=YES"
      )
    ).toBe(true);
  });

  test("marks nude from behind wearing nothing as VIP", () => {
    expect(
      deriveVipFromContent(
        "Nude blonde woman from behind, standing in a bedroom with hands on hips. She is wearing nothing."
      )
    ).toBe(true);
  });

  test("marks naked woman as VIP even when nipples are not named", () => {
    expect(
      deriveVipFromContent(
        "Naked woman with hands behind head and arms crossed in bathroom, beige walls, towel rack visible."
      )
    ).toBe(true);
  });

  test("does not mark bra or panties as VIP", () => {
    expect(
      deriveVipFromContent(
        "She is wearing a bra and panties; cleavage is visible. NUDE_NIPPLES=NO NUDE_PUSSY=NO NUDE_ASS=NO"
      )
    ).toBe(false);
  });

  test("does not mark contradictory covered pussy as VIP", () => {
    expect(
      deriveVipFromContent(
        "Panties are visible and covering her pussy. NUDE_NIPPLES=NO NUDE_PUSSY=YES NUDE_ASS=NO"
      )
    ).toBe(false);
  });

  test("does not mark bikini as VIP", () => {
    expect(
      deriveVipFromContent(
        "She is wearing a bikini with cleavage visible. NUDE_NIPPLES=YES NUDE_PUSSY=YES NUDE_ASS=NO"
      )
    ).toBe(false);
  });

  test("does not mark hand-covered nudity as VIP", () => {
    expect(
      deriveVipFromContent(
        "She is topless but her hands cover her nipples. NUDE_NIPPLES=YES NUDE_PUSSY=NO NUDE_ASS=NO"
      )
    ).toBe(false);
  });

  test("does not mark bare ass alone as VIP", () => {
    expect(
      deriveVipFromContent(
        "Only her bare ass is visible from behind, nipples and pussy are covered. NUDE_NIPPLES=NO NUDE_PUSSY=NO NUDE_ASS=YES"
      )
    ).toBe(false);
  });

  test("keeps topless content VIP even if panties are visible", () => {
    expect(
      deriveVipFromContent(
        "Topless with bare breasts visible, wearing panties. NUDE_NIPPLES=YES NUDE_PUSSY=NO NUDE_ASS=NO"
      )
    ).toBe(true);
  });

  test("marks displayed nipples as VIP", () => {
    expect(
      deriveVipFromContent(
        "Blonde with big, firm breasts. Nipples are prominently displayed."
      )
    ).toBe(true);
  });

  test("uses generated description and tags as VIP evidence", () => {
    expect(
      deriveVipFromItemEvidence({
        contentSummary: "Blonde in lace lingerie close-up.",
        title: "Blonde in lace lingerie",
        description:
          "Blonde with big, firm breasts, posing seductively. Nipples are prominently displayed.",
        hashtags: ["blonde", "busty", "amateur"],
      })
    ).toBe(true);
  });

  test("marks wet crotch copy as VIP evidence unless covered by panties", () => {
    expect(
      deriveVipFromItemEvidence({
        title: "Blonde in lace lingerie",
        description:
          "Blonde in lace lingerie, teasingly showing her wet crotch in a close-up.",
        hashtags: ["blonde", "lingerie", "wetpussy"],
      })
    ).toBe(true);
  });

  test("marks wet nipples copy as VIP evidence", () => {
    expect(
      deriveVipFromItemEvidence({
        contentSummary:
          "Blonde with big, wet nipples, posing in a room with blue lighting.",
        title: "Blonde with big",
        description:
          "Blonde with big, wet nipples, posing in a room with blue lighting. Ripped off my bra come stare at my tits.",
        hashtags: ["blonde", "busty", "wetpussy", "onlyfans"],
      })
    ).toBe(true);
  });

  test("marks no visible clothing with tits as VIP evidence", () => {
    expect(
      deriveVipFromItemEvidence({
        contentSummary:
          "Blonde with big tits posing in a bathroom, no visible clothing on body parts.",
        title: "These tits are why you can't stop",
        description:
          "Blonde with massive cleavage poses in a bathroom, teasing your fantasies.",
        hashtags: ["bigtits", "blonde", "bathroom"],
      })
    ).toBe(true);
  });

  test("marks nude woman from behind as VIP even if model omits explicit parts", () => {
    expect(
      deriveVipFromItemEvidence({
        contentSummary:
          "Back view of a nude woman with visible buttocks and legs, standing in a bedroom setting. No visible nipples or pussy.",
        title: "Raw slutty amateur",
        description:
          "Just filmed myself naked in the mirror no filter. My ass looks great from behind.",
        hashtags: ["ass", "blonde", "nude", "bedroom"],
      })
    ).toBe(true);
  });
});

describe("generated title length", () => {
  test("keeps appended emoji inside the 60 character title limit", () => {
    const title = enforceSexyTone("A".repeat(80), {
      isTitle: true,
      emoji: "🔥",
      maxLength: 60,
    });

    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith(" 🔥")).toBe(true);
  });

  test("reserves enough room for multi-code-unit emoji", () => {
    const title = finalizeTitleCandidate("B".repeat(80), {
      emoji: "❤️‍🔥",
    });

    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith(" ❤️‍🔥")).toBe(true);
  });
});
