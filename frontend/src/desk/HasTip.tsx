import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";
import { useTipEdge } from "../lib/useTipEdge";

function tipClass(base: string | undefined, alignClass: string): string {
  return [base, "has-tip", alignClass].filter(Boolean).join(" ");
}

export function HasTipLink({
  tip,
  className,
  onMouseEnter,
  onFocus,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { tip: string }) {
  const { ref, alignClass, place } = useTipEdge<HTMLAnchorElement>();
  return (
    <a
      {...rest}
      ref={ref}
      className={tipClass(className, alignClass)}
      data-tip={tip}
      onMouseEnter={(event) => {
        place();
        onMouseEnter?.(event);
      }}
      onFocus={(event) => {
        place();
        onFocus?.(event);
      }}
    />
  );
}

export function HasTipButton({
  tip,
  className,
  onMouseEnter,
  onFocus,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tip: string }) {
  const { ref, alignClass, place } = useTipEdge<HTMLButtonElement>();
  return (
    <button
      {...rest}
      ref={ref}
      type={rest.type ?? "button"}
      className={tipClass(className, alignClass)}
      data-tip={tip}
      onMouseEnter={(event) => {
        place();
        onMouseEnter?.(event);
      }}
      onFocus={(event) => {
        place();
        onFocus?.(event);
      }}
    />
  );
}
