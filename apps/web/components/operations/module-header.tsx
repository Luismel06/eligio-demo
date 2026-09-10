export function ModuleHeader({
  eyebrow = 'EligioValdez Comercial',
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-accent">{eyebrow}</p>
      <h1 className="text-2xl font-semibold tracking-normal sm:text-3xl">{title}</h1>
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}
