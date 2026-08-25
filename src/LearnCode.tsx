type LearnCodeProps = {
  file: string;
  href: string;
  children: string;
};

export function LearnCode(props: LearnCodeProps) {
  return (
    <figure className="learn-code">
      <figcaption>
        <span>{props.file}</span>
        <a href={props.href} rel="noreferrer">
          Source
        </a>
      </figcaption>
      <pre>
        <code>{props.children}</code>
      </pre>
    </figure>
  );
}
