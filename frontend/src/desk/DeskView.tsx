import type { ComponentProps } from "react";
import { VoiceUnlockToast } from "../VoiceCard";
import { DeskTop } from "./DeskTop";
import { ThreadsTabs } from "./ThreadsTabs";

type DeskViewProps = {
  toast: ComponentProps<typeof VoiceUnlockToast>;
  top: ComponentProps<typeof DeskTop>;
  tabs: ComponentProps<typeof ThreadsTabs>;
};

/** Desk composition loads only after the shell's session and onboarding gates. */
export default function DeskView({ toast, top, tabs }: DeskViewProps) {
  return <>
    <VoiceUnlockToast {...toast} />
    <div className="dashboard">
      <section className="desk">
        <DeskTop {...top} />
        <ThreadsTabs {...tabs} />
      </section>
    </div>
  </>;
}
