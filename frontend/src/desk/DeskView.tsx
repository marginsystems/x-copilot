import type { ComponentProps } from "react";
import { DeskTop } from "./DeskTop";
import { ThreadsTabs } from "./ThreadsTabs";

type DeskViewProps = {
  top: ComponentProps<typeof DeskTop>;
  tabs: ComponentProps<typeof ThreadsTabs>;
};

/** Desk composition loads only after the shell's session and onboarding gates. */
export default function DeskView({ top, tabs }: DeskViewProps) {
  return (
    <div className="dashboard">
      <section className="desk">
        <DeskTop {...top} />
        <ThreadsTabs {...tabs} />
      </section>
    </div>
  );
}
