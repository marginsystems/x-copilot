export async function loadPublicChunks() {
  await Promise.all([
    import("../../../src/Legal"),
    import("../../../src/Pricing"),
    import("../../../src/Changelog"),
    import("../../../src/Learn"),
    import("../../../src/LearnHub"),
    import("../../../src/LearnReply"),
    import("../../../src/LearnVolume"),
    import("../../../src/LearnGive"),
    import("../../../src/LearnRead"),
    import("../../../src/LearnFollow"),
  ]);
}
