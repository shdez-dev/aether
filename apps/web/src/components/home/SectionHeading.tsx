export function SectionHeading({
  id,
  index,
  eyebrow,
  title,
  description,
}: {
  id: string;
  index: string;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="section-heading">
      <div>
        <p className="eyebrow">
          <span>{index}</span>
          {eyebrow}
        </p>
        <h2 id={id}>{title}</h2>
      </div>
      <p className="section-description">{description}</p>
    </div>
  );
}
