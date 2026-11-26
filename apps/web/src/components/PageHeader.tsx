import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description: string;
  action?: ReactNode;
  back?: ReactNode;
}

export function PageHeader({ title, description, action, back }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-heading-copy">
        {back ? <div className="page-back">{back}</div> : null}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action ? <div className="page-header-action">{action}</div> : null}
    </header>
  );
}
